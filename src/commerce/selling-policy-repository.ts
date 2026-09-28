/**
 * Persistence for the website-owned selling policy (spec: docs/specs/core-kit-selling-modes-v1.md §4, §7.2).
 *
 * This is the only module that reads `ProductSellingPolicy` (a domain test enforces it), so every
 * consumer receives stored rows through here and interprets them through `effectivePolicy()`.
 *
 * Writes serialize with checkout. A policy change locks the product's `VariantMirror` rows `FOR
 * UPDATE` in ascending id order — the order `reserveOrderCapacity` locks in — and upserts in the same
 * transaction. A checkout already holding those rows finishes under the policy it read; the change
 * waits, then the next checkout sees it. No decision is ever made against a half-applied change.
 */

import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";

import {
  effectivePolicy,
  type EffectiveSellingPolicy,
  type SellingMode,
  type SellingModeFlags,
  type SellingPolicyChange,
  type StoredSellingPolicy,
} from "./selling-policy.ts";

type PolicyReadClient = Pick<Prisma.TransactionClient, "productSellingPolicy">;

/** Stored rows by product id. A product absent from the map has no row, which means the default. */
export async function readStoredSellingPolicies(
  client: PolicyReadClient,
  productIds: readonly string[],
): Promise<Map<string, StoredSellingPolicy>> {
  const ids = [...new Set(productIds)];
  const result = new Map<string, StoredSellingPolicy>();
  if (ids.length === 0) return result;

  const rows = await client.productSellingPolicy.findMany({
    where: { productId: { in: ids } },
    select: { productId: true, sellingMode: true, negativeStockLimit: true },
  });
  for (const row of rows) {
    result.set(row.productId, { sellingMode: row.sellingMode, negativeStockLimit: row.negativeStockLimit });
  }
  return result;
}

/**
 * The effective policy for each purchased variant, keyed by variant id (spec §4.2.1, §7.1).
 *
 * Checkout calls this inside its transaction after locking the variants' `VariantMirror` rows; the
 * policy writer locks the same rows first, so what this returns is the policy committed before the
 * lock, never a half-applied change. A variant this cannot find resolves to the default policy; the
 * caller refuses a missing variant on its own terms.
 */
export async function readEffectiveSellingPolicies(
  client: PolicyReadClient & Pick<Prisma.TransactionClient, "variantMirror">,
  variantIds: readonly string[],
  flags: SellingModeFlags,
): Promise<Map<string, EffectiveSellingPolicy>> {
  const ids = [...new Set(variantIds)];
  const result = new Map<string, EffectiveSellingPolicy>();
  if (ids.length === 0) return result;

  const variants = await client.variantMirror.findMany({
    where: { id: { in: ids } },
    select: { id: true, productId: true },
  });
  const productByVariant = new Map(variants.map(({ id, productId }) => [id, productId]));
  const stored = await readStoredSellingPolicies(client, [...new Set(productByVariant.values())]);
  for (const id of ids) {
    const productId = productByVariant.get(id);
    result.set(id, effectivePolicy(productId === undefined ? null : stored.get(productId), flags));
  }
  return result;
}

/**
 * For a read bound by a database round-trip budget (the Merchant feed): the policy as a `LEFT JOIN`
 * onto a query that already reads products, instead of a separate read. The SQL text stays here, so
 * this module remains the table's only reader; the caller turns each row back into a stored policy
 * with `storedPolicyFromJoinedRow` and interprets it only through `effectivePolicy()`.
 *
 * `productIdColumn` must be a trusted column reference such as `p."id"`, never input.
 */
export function sellingPolicyJoinSql(productIdColumn: string): Readonly<{ join: string; columns: string }> {
  return {
    join: `LEFT JOIN "ProductSellingPolicy" sp ON sp."productId" = ${productIdColumn}`,
    columns: `sp."sellingMode"::text AS "sellingPolicyMode", sp."negativeStockLimit" AS "sellingPolicyLimit"`,
  };
}

export function storedPolicyFromJoinedRow(
  row: Readonly<{ sellingPolicyMode?: string | null; sellingPolicyLimit?: number | null }>,
): StoredSellingPolicy | null {
  if (row.sellingPolicyMode === null || row.sellingPolicyMode === undefined) return null;
  return { sellingMode: row.sellingPolicyMode, negativeStockLimit: Number(row.sellingPolicyLimit) };
}

/** A product with a stored policy, and its variants, for the operator report (§10.3). */
export type SellingPolicyProductRow = Readonly<{
  productId: string;
  productSlug: string;
  stored: StoredSellingPolicy;
  updatedAt: Date;
  variants: readonly Readonly<{ variantId: string; isCompositeParent: boolean }>[];
}>;

export function createSellingPolicyRepository(client: PrismaClient) {
  async function productExists(productId: string): Promise<boolean> {
    return (await client.productMirror.findUnique({ where: { id: productId }, select: { id: true } })) !== null;
  }

  /** Whether any variant of the product is a composite parent: those sell `STANDARD` only (§6.1). */
  async function productHasCompositeParent(productId: string): Promise<boolean> {
    const edge = await client.compositeComponentMirror.findFirst({
      where: { parentVariant: { productId } },
      select: { parentVariantId: true },
    });
    return edge !== null;
  }

  async function readStoredPolicy(productId: string): Promise<StoredSellingPolicy | null> {
    return (await readStoredSellingPolicies(client, [productId])).get(productId) ?? null;
  }

  /**
   * Applies an admin change under the checkout lock order (§7.2). `RESET` deletes the row, returning
   * the product to the resolver's default rather than storing a copy of it.
   */
  async function saveSellingPolicy(
    productId: string,
    change: SellingPolicyChange,
    actorUserId: string,
  ): Promise<void> {
    await client.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "VariantMirror"
        WHERE "productId" = ${productId}
        ORDER BY "id"
        FOR UPDATE
      `);

      if (change.kind === "RESET") {
        await tx.productSellingPolicy.deleteMany({ where: { productId } });
        return;
      }

      const data: { sellingMode: SellingMode; negativeStockLimit: number; updatedByUserId: string } = {
        sellingMode: change.sellingMode,
        negativeStockLimit: change.negativeStockLimit,
        updatedByUserId: actorUserId,
      };
      await tx.productSellingPolicy.upsert({
        where: { productId },
        create: { productId, ...data },
        update: data,
        select: { productId: true },
      });
    });
  }

  /** Every product with a stored row, with its variants (§10.3). Capacity is added by the report. */
  async function readStoredPolicyProducts(): Promise<SellingPolicyProductRow[]> {
    const rows = await client.productSellingPolicy.findMany({
      orderBy: { productId: "asc" },
      select: {
        productId: true,
        sellingMode: true,
        negativeStockLimit: true,
        updatedAt: true,
        product: {
          select: {
            slug: true,
            variants: {
              orderBy: { id: "asc" },
              select: { id: true, compositeComponents: { select: { componentVariantId: true }, take: 1 } },
            },
          },
        },
      },
    });

    return rows.map((row) => ({
      productId: row.productId,
      productSlug: row.product.slug,
      stored: { sellingMode: row.sellingMode, negativeStockLimit: row.negativeStockLimit },
      updatedAt: row.updatedAt,
      variants: row.product.variants.map((variant) => ({
        variantId: variant.id,
        isCompositeParent: variant.compositeComponents.length > 0,
      })),
    }));
  }

  return {
    productExists,
    productHasCompositeParent,
    readStoredPolicy,
    saveSellingPolicy,
    readStoredPolicyProducts,
  };
}
