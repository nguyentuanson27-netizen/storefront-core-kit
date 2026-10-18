/**
 * Persistence for the curated New Arrivals selection (B01; design approved in
 * docs/approvals/core-kit-a-b-c-delegated-decisions-2026-10-18.md).
 *
 * This is the only module that reads or writes `NewArrivalsSelection`. The stored `position` is the
 * only ordering authority and pages are sliced by rank over it, so `createdAt` or catalog recency is
 * never a fallback.
 *
 * Writes replace the whole ordered selection in one transaction. The writer first takes a row lock on
 * the single state row, so concurrent admins serialize, and compares the revision the editor started
 * from, so a stale editor gets a refusal instead of silently overwriting a newer order. Positions are
 * rewritten densely (0..n-1); the position constraint is deferred to commit so a reorder may pass
 * through duplicate positions. The 500-slot ceiling is also a CHECK in the database.
 */

import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";

import { NEW_ARRIVALS_MAX_ITEMS, NEW_ARRIVALS_PAGE_SIZE } from "./new-arrivals-paging.ts";

type ReadClient = Pick<Prisma.TransactionClient, "newArrivalsSelection" | "newArrivalsSelectionState">;

export type NewArrivalsSlot = Readonly<{ productId: string; position: number }>;

export type ReplaceNewArrivalsRefusal =
  | "INVALID"
  | "TOO_MANY"
  | "DUPLICATE_PRODUCT"
  | "UNKNOWN_PRODUCT"
  | "STALE_REVISION";

export type ReplaceNewArrivalsResult =
  | Readonly<{ ok: true; revision: bigint }>
  | Readonly<{ ok: false; reason: ReplaceNewArrivalsRefusal }>;

export async function readNewArrivalsRevision(client: ReadClient): Promise<bigint> {
  const state = await client.newArrivalsSelectionState.findUnique({
    where: { id: "current" },
    select: { revision: true },
  });
  return state?.revision ?? BigInt(0);
}

export async function countNewArrivalsSelection(client: ReadClient): Promise<number> {
  return client.newArrivalsSelection.count();
}

/** The whole ordered selection, for the admin editor. Bounded by the 500-slot ceiling. */
export async function listNewArrivalsSelection(client: ReadClient): Promise<NewArrivalsSlot[]> {
  return client.newArrivalsSelection.findMany({
    orderBy: { position: "asc" },
    take: NEW_ARRIVALS_MAX_ITEMS,
    select: { productId: true, position: true },
  });
}

/**
 * Product ids of one page, by stored rank. `offset` and `limit` come from `computeNewArrivalsPaging`;
 * the limit is clamped here as well so no caller can turn this into an unbounded read.
 */
export async function readNewArrivalsPageProductIds(
  client: ReadClient,
  { offset, limit }: Readonly<{ offset: number; limit: number }>,
): Promise<string[]> {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit <= 0) return [];
  const rows = await client.newArrivalsSelection.findMany({
    orderBy: { position: "asc" },
    skip: offset,
    take: Math.min(limit, NEW_ARRIVALS_PAGE_SIZE),
    select: { productId: true },
  });
  return rows.map(({ productId }) => productId);
}

/**
 * Replaces the ordered selection with `productIds` (index = position), if `expectedRevision` is still
 * the current revision. An empty list clears the selection.
 */
export async function replaceNewArrivalsSelection(
  prisma: Pick<PrismaClient, "$transaction">,
  {
    productIds,
    expectedRevision,
    updatedByUserId,
  }: Readonly<{ productIds: readonly string[]; expectedRevision: bigint; updatedByUserId: string | null }>,
): Promise<ReplaceNewArrivalsResult> {
  if (
    !Array.isArray(productIds) ||
    typeof expectedRevision !== "bigint" ||
    productIds.some((id) => typeof id !== "string" || id.length === 0)
  ) {
    return { ok: false, reason: "INVALID" };
  }
  if (productIds.length > NEW_ARRIVALS_MAX_ITEMS) return { ok: false, reason: "TOO_MANY" };
  if (new Set(productIds).size !== productIds.length) return { ok: false, reason: "DUPLICATE_PRODUCT" };

  return prisma.$transaction(async (tx): Promise<ReplaceNewArrivalsResult> => {
    // Serialize writers on the one state row; creating it is idempotent.
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "NewArrivalsSelectionState" ("id", "revision", "updatedAt")
      VALUES ('current', 0, CURRENT_TIMESTAMP)
      ON CONFLICT ("id") DO NOTHING
    `);
    const locked = await tx.$queryRaw<{ revision: bigint }[]>(Prisma.sql`
      SELECT "revision" FROM "NewArrivalsSelectionState" WHERE "id" = 'current' FOR UPDATE
    `);
    const current = locked[0]?.revision ?? BigInt(0);
    if (current !== expectedRevision) return { ok: false, reason: "STALE_REVISION" };

    if (productIds.length > 0) {
      const known = await tx.productMirror.count({ where: { id: { in: [...productIds] } } });
      if (known !== productIds.length) return { ok: false, reason: "UNKNOWN_PRODUCT" };
    }

    await tx.newArrivalsSelection.deleteMany({ where: { productId: { notIn: [...productIds] } } });

    const existing = new Set(
      (await tx.newArrivalsSelection.findMany({ select: { productId: true } })).map(({ productId }) => productId),
    );
    // Positions are unique only at commit, so updates and inserts may overlap in any order.
    for (const [position, productId] of productIds.entries()) {
      if (existing.has(productId)) {
        await tx.newArrivalsSelection.update({
          where: { productId },
          data: { position, updatedByUserId },
        });
      } else {
        await tx.newArrivalsSelection.create({ data: { productId, position, updatedByUserId } });
      }
    }

    const next = current + BigInt(1);
    await tx.newArrivalsSelectionState.update({ where: { id: "current" }, data: { revision: next } });
    return { ok: true, revision: next };
  });
}
