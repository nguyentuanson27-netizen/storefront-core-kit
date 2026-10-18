import { prisma } from "../db/prisma.ts";
import { readPancakeShopId } from "../integrations/pancake/config.ts";
import { createFlashSaleCatalogRepository } from "./flash-sale-catalog.ts";
import { createStorefrontCatalogRepository } from "./storefront-catalog.ts";
import {
  parseStorefrontDiscoverySearchParams,
  type StorefrontDiscoveryQuery,
} from "./storefront-discovery.ts";
import { createStorefrontProductDetailRepository } from "./storefront-product-detail.ts";
import { readRelatedOverrideIds } from "./related-product-override-repository.ts";
import {
  readRelatedOverrideEnabled,
  selectRelatedOverride,
} from "./related-product-override.ts";
import { listRelatedStorefrontProducts } from "./storefront-related-products.ts";
import { createStorefrontProductSlugResolver } from "./storefront-product-slug-resolution.ts";
import { readApplicablePromotionCampaignsBatched } from "./promotion-candidate-batching.ts";
import { resolveStorefrontPromotionRefreshFromCampaigns } from "./storefront-promotion-freshness.ts";
import { buildPromotionalStorefrontPricing } from "./storefront-promotion-projection.ts";
import { defaultStorefrontPricingRule, type StorefrontPricingRule } from "./storefront-product.ts";

type StorefrontPromotionProduct = Readonly<{
  variants: readonly Readonly<{ id: string }>[];
  /** PDP projections can contain composite-component variants not present in the parent list. */
  projection?: Readonly<{ options: readonly Readonly<{ id: string }>[] }>;
}>;

export async function resolveStorefrontPromotionForProducts({
  products,
  now = new Date(),
}: {
  products: readonly StorefrontPromotionProduct[];
  now?: Date;
}): Promise<Readonly<{ pricingRule: StorefrontPricingRule; refreshAfterMs: number }>> {
  const variantIds = products.flatMap((product) =>
    (product.projection?.options ?? product.variants).map((variant) => variant.id),
  );
  if (variantIds.length === 0) {
    return Object.freeze({
      pricingRule: defaultStorefrontPricingRule,
      refreshAfterMs: resolveStorefrontPromotionRefreshFromCampaigns({ now, campaigns: [] }).refreshAfterMs,
    });
  }
  const { campaignsByVariantId } = await readApplicablePromotionCampaignsBatched({
    variantIds,
  });
  const campaigns = [...campaignsByVariantId.values()].flat();
  return Object.freeze({
    pricingRule: buildPromotionalStorefrontPricing({ campaignsByVariantId, now }),
    refreshAfterMs: resolveStorefrontPromotionRefreshFromCampaigns({ now, campaigns }).refreshAfterMs,
  });
}

export async function resolveStorefrontPricingRuleForProducts({
  products,
  now = new Date(),
}: {
  products: readonly StorefrontPromotionProduct[];
  now?: Date;
}): Promise<StorefrontPricingRule> {
  return (await resolveStorefrontPromotionForProducts({ products, now })).pricingRule;
}

export async function listConfiguredStorefrontProducts(limit: number) {
  const shopId = readPancakeShopId();
  return createStorefrontCatalogRepository(prisma).listProducts({ shopId, limit });
}

export async function listConfiguredStorefrontProductPage({
  page,
  pageSize,
}: {
  page: number;
  pageSize: number;
}) {
  const shopId = readPancakeShopId();
  return createStorefrontCatalogRepository(prisma).listProductPage({ shopId, page, pageSize });
}

export async function listConfiguredStorefrontProductsByIds({
  productIds,
  now,
}: {
  productIds: readonly string[];
  now?: Date;
}) {
  const shopId = readPancakeShopId();
  return createStorefrontCatalogRepository(prisma).listProductsByIds({ shopId, productIds, now });
}

export async function listConfiguredStorefrontDiscoveryPage({
  discovery,
  pageSize,
  now,
}: {
  discovery: StorefrontDiscoveryQuery;
  pageSize: number;
  /** The caller's request clock, so counting, ordering and card pricing share one instant. */
  now?: Date;
}) {
  const shopId = readPancakeShopId();
  return createStorefrontCatalogRepository(prisma).listDiscoveryPage({
    shopId,
    discovery,
    pageSize,
    now,
  });
}

export async function listConfiguredFlashSalePage({
  discovery,
  pageSize,
  now,
}: {
  discovery: StorefrontDiscoveryQuery;
  pageSize: number;
  now?: Date;
}) {
  const shopId = readPancakeShopId();
  return createFlashSaleCatalogRepository(prisma).listFlashSalePage({
    shopId,
    discovery,
    pageSize,
    now,
  });
}

export async function readConfiguredNextFlashSaleBoundary(now?: Date) {
  return createFlashSaleCatalogRepository(prisma).readNextFlashSaleBoundary({ now });
}

export async function listConfiguredStorefrontDiscoveryFacets() {
  const shopId = readPancakeShopId();
  return createStorefrontCatalogRepository(prisma).listDiscoveryFacets({ shopId });
}

export async function getConfiguredStorefrontProductBySlug(slug: string, now?: Date) {
  const shopId = readPancakeShopId();
  // `now` is threaded rather than defaulted deeper so a caller that already owns a request clock
  // can price every surface of one request against the same instant.
  return createStorefrontProductDetailRepository(prisma).getProductBySlug({ shopId, slug, now });
}

export async function listConfiguredRelatedStorefrontProducts(
  currentProduct: Readonly<{
    id: string;
    collections: readonly Readonly<{ slug: string }>[];
  }>,
  now?: Date,
) {
  const shopId = readPancakeShopId();
  const catalog = createStorefrontCatalogRepository(prisma);

  // Off (the default) the override table is never read. On, the administrator's manual candidates
  // come first, filtered to what is currently visible; with none to show, the collection-projected
  // related products below are used exactly as before.
  if (readRelatedOverrideEnabled()) {
    const manualIds = await readRelatedOverrideIds(prisma, currentProduct.id);
    if (manualIds.length > 0) {
      const { products } = await catalog.listProductsByIds({ shopId, productIds: manualIds, now });
      const manual = selectRelatedOverride(currentProduct.id, products);
      if (manual.length > 0) return manual;
    }
  }

  return listRelatedStorefrontProducts({
    currentProduct,
    listCollectionProducts: async (collectionSlug, limit) => {
      const discovery = parseStorefrontDiscoverySearchParams({
        collection: collectionSlug,
      });
      const page = await catalog.listDiscoveryPage({
        shopId,
        discovery,
        pageSize: limit,
        now,
      });
      return page.products;
    },
  });
}

export async function resolveConfiguredStorefrontProductSlug(slug: string) {
  const shopId = readPancakeShopId();
  return createStorefrontProductSlugResolver(prisma)({ shopId, slug });
}
