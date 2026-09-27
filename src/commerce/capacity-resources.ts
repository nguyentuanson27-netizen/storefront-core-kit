/**
 * Resource-based sellable capacity (spec: docs/specs/core-kit-production-hardening-v1.md §5).
 *
 * Pure mapping only. Locking, reading competing holds and persisting reservations belong to
 * `capacity-reservation-repository.ts`; this module decides what a purchased line consumes and
 * whether a set of resources has room, from facts the caller has already read under lock.
 *
 * A standalone line consumes its own variant. A line for a composite parent consumes every
 * component variant × edge quantity × purchased quantity, and the parent's own mirrored stock is
 * never consulted: Pancake reports it, but it is not the stock a set sale actually spends.
 */

const MAX_POSTGRES_INTEGER = 2_147_483_647;

export type CapacityResourceKind = "SELF" | "COMPONENT";

export type CapacityResource = Readonly<{
  variantId: string;
  kind: CapacityResourceKind;
  /** Units of this resource one purchased unit consumes: 1 for SELF, the edge quantity otherwise. */
  unitsPerLine: number;
  /** `lineQuantity × unitsPerLine`. */
  quantity: number;
}>;

export type CapacityLinePlan = Readonly<{
  variantId: string;
  quantity: number;
  resources: readonly CapacityResource[];
}>;

export type CompositeEdgeFact = Readonly<{
  parentVariantId: string;
  componentVariantId: string;
  quantity: number;
}>;

export type CapacityPlanRefusal =
  | "EMPTY_ORDER"
  | "INVALID_QUANTITY"
  | "INVALID_TOPOLOGY";

export type CapacityPlanResult =
  | { ok: true; lines: readonly CapacityLinePlan[] }
  | { ok: false; reason: CapacityPlanRefusal; variantId: string | null };

function isPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_POSTGRES_INTEGER;
}

/**
 * Merges duplicate purchased variants, then expands each line into the resources it consumes.
 *
 * Fails closed on anything it cannot prove: a non-positive or out-of-range quantity, an edge whose
 * multiplier is not a positive integer, a product that would overflow a PostgreSQL INTEGER, a
 * self-referencing edge, or a component that is itself a composite parent (one level of expansion is
 * what the reviewed Pancake contract describes; nesting would need its own evidence).
 */
export function planCapacityResources(
  lines: readonly Readonly<{ variantId: string; quantity: number }>[],
  edges: readonly CompositeEdgeFact[],
): CapacityPlanResult {
  if (lines.length === 0) return { ok: false, reason: "EMPTY_ORDER", variantId: null };

  const merged = new Map<string, number>();
  for (const line of lines) {
    if (!isPositiveInteger(line.quantity)) {
      return { ok: false, reason: "INVALID_QUANTITY", variantId: line.variantId };
    }
    const total = (merged.get(line.variantId) ?? 0) + line.quantity;
    if (!isPositiveInteger(total)) {
      return { ok: false, reason: "INVALID_QUANTITY", variantId: line.variantId };
    }
    merged.set(line.variantId, total);
  }

  const edgesByParent = new Map<string, CompositeEdgeFact[]>();
  for (const edge of edges) {
    const list = edgesByParent.get(edge.parentVariantId) ?? [];
    list.push(edge);
    edgesByParent.set(edge.parentVariantId, list);
  }

  const planned: CapacityLinePlan[] = [];
  for (const [variantId, quantity] of [...merged.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const components = edgesByParent.get(variantId);
    if (!components || components.length === 0) {
      planned.push({
        variantId,
        quantity,
        resources: [{ variantId, kind: "SELF", unitsPerLine: 1, quantity }],
      });
      continue;
    }

    const resources: CapacityResource[] = [];
    const seen = new Set<string>();
    for (const edge of [...components].sort((a, b) =>
      a.componentVariantId < b.componentVariantId ? -1 : a.componentVariantId > b.componentVariantId ? 1 : 0,
    )) {
      const consumed = edge.quantity * quantity;
      if (
        !isPositiveInteger(edge.quantity) ||
        !isPositiveInteger(consumed) ||
        edge.componentVariantId === variantId ||
        seen.has(edge.componentVariantId) ||
        edgesByParent.has(edge.componentVariantId)
      ) {
        return { ok: false, reason: "INVALID_TOPOLOGY", variantId };
      }
      seen.add(edge.componentVariantId);
      resources.push({
        variantId: edge.componentVariantId,
        kind: "COMPONENT",
        unitsPerLine: edge.quantity,
        quantity: consumed,
      });
    }
    planned.push({ variantId, quantity, resources });
  }

  return { ok: true, lines: planned };
}

/**
 * Normalizes an aggregate of mirrored `WarehouseStock` rows into whole units.
 *
 * `WarehouseStock.quantity` is stored as `Float`. A non-finite value fails closed (null), and a
 * fractional aggregate is floored: rounding up would sell a unit nobody reported.
 */
export function wholeMirroredUnits(quantities: readonly number[]): number | null {
  let total = 0;
  for (const quantity of quantities) {
    if (!Number.isFinite(quantity)) return null;
    total += quantity;
    if (!Number.isFinite(total)) return null;
  }
  return Math.floor(total);
}

export type ResourceCapacityFact = Readonly<{
  /** Whole mirrored units, or null when the mirror cannot be trusted. */
  mirroredUnits: number | null;
  /** Units still locally held by accepted-but-unreflected, in-flight or unresolved reservations. */
  activeReservedUnits: number;
}>;

/**
 * Whether every resource of every planned line fits, evaluated as one all-or-none decision.
 *
 * Resources shared between lines (a direct sale of a child and a set that contains it) are summed
 * before comparison, so one order cannot pass two lines that each fit alone but not together.
 */
export function evaluatePlannedCapacity(
  lines: readonly CapacityLinePlan[],
  facts: ReadonlyMap<string, ResourceCapacityFact>,
): { ok: true } | { ok: false; variantId: string } {
  const demand = new Map<string, number>();
  for (const line of lines) {
    for (const resource of line.resources) {
      demand.set(resource.variantId, (demand.get(resource.variantId) ?? 0) + resource.quantity);
    }
  }
  for (const [variantId, requested] of [...demand.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const fact = facts.get(variantId);
    if (!fact || fact.mirroredUnits === null) return { ok: false, variantId };
    if (fact.mirroredUnits - fact.activeReservedUnits - requested < 0) return { ok: false, variantId };
  }
  return { ok: true };
}

/**
 * Advisory sellable quantity for one variant: what a shopper can be offered, not what checkout
 * accepts. Standalone: its own free units. Composite parent: the fewest whole sets its components
 * can still supply.
 */
export function advisorySellableUnits(
  resources: readonly Readonly<{ unitsPerLine: number; fact: ResourceCapacityFact | undefined }>[],
): number {
  let sets: number | null = null;
  for (const resource of resources) {
    const fact = resource.fact;
    if (!fact || fact.mirroredUnits === null || !isPositiveInteger(resource.unitsPerLine)) return 0;
    const free = Math.max(0, fact.mirroredUnits - fact.activeReservedUnits);
    const supply = Math.floor(free / resource.unitsPerLine);
    sets = sets === null ? supply : Math.min(sets, supply);
  }
  return sets ?? 0;
}

/**
 * Signed whole units a variant's resources can still supply: the fewest whole sets for a composite
 * parent, the variant's own free units when standalone. Unlike `advisorySellableUnits` it is not
 * clamped at zero, so an operator can see how far past zero a resource has gone; null when any
 * resource's mirror cannot be trusted. `advisorySellableUnits` is `max(0, wholeFreeUnits)`, or 0 for null.
 */
export function wholeFreeUnits(
  resources: readonly Readonly<{ unitsPerLine: number; fact: ResourceCapacityFact | undefined }>[],
): number | null {
  let sets: number | null = null;
  for (const resource of resources) {
    const fact = resource.fact;
    if (!fact || fact.mirroredUnits === null || !isPositiveInteger(resource.unitsPerLine)) return null;
    const supply = Math.floor((fact.mirroredUnits - fact.activeReservedUnits) / resource.unitsPerLine);
    sets = sets === null ? supply : Math.min(sets, supply);
  }
  return sets;
}
