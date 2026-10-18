/**
 * Persistence for the homepage featured selection (B04; design approved in
 * docs/approvals/core-kit-a-b-c-delegated-decisions-2026-10-18.md).
 *
 * Same construction as the curated new-arrivals repository, with a ceiling of 12: the only module
 * that reads or writes `HomepageFeaturedProduct`; stored `position` is the only ordering authority;
 * writes replace the ordered list in one transaction after row-locking the state row and comparing
 * the editor's revision. Independent of collections -- nothing here reads `CollectionDefinition`.
 */

import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";

import type { ReplaceNewArrivalsResult as ReplaceResult } from "./new-arrivals-selection-repository.ts";

/** Owner-approved ceiling; the database CHECK enforces the same number. */
export const HOMEPAGE_FEATURED_MAX_ITEMS = 12;

type ReadClient = Pick<Prisma.TransactionClient, "homepageFeaturedProduct" | "homepageFeaturedState">;

export type HomepageFeaturedSlot = Readonly<{ productId: string; position: number }>;

export async function readHomepageFeaturedRevision(client: ReadClient): Promise<bigint> {
  const state = await client.homepageFeaturedState.findUnique({
    where: { id: "current" },
    select: { revision: true },
  });
  return state?.revision ?? BigInt(0);
}

/** The whole ordered selection. Bounded by the 12-slot ceiling. */
export async function listHomepageFeatured(client: ReadClient): Promise<HomepageFeaturedSlot[]> {
  return client.homepageFeaturedProduct.findMany({
    orderBy: { position: "asc" },
    take: HOMEPAGE_FEATURED_MAX_ITEMS,
    select: { productId: true, position: true },
  });
}

export async function replaceHomepageFeatured(
  prisma: Pick<PrismaClient, "$transaction">,
  {
    productIds,
    expectedRevision,
    updatedByUserId,
  }: Readonly<{ productIds: readonly string[]; expectedRevision: bigint; updatedByUserId: string | null }>,
): Promise<ReplaceResult> {
  if (
    !Array.isArray(productIds) ||
    typeof expectedRevision !== "bigint" ||
    productIds.some((id) => typeof id !== "string" || id.length === 0)
  ) {
    return { ok: false, reason: "INVALID" };
  }
  if (productIds.length > HOMEPAGE_FEATURED_MAX_ITEMS) return { ok: false, reason: "TOO_MANY" };
  if (new Set(productIds).size !== productIds.length) return { ok: false, reason: "DUPLICATE_PRODUCT" };

  return prisma.$transaction(async (tx): Promise<ReplaceResult> => {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "HomepageFeaturedState" ("id", "revision", "updatedAt")
      VALUES ('current', 0, CURRENT_TIMESTAMP)
      ON CONFLICT ("id") DO NOTHING
    `);
    const locked = await tx.$queryRaw<{ revision: bigint }[]>(Prisma.sql`
      SELECT "revision" FROM "HomepageFeaturedState" WHERE "id" = 'current' FOR UPDATE
    `);
    const current = locked[0]?.revision ?? BigInt(0);
    if (current !== expectedRevision) return { ok: false, reason: "STALE_REVISION" };

    if (productIds.length > 0) {
      const known = await tx.productMirror.count({ where: { id: { in: [...productIds] } } });
      if (known !== productIds.length) return { ok: false, reason: "UNKNOWN_PRODUCT" };
    }

    await tx.homepageFeaturedProduct.deleteMany({ where: { productId: { notIn: [...productIds] } } });
    const existing = new Set(
      (await tx.homepageFeaturedProduct.findMany({ select: { productId: true } })).map(({ productId }) => productId),
    );
    for (const [position, productId] of productIds.entries()) {
      if (existing.has(productId)) {
        await tx.homepageFeaturedProduct.update({ where: { productId }, data: { position, updatedByUserId } });
      } else {
        await tx.homepageFeaturedProduct.create({ data: { productId, position, updatedByUserId } });
      }
    }

    const next = current + BigInt(1);
    await tx.homepageFeaturedState.update({ where: { id: "current" }, data: { revision: next } });
    return { ok: true, revision: next };
  });
}
