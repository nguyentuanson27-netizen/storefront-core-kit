import { Prisma } from "../generated/prisma/client.ts";
import {
  advisorySellableUnits,
  evaluatePlannedCapacity,
  planCapacityResources,
  wholeMirroredUnits,
  type CompositeEdgeFact,
  type ResourceCapacityFact,
} from "./capacity-resources.ts";

/**
 * The one authoritative capacity path (spec: docs/specs/core-kit-production-hardening-v1.md §5).
 *
 * Locking strategy. The lock target is `VariantMirror`, never the reservation ledger: `SELECT … FOR
 * UPDATE` only locks rows it returns, and a variant nobody has reserved yet has no ledger rows, so
 * locking the ledger would let the first two concurrent buyers of a variant both succeed vacuously.
 * Every reservable variant and every component resource has a `VariantMirror` row, so locking those
 * serializes the second buyer even on an empty ledger. The rows are locked in ascending id order in a
 * single statement, so every caller acquires them in the same sequence and no deadlock cycle forms.
 *
 * `READ COMMITTED` is sufficient and deliberate: a transaction that blocked on the lock reads competing
 * holds with a fresh snapshot after it acquires the lock, so it sees the winner's committed rows.
 */

type Tx = Prisma.TransactionClient;
type ReadClient = Pick<Tx, "$queryRaw" | "compositeComponentMirror" | "warehouseStock" | "variantMirror">;

export type CapacityReservationRefusal =
  | "VARIANT_MISSING"
  | "INVALID_ORDER"
  | "TOPOLOGY_UNPROVEN"
  | "TOPOLOGY_CHANGED"
  | "INSUFFICIENT_CAPACITY";

export type CapacityReservationResult =
  | { ok: true; created: boolean }
  | { ok: false; reason: CapacityReservationRefusal; variantId: string | null };

async function readEdges(client: ReadClient, parentVariantIds: readonly string[]): Promise<CompositeEdgeFact[]> {
  if (parentVariantIds.length === 0) return [];
  return client.compositeComponentMirror.findMany({
    where: { parentVariantId: { in: [...parentVariantIds] } },
    orderBy: [{ parentVariantId: "asc" }, { componentVariantId: "asc" }],
    select: { parentVariantId: true, componentVariantId: true, quantity: true },
  });
}

/**
 * The edges needed to plan `variantIds`: their own component edges, plus any edges owned by those
 * components, so the planner can refuse nesting it has no evidence for.
 */
async function readPlanningEdges(client: ReadClient, variantIds: readonly string[]): Promise<CompositeEdgeFact[]> {
  const direct = await readEdges(client, variantIds);
  const componentIds = [...new Set(direct.map(({ componentVariantId }) => componentVariantId))];
  const nested = await readEdges(
    client,
    componentIds.filter((id) => !variantIds.includes(id)),
  );
  return [...direct, ...nested];
}

/**
 * Mirrored whole units and still-local holds for each resource variant.
 *
 * A hold counts until its resource has handed its accounting to the mirror (`mirroredAt`); there is
 * no other way out, so no timer, status label or retry can release capacity here.
 */
export async function readResourceFacts(
  client: ReadClient,
  resourceVariantIds: readonly string[],
): Promise<Map<string, ResourceCapacityFact>> {
  const facts = new Map<string, ResourceCapacityFact>();
  if (resourceVariantIds.length === 0) return facts;
  const ids = [...resourceVariantIds];

  const [variants, stocks, holds] = await Promise.all([
    client.variantMirror.findMany({
      where: { id: { in: ids } },
      select: { id: true, isPresent: true },
    }),
    client.warehouseStock.findMany({
      where: { variantId: { in: ids } },
      select: { variantId: true, quantity: true },
    }),
    client.$queryRaw<{ variantId: string; units: bigint }[]>(Prisma.sql`
      SELECT "variantId", SUM("quantity")::bigint AS "units"
      FROM "CapacityReservationResource"
      WHERE "variantId" IN (${Prisma.join(ids)})
        AND "mirroredAt" IS NULL
      GROUP BY "variantId"
    `),
  ]);

  const stockByVariant = new Map<string, number[]>();
  for (const stock of stocks) {
    const list = stockByVariant.get(stock.variantId) ?? [];
    list.push(stock.quantity);
    stockByVariant.set(stock.variantId, list);
  }
  const heldByVariant = new Map(holds.map(({ variantId, units }) => [variantId, Number(units)]));

  for (const variant of variants) {
    facts.set(variant.id, {
      // A variant the catalog no longer reports has no trustworthy stock to sell from.
      mirroredUnits: variant.isPresent ? wholeMirroredUnits(stockByVariant.get(variant.id) ?? []) : null,
      activeReservedUnits: heldByVariant.get(variant.id) ?? 0,
    });
  }
  return facts;
}

/**
 * Reserves every line of one order, all or none, inside the caller's transaction.
 *
 * Idempotent on the order: if this order already owns reservations, they are its capacity identity
 * and are returned unchanged rather than re-evaluated against a newer topology or stock.
 */
export async function reserveOrderCapacity(
  tx: Tx,
  { orderId, lines }: Readonly<{ orderId: string; lines: readonly Readonly<{ variantId: string; quantity: number }>[] }>,
): Promise<CapacityReservationResult> {
  const existing = await tx.capacityReservation.findFirst({ where: { orderId }, select: { id: true } });
  if (existing) return { ok: true, created: false };

  const requestedIds = [...new Set(lines.map(({ variantId }) => variantId))].sort();
  if (requestedIds.length === 0) return { ok: false, reason: "INVALID_ORDER", variantId: null };

  const locked = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT "id"
    FROM "VariantMirror"
    WHERE "id" IN (${Prisma.join(requestedIds)})
       OR "id" IN (
         SELECT "componentVariantId"
         FROM "CompositeComponentMirror"
         WHERE "parentVariantId" IN (${Prisma.join(requestedIds)})
       )
    ORDER BY "id"
    FOR UPDATE
  `);
  const lockedIds = new Set(locked.map(({ id }) => id));
  const missing = requestedIds.find((id) => !lockedIds.has(id));
  if (missing !== undefined) return { ok: false, reason: "VARIANT_MISSING", variantId: missing };

  // Topology and stock are read only now, after the lock is held.
  const plan = planCapacityResources(lines, await readPlanningEdges(tx, requestedIds));
  if (!plan.ok) {
    return {
      ok: false,
      reason: plan.reason === "INVALID_TOPOLOGY" ? "TOPOLOGY_UNPROVEN" : "INVALID_ORDER",
      variantId: plan.variantId,
    };
  }

  const resourceIds = [...new Set(plan.lines.flatMap((line) => line.resources.map(({ variantId }) => variantId)))];
  // A component edge that appeared between the lock statement and the post-lock read names a row this
  // transaction does not hold. Deciding on it would be deciding without the serialization the lock
  // exists to provide, so the caller retries from the start instead.
  const unlocked = resourceIds.find((id) => !lockedIds.has(id));
  if (unlocked !== undefined) return { ok: false, reason: "TOPOLOGY_CHANGED", variantId: unlocked };

  const decision = evaluatePlannedCapacity(plan.lines, await readResourceFacts(tx, resourceIds));
  if (!decision.ok) return { ok: false, reason: "INSUFFICIENT_CAPACITY", variantId: decision.variantId };

  for (const line of plan.lines) {
    await tx.capacityReservation.create({
      data: {
        orderId,
        variantId: line.variantId,
        quantity: line.quantity,
        resources: {
          create: line.resources.map((resource) => ({
            variantId: resource.variantId,
            kind: resource.kind,
            unitsPerLine: resource.unitsPerLine,
            quantity: resource.quantity,
          })),
        },
      },
    });
  }
  return { ok: true, created: true };
}

/**
 * Records that the exact Pancake order for this local order was accepted, in the caller's
 * transaction (the one that writes `CONFIRMED`). It does not release anything: confirmation proves
 * the external order exists, not that the mirror already reflects its stock consumption.
 */
export async function markOrderCapacityAccepted(tx: Tx, orderId: string, acceptedAt: Date): Promise<void> {
  await tx.capacityReservation.updateMany({
    where: { orderId, acceptedAt: null },
    data: { acceptedAt },
  });
}

/**
 * Hands accounting ownership to the mirror for every resource whose stock effect is now provably
 * included in `WarehouseStock`. Idempotent: a resource already handed off is never touched again, so
 * re-running a sync or this reconciliation cannot release twice or change a quantity.
 *
 * The causal proof, all of which must hold:
 *
 * 1. The owning line was accepted: `acceptedAt` is written with `CONFIRMED`, once the exact Pancake
 *    order id is stored on the order.
 * 2. The variant's stored stock observation started after that acceptance. `VariantMirror.syncedAt`
 *    is written only by catalog sync, together with the variant's `WarehouseStock` rows, and carries
 *    the instant sampled immediately before the sync's first Pancake request (`syncPancakeCatalog`).
 *    A read that started after acceptance cannot have missed an order Pancake had already saved; a
 *    read that started before it can, however late its result was stored, so that case keeps holding.
 * 3. The reviewed Pancake contract says that observation includes this resource's consumption:
 *    - SELF: a controlled live order moved the purchased variation's `remain_quantity` by exactly the
 *      ordered quantity when the order was saved (`docs/integrations/pancake.md`, all-warehouse stock
 *      semantics);
 *    - COMPONENT with one unit per set: Pancake decremented each child of a 1:1 composite on order
 *      save (same document, composite stock evidence);
 *    - COMPONENT with a multiplier above 1 has no such evidence yet, so it keeps holding. That is the
 *      conservative direction: temporary under-capacity, never an oversell window.
 *
 * A stock delta, elapsed time, or a local status alone is never evidence; nothing here reads them.
 */
export async function handOffMirroredCapacity(tx: Pick<Tx, "$executeRaw">, handedOffAt: Date): Promise<number> {
  return tx.$executeRaw(Prisma.sql`
    UPDATE "CapacityReservationResource" AS resource
    SET "mirroredAt" = ${handedOffAt},
        "mirrorObservationStartedAt" = variant."syncedAt"
    FROM "CapacityReservation" AS line, "VariantMirror" AS variant
    WHERE resource."reservationId" = line."id"
      AND variant."id" = resource."variantId"
      AND resource."mirroredAt" IS NULL
      AND line."acceptedAt" IS NOT NULL
      AND variant."syncedAt" > line."acceptedAt"
      AND (resource."kind" = 'SELF' OR resource."unitsPerLine" = 1)
  `);
}

/**
 * Advisory sellable units for storefront surfaces (PDP, cart, checkout snapshot). Reads the same
 * resource facts as the reservation path but takes no lock and grants nothing: checkout acceptance
 * is decided only by `reserveOrderCapacity`.
 *
 * A composite parent's own mirrored stock is ignored; its figure is the fewest whole sets its
 * components can still supply. Unprovable topology or an untrusted mirror advertises zero.
 */
export async function readAdvisorySellableUnits(
  client: ReadClient,
  variantIds: readonly string[],
): Promise<Map<string, number>> {
  const ids = [...new Set(variantIds)].sort();
  const result = new Map<string, number>();
  if (ids.length === 0) return result;

  const edges = await readPlanningEdges(client, ids);

  const resourceIds = new Set<string>();
  const plans = new Map<string, readonly Readonly<{ variantId: string; unitsPerLine: number }>[] | null>();
  for (const id of ids) {
    const plan = planCapacityResources([{ variantId: id, quantity: 1 }], edges);
    if (!plan.ok) {
      plans.set(id, null);
      continue;
    }
    const resources = plan.lines[0].resources.map(({ variantId, unitsPerLine }) => ({ variantId, unitsPerLine }));
    for (const resource of resources) resourceIds.add(resource.variantId);
    plans.set(id, resources);
  }

  const facts = await readResourceFacts(client, [...resourceIds]);
  for (const id of ids) {
    const resources = plans.get(id);
    result.set(
      id,
      resources
        ? advisorySellableUnits(resources.map(({ variantId, unitsPerLine }) => ({ unitsPerLine, fact: facts.get(variantId) })))
        : 0,
    );
  }
  return result;
}

/**
 * Replaces each variant's raw mirrored `sellableStock` with its advisory sellable units, so a card,
 * a cart line and a PDP option all advertise the same number for the same variant.
 */
export async function withAdvisorySellableStock<
  V extends Readonly<{ id: string; sellableStock: number }>,
  P extends Readonly<{ variants: readonly V[] }>,
>(client: ReadClient, products: readonly P[]): Promise<P[]> {
  const units = await readAdvisorySellableUnits(
    client,
    products.flatMap((product) => product.variants.map(({ id }) => id)),
  );
  return products.map((product) => ({
    ...product,
    variants: product.variants.map((variant) => ({ ...variant, sellableStock: units.get(variant.id) ?? 0 })),
  }));
}
