import type { PrismaClient } from "../generated/prisma/client.ts";
import { readAdvisoryVariantCapacity, toAdvisoryStockFields } from "./capacity-reservation-repository.ts";
import { readSellingModeFlags, type SellingModeFlags } from "./selling-policy.ts";
import { createStorefrontCatalogRepository } from "./storefront-catalog.ts";
import {
  buildStorefrontProductProjection,
  type StorefrontCompositeComponentGroup,
} from "./storefront-projection.ts";
import type { StorefrontVariantFacts } from "./storefront-product.ts";
import { buildPromotionalStorefrontPricing } from "./storefront-promotion-projection.ts";
import { readApplicablePromotionCampaignsBatched } from "./promotion-candidate-batching.ts";

function sumWarehouseStocks(stocks: readonly { quantity: number }[]): number {
  let total = 0;
  for (const stock of stocks) {
    if (!Number.isFinite(stock.quantity)) {
      throw new Error("Storefront projection contains malformed warehouse quantity");
    }
    total += stock.quantity;
    if (!Number.isFinite(total)) {
      throw new Error("Storefront projection stock total is outside numeric bounds");
    }
  }
  return total;
}

export function createStorefrontProductDetailRepository(
  client: PrismaClient,
  options: Readonly<{ sellingModeFlags?: SellingModeFlags }> = {},
) {
  const sellingModeFlags = options.sellingModeFlags ?? readSellingModeFlags();
  const catalog = createStorefrontCatalogRepository(client, { sellingModeFlags });

  async function getProductBySlug({
    shopId,
    slug,
    now = new Date(),
  }: { shopId: number; slug: string; now?: Date }) {
    const product = await catalog.getProductBySlug({ shopId, slug });
    if (!product) return null;

    const parentRelations = await client.variantMirror.findMany({
      where: {
        productId: product.id,
        isPresent: true,
        isActive: true,
      },
      orderBy: [{ pancakeVariationId: "asc" }],
      select: {
        id: true,
        pancakeDisplayId: true,
        sku: true,
        compositeComponents: {
          orderBy: [{ componentVariantId: "asc" }],
          select: {
            componentVariant: {
              select: {
                id: true,
                pancakeVariationId: true,
                color: true,
                size: true,
                isPresent: true,
                isActive: true,
                pancakeRetailPrice: true,
                pancakeRetailPriceAfterDiscount: true,
                product: {
                  select: {
                    id: true,
                    name: true,
                    pancakeShopId: true,
                    isPresent: true,
                  },
                },
                warehouseStocks: {
                  orderBy: [{ pancakeWarehouseId: "asc" }],
                  select: { quantity: true },
                },
              },
            },
          },
        },
      },
    });

    const hasCompositeGraph = parentRelations.some(
      (parent) => parent.compositeComponents.length > 0,
    );
    const groups = new Map<
      string,
      { label: string; variants: Map<string, StorefrontVariantFacts> }
    >();

    for (const parent of parentRelations) {
      for (const edge of parent.compositeComponents) {
        const component = edge.componentVariant;
        if (
          component.product.pancakeShopId !== shopId ||
          !component.product.isPresent ||
          !component.isPresent ||
          !component.isActive
        ) {
          continue;
        }

        let group = groups.get(component.product.id);
        if (!group) {
          group = { label: component.product.name, variants: new Map() };
          groups.set(component.product.id, group);
        }
        if (!group.variants.has(component.id)) {
          group.variants.set(component.id, {
            id: component.id,
            pancakeVariationId: component.pancakeVariationId,
            color: component.color,
            size: component.size,
            sellableStock: sumWarehouseStocks(component.warehouseStocks),
            retailPrice: component.pancakeRetailPrice,
            retailPriceAfterDiscount: component.pancakeRetailPriceAfterDiscount,
          });
        }
      }
    }

    const componentGroups: StorefrontCompositeComponentGroup[] = [...groups.values()]
      .sort((left, right) => left.label.localeCompare(right.label, "vi"))
      .map((group) => ({
        label: group.label,
        variants: [...group.variants.values()],
      }));

    const pricedVariantIds = [
      ...new Set([
        ...product.variants.map((variant) => variant.id),
        ...componentGroups.flatMap((group) => group.variants.map((variant) => variant.id)),
      ]),
    ];
    // Keep every DB query inside the candidate repository's 200-id safety cap, while resolving the
    // complete PDP projection. This is bounded batching, not a per-option lookup.
    const { campaignsByVariantId } = await readApplicablePromotionCampaignsBatched({
      variantIds: pricedVariantIds,
    });
    // The purchase panel advertises what the capacity read model says is free: a set is offered only
    // as many times as its components can still supply, and units other orders hold are not free.
    const capacity = await readAdvisoryVariantCapacity(client, pricedVariantIds, sellingModeFlags);
    const withAdvisoryStock = <T extends { id: string; sellableStock: number }>(variant: T): T => ({
      ...variant,
      ...toAdvisoryStockFields(capacity.get(variant.id)),
    });

    return {
      ...product,
      // ADR 0008: the mirrored Pancake `display_id` is the manufacturer MPN authority. Keep this
      // server-only map separate from `projection.options` so the purchase-panel client contract does
      // not grow a Merchant/SEO-only fact just to let JSON-LD identify each variant.
      variantMpnById: Object.fromEntries(
        parentRelations.map((variant) => [variant.id, variant.pancakeDisplayId]),
      ),
      // U32a: the website-owned SKU, kept in its own server-only map for the same reason. It rides
      // the select that already read this row, so publishing it costs no additional query. It is a
      // different fact from the MPN above and must never be substituted for it.
      variantSkuById: Object.fromEntries(
        parentRelations.map((variant) => [variant.id, variant.sku]),
      ),
      projection: buildStorefrontProductProjection({
        parentVariants: product.variants.map(withAdvisoryStock),
        componentGroups: componentGroups.map((group) => ({
          ...group,
          variants: group.variants.map(withAdvisoryStock),
        })),
        hasCompositeGraph,
        // The PDP's price authority. Passing the default rule here would quietly un-promote every
        // surface built from this projection — the panel, and the variant structured data that
        // reads the same options. That wiring is gated by `tests/a11y-runtime/pdp-promotion.spec.ts`
        // (a rendering fact, so it lives in the browser suite); the domain suites cover what each
        // consumer does with the options, not which rule produced them.
        pricingRule: buildPromotionalStorefrontPricing({ campaignsByVariantId, now }),
      }),
    };
  }

  return { getProductBySlug };
}

export async function countProjectedCompositeParentVariations(
  client: PrismaClient,
  shopId: number,
): Promise<number> {
  return client.variantMirror.count({
    where: {
      product: { pancakeShopId: shopId },
      compositeComponents: { some: {} },
    },
  });
}
