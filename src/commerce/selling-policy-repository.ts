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

import { readAdvisoryCapacityResources, type AdvisoryCapacityResource } from "./capacity-reservation-repository.ts";
import type { SellingMode, SellingPolicyChange, StoredSellingPolicy } from "./selling-policy.ts";

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

export type SellingPolicyReportVariant = Readonly<{
  variantId: string;
  isCompositeParent: boolean;
  /**
   * What one unit of this variant consumes, read exactly as the storefront's advisory capacity is:
   * its own stock when standalone, its components when a composite parent (whose own mirrored stock
   * is never consulted). `null` when the topology cannot be proven.
   */
  capacityResources: readonly AdvisoryCapacityResource[] | null;
}>;

export type SellingPolicyReportRow = Readonly<{
  productId: string;
  productSlug: string;
  stored: StoredSellingPolicy;
  updatedAt: Date;
  variants: readonly SellingPolicyReportVariant[];
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

  /** Every product with a stored row, with the capacity facts the operator report prints (§10.3). */
  async function readSellingPolicyReport(): Promise<SellingPolicyReportRow[]> {
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

    const capacity = await readAdvisoryCapacityResources(
      client,
      rows.flatMap((row) => row.product.variants.map((variant) => variant.id)),
    );

    return rows.map((row) => ({
      productId: row.productId,
      productSlug: row.product.slug,
      stored: { sellingMode: row.sellingMode, negativeStockLimit: row.negativeStockLimit },
      updatedAt: row.updatedAt,
      variants: row.product.variants.map((variant) => ({
        variantId: variant.id,
        isCompositeParent: variant.compositeComponents.length > 0,
        capacityResources: capacity.get(variant.id) ?? null,
      })),
    }));
  }

  return {
    productExists,
    productHasCompositeParent,
    readStoredPolicy,
    saveSellingPolicy,
    readSellingPolicyReport,
  };
}
