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

import type { EffectiveSellingPolicy } from "./selling-policy.ts";

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
 *
 * `floors` is the lowest free level each resource may reach (selling modes spec §4.3); a resource
 * absent from it has floor 0, which is exactly the pre-selling-modes rule. The refusal reports the
 * floor it was measured against, so the caller can tell an exhausted oversell allowance apart from
 * ordinary exhaustion.
 */
export function evaluatePlannedCapacity(
  lines: readonly CapacityLinePlan[],
  facts: ReadonlyMap<string, ResourceCapacityFact>,
  floors: ReadonlyMap<string, number> = new Map(),
): { ok: true } | { ok: false; variantId: string; floor: number } {
  const demand = new Map<string, number>();
  for (const line of lines) {
    for (const resource of line.resources) {
      demand.set(resource.variantId, (demand.get(resource.variantId) ?? 0) + resource.quantity);
    }
  }
  for (const [variantId, requested] of [...demand.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const floor = floors.get(variantId) ?? 0;
    const fact = facts.get(variantId);
    if (!fact || fact.mirroredUnits === null) return { ok: false, variantId, floor };
    if (fact.mirroredUnits - fact.activeReservedUnits - requested < floor) return { ok: false, variantId, floor };
  }
  return { ok: true };
}

export type ResourceFloorRefusal = "INVALID_POLICY" | "COMPOSITE_MODE_UNSUPPORTED";

/**
 * The floor each resource of an order is measured against (selling modes spec §5, §6).
 *
 * - A `SELF` resource takes the floor of the purchased variant's effective policy.
 * - A `COMPONENT` resource always takes 0: negative component accounting is unproven, so a set sale
 *   never drives a component below zero, whatever the component's own product allows.
 * - A variant consumed both ways in one order takes the stricter floor for its whole demand, which is
 *   0, because `evaluatePlannedCapacity` sums the demand before comparing.
 *
 * Refuses the whole order when a purchased variant's policy is invalid, or when a composite parent's
 * product resolves to a non-`STANDARD` mode: the owner configured something v1 cannot honor, and a
 * quiet downgrade would hide it. `policyFor` must answer for every purchased variant.
 */
export function resolveResourceFloors(
  lines: readonly CapacityLinePlan[],
  policyFor: (variantId: string) => EffectiveSellingPolicy,
): { ok: true; floors: Map<string, number> } | { ok: false; reason: ResourceFloorRefusal; variantId: string } {
  const floors = new Map<string, number>();
  for (const line of lines) {
    const policy = policyFor(line.variantId);
    if (policy.kind === "REFUSE") return { ok: false, reason: "INVALID_POLICY", variantId: line.variantId };
    const isSet = line.resources.some((resource) => resource.kind === "COMPONENT");
    if (isSet && policy.mode !== "STANDARD") {
      return { ok: false, reason: "COMPOSITE_MODE_UNSUPPORTED", variantId: line.variantId };
    }
    for (const resource of line.resources) {
      const floor = resource.kind === "COMPONENT" ? 0 : policy.floor;
      const current = floors.get(resource.variantId);
      floors.set(resource.variantId, current === undefined ? floor : Math.max(current, floor));
    }
  }
  return { ok: true, floors };
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

/**
 * What a shopper can be offered for one variant under its effective selling policy (selling modes
 * spec §8). Advisory: checkout acceptance is decided only by `reserveOrderCapacity`.
 *
 * - `sellableUnits = max(0, free − floor)`: what may still be accepted. A composite parent uses the
 *   fewest whole sets at component floor 0, and offers nothing under a non-`STANDARD` mode (§6.1).
 * - `readyUnits = max(0, free)`: what exists now.
 * - `isPreorderSale`: the next single unit would be a preorder.
 * - `acceptsPreorder`: the variant sells under an effective `PREORDER`, so a line of it is a
 *   preorder as soon as its quantity exceeds `readyUnits` (`acceptedAsPreorder`).
 *
 * An invalid policy, an unprovable topology or an untrusted mirror offers nothing.
 */
export type AdvisoryVariantCapacity = Readonly<{
  sellableUnits: number;
  readyUnits: number;
  isPreorderSale: boolean;
  acceptsPreorder: boolean;
}>;

const NOTHING_OFFERED: AdvisoryVariantCapacity = Object.freeze({
  sellableUnits: 0,
  readyUnits: 0,
  isPreorderSale: false,
  acceptsPreorder: false,
});

export function advisoryVariantCapacity(
  resources: readonly Readonly<{ kind: CapacityResourceKind; unitsPerLine: number; fact: ResourceCapacityFact | undefined }>[] | null,
  policy: EffectiveSellingPolicy,
): AdvisoryVariantCapacity {
  if (resources === null) return NOTHING_OFFERED;
  const free = wholeFreeUnits(resources);
  if (free === null) return NOTHING_OFFERED;
  const readyUnits = Math.max(0, free);
  if (policy.kind === "REFUSE") return Object.freeze({ ...NOTHING_OFFERED, readyUnits });

  const isSet = resources.some((resource) => resource.kind === "COMPONENT");
  if (isSet && policy.mode !== "STANDARD") return Object.freeze({ ...NOTHING_OFFERED, readyUnits });

  const floor = isSet ? 0 : policy.floor;
  const sellableUnits = Math.max(0, free - floor);
  const acceptsPreorder = policy.mode === "PREORDER";
  return Object.freeze({
    sellableUnits,
    readyUnits,
    isPreorderSale: acceptsPreorder && sellableUnits >= 1 && readyUnits < 1,
    acceptsPreorder,
  });
}

/**
 * Whether a line of `quantity` units is a preorder (spec §8): quantity-aware, so a line that starts
 * with ready units and runs past them is still a preorder line. A variant without the advisory
 * fields never is.
 */
export function acceptedAsPreorder(
  quantity: number,
  capacity: Readonly<{ acceptsPreorder?: boolean; readyUnits?: number }>,
): boolean {
  return capacity.acceptsPreorder === true && quantity > (capacity.readyUnits ?? 0);
}
