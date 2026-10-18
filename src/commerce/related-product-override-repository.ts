/**
 * Persistence for the manual related-products override (B05; design approved in
 * docs/approvals/core-kit-a-b-c-delegated-decisions-2026-10-18.md).
 *
 * The only module that reads or writes `RelatedProductOverride`. A write replaces one product's whole
 * ordered list in a single transaction after row-locking that product, so two editors of the same
 * product serialize and never interleave. There is deliberately no revision token: the list is at
 * most 8 short rows owned by one product page, so the last writer wins, and the page shows the
 * result of every save.
 */

import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";

import { RELATED_OVERRIDE_MAX_ITEMS } from "./related-product-override.ts";

type ReadClient = Pick<Prisma.TransactionClient, "relatedProductOverride">;

export type ReplaceRelatedOverrideRefusal =
  | "INVALID"
  | "TOO_MANY"
  | "DUPLICATE_PRODUCT"
  | "SELF_REFERENCE"
  | "UNKNOWN_PRODUCT";

export type ReplaceRelatedOverrideResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: ReplaceRelatedOverrideRefusal }>;

/** The stored related product ids of one product, in stored order. Bounded by the ceiling. */
export async function readRelatedOverrideIds(client: ReadClient, productId: string): Promise<string[]> {
  const rows = await client.relatedProductOverride.findMany({
    where: { productId },
    orderBy: { position: "asc" },
    take: RELATED_OVERRIDE_MAX_ITEMS,
    select: { relatedProductId: true },
  });
  return rows.map(({ relatedProductId }) => relatedProductId);
}

export async function replaceRelatedOverrides(
  prisma: Pick<PrismaClient, "$transaction">,
  {
    productId,
    relatedProductIds,
    updatedByUserId,
  }: Readonly<{ productId: string; relatedProductIds: readonly string[]; updatedByUserId: string | null }>,
): Promise<ReplaceRelatedOverrideResult> {
  if (
    typeof productId !== "string" ||
    productId.length === 0 ||
    !Array.isArray(relatedProductIds) ||
    relatedProductIds.some((id) => typeof id !== "string" || id.length === 0)
  ) {
    return { ok: false, reason: "INVALID" };
  }
  if (relatedProductIds.length > RELATED_OVERRIDE_MAX_ITEMS) return { ok: false, reason: "TOO_MANY" };
  if (new Set(relatedProductIds).size !== relatedProductIds.length) {
    return { ok: false, reason: "DUPLICATE_PRODUCT" };
  }
  if (relatedProductIds.includes(productId)) return { ok: false, reason: "SELF_REFERENCE" };

  return prisma.$transaction(async (tx): Promise<ReplaceRelatedOverrideResult> => {
    // Serialize editors of this product; also proves the product exists.
    const locked = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id" FROM "ProductMirror" WHERE "id" = ${productId} FOR UPDATE
    `);
    if (locked.length === 0) return { ok: false, reason: "UNKNOWN_PRODUCT" };

    if (relatedProductIds.length > 0) {
      const known = await tx.productMirror.count({ where: { id: { in: [...relatedProductIds] } } });
      if (known !== relatedProductIds.length) return { ok: false, reason: "UNKNOWN_PRODUCT" };
    }

    await tx.relatedProductOverride.deleteMany({
      where: { productId, relatedProductId: { notIn: [...relatedProductIds] } },
    });
    const existing = new Set(
      (
        await tx.relatedProductOverride.findMany({ where: { productId }, select: { relatedProductId: true } })
      ).map(({ relatedProductId }) => relatedProductId),
    );
    for (const [position, relatedProductId] of relatedProductIds.entries()) {
      if (existing.has(relatedProductId)) {
        await tx.relatedProductOverride.update({
          where: { productId_relatedProductId: { productId, relatedProductId } },
          data: { position, updatedByUserId },
        });
      } else {
        await tx.relatedProductOverride.create({
          data: { productId, relatedProductId, position, updatedByUserId },
        });
      }
    }
    return { ok: true };
  });
}
