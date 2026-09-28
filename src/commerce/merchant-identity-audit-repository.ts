/**
 * Bounded read-only source for the M1 identity audit.
 *
 * `pancakeBarcode` is deliberately not selected: reading it would invite a later change to treat it
 * as a GTIN, which the spec forbids without proof of identifier type, format and check digit.
 *
 * Manufacturer MPN is audited from mirrored `pancakeDisplayId`. `VariantMirror.sku` is a distinct
 * website-owned field and is intentionally not selected or mutated by this read-only M1 path.
 */

import { prisma } from "../db/prisma.ts";

import { MAX_MEDIA_CANDIDATES_SCANNED } from "./product-media.ts";
import type { MerchantIdentityRow } from "./merchant-identity-audit.ts";
import { effectivePolicy, readSellingModeFlags, type SellingModeFlags } from "./selling-policy.ts";
import { readEffectiveSellingPolicies } from "./selling-policy-repository.ts";
import { resolvePublishableVariantStock } from "./selling-mode-publication.ts";

export const MAX_AUDITED_VARIATIONS = 50_000;

export class MerchantIdentityAuditError extends Error {}

/**
 * Mirrors storefront-catalog's JSON-string-array boundary while bounding the copied per-product
 * candidate list after Prisma has materialized the selected row JSON. The storefront resolver scans
 * at most MAX_MEDIA_CANDIDATES_SCANNED inputs, so copying more candidates cannot change its result.
 */
function appendBoundedVariantImageUrls(target: string[], raw: unknown): void {
  if (!Array.isArray(raw) || target.length >= MAX_MEDIA_CANDIDATES_SCANNED) return;

  for (const item of raw) {
    if (target.length >= MAX_MEDIA_CANDIDATES_SCANNED) return;
    if (typeof item === "string") target.push(item);
  }
}

export async function readMerchantIdentityRows(
  pancakeShopId: number,
  options: Readonly<{ sellingModeFlags?: SellingModeFlags }> = {},
): Promise<MerchantIdentityRow[]> {
  const sellingModeFlags = options.sellingModeFlags ?? readSellingModeFlags();
  if (!Number.isSafeInteger(pancakeShopId) || pancakeShopId <= 0) {
    throw new MerchantIdentityAuditError("Pancake shop id must be a positive safe integer");
  }

  const rows = await prisma.variantMirror.findMany({
    where: { product: { pancakeShopId } },
    select: {
      id: true,
      pancakeVariationId: true,
      pancakeDisplayId: true,
      isPresent: true,
      isActive: true,
      pancakeRetailPrice: true,
      pancakeRetailPriceAfterDiscount: true,
      pancakeImageUrls: true,
      // Availability is a Merchant fact, so it is summed here rather than treated as an exclusion.
      warehouseStocks: { select: { quantity: true } },
      product: {
        select: {
          id: true,
          pancakeProductId: true,
          isPresent: true,
          isActive: true,
          name: true,
          primaryImageUrl: true,
          // Only a PUBLISHED description is a fact the storefront would show, so only that is a
          // Merchant fact; a Draft is work in progress and auditing it would overstate readiness.
          content: { select: { status: true, editorialDescription: true } },
        },
      },
      // Composite is either side of the graph. A variation that *is* a set is as deferred as one
      // that belongs to a set: Merchant v1 defers all composite projections.
      compositeParents: { select: { parentVariantId: true }, take: 1 },
      compositeComponents: { select: { componentVariantId: true }, take: 1 },
    },
    // This is also the storefront's variant-media order. Grouping the bounded result below therefore
    // preserves pancakeVariationId ASC within every product without issuing one sibling query/row.
    orderBy: { pancakeVariationId: "asc" },
    take: MAX_AUDITED_VARIATIONS + 1,
  });

  if (rows.length > MAX_AUDITED_VARIATIONS) {
    throw new MerchantIdentityAuditError(
      `Catalog exceeds the audited bound of ${MAX_AUDITED_VARIATIONS} variations; raise it deliberately rather than truncating evidence`,
    );
  }

  // The same stock rule as the Merchant feed (selling modes spec §9): under OVERSELL / PREORDER a
  // negative mirrored row is the expected state, not a defect.
  const policies = await readEffectiveSellingPolicies(prisma, rows.map(({ id }) => id), sellingModeFlags);

  const activeVariantImagesByProductId = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.isPresent || !row.isActive || !row.product.isPresent || !row.product.isActive) continue;

    const existing = activeVariantImagesByProductId.get(row.product.id) ?? [];
    appendBoundedVariantImageUrls(existing, row.pancakeImageUrls);
    if (existing.length > 0 && !activeVariantImagesByProductId.has(row.product.id)) {
      activeVariantImagesByProductId.set(row.product.id, existing);
    }
  }

  return rows.map((row) => ({
    pancakeVariationId: row.pancakeVariationId,
    pancakeProductId: row.product.pancakeProductId,
    // Historical summary key `sku` means candidate manufacturer MPN. Source it from the mirrored
    // Pancake display_id, never from website-owned VariantMirror.sku.
    sku: row.pancakeDisplayId,
    isComposite: row.compositeParents.length > 0 || row.compositeComponents.length > 0,
    isStorefrontVisible:
      row.isPresent && row.isActive && row.product.isPresent && row.product.isActive,
    retailPrice: row.pancakeRetailPrice,
    retailPriceAfterDiscount: row.pancakeRetailPriceAfterDiscount,
    // Reject the whole availability fact when any source row is invalid; summing first would let a
    // positive warehouse hide a negative mirrored quantity (for example -3 + 4 => 1). Holds are not
    // part of this identity audit, as before.
    stockQuantity: resolvePublishableVariantStock(
      row.warehouseStocks.map((stock) => stock.quantity),
      0,
      policies.get(row.id) ?? effectivePolicy(null, sellingModeFlags),
    ).stockQuantity,
    primaryImageUrl: row.product.primaryImageUrl,
    // Product-level storefront semantics: every active/present sibling gets the same ordered,
    // bounded post-query variant-image candidate set. Hidden/inactive siblings never contribute.
    variantImageUrls: activeVariantImagesByProductId.get(row.product.id) ?? [],
    title: row.product.name,
    publishedDescription: row.product.content?.status === "PUBLISHED"
      ? row.product.content.editorialDescription
      : null,
  }));
}
