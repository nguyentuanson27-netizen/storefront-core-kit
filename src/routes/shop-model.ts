import type { StorefrontProductMedia } from "../commerce/product-media.ts";
import {
  buildStorefrontDiscoveryHref,
  STOREFRONT_DISCOVERY_LIMITS,
  STOREFRONT_DISCOVERY_SORTS,
  type StorefrontDiscoveryQuery,
  type StorefrontDiscoverySort,
} from "../commerce/storefront-discovery.ts";
import type {
  StorefrontPricingRule,
  StorefrontVariantFacts,
} from "../commerce/storefront-product.ts";
import {
  buildProductCardModel,
  type ProductCardModel,
} from "../components/headless/build-product-card-model.ts";
import type { TrackingEvent } from "../tracking/commerce-events.ts";
import type { ListingOption } from "./listing.ts";

/**
 * Everything the shop route decides, as one pure function.
 *
 * Separate from `shop.ts` because that file reaches the catalog runtime, `next/server` and
 * `notFound()`. What is left here is what the page would otherwise decide inline: whether the
 * shopper has actually filtered anything, how a facet slug reads as a label, where the pagination
 * links point, and which tone each card takes -- the last of which has to survive paging, or page
 * two restarts the colour cycle and the grid visibly repeats itself.
 */

export type ShopProduct = Readonly<{
  id: string;
  slug: string;
  name: string;
  media?: StorefrontProductMedia | null;
  variants: StorefrontVariantFacts[];
}>;

export type ShopFacets = Readonly<{
  collections: readonly string[];
  colors: readonly string[];
  sizes: readonly string[];
}>;

export type ShopCollectionFacet = Readonly<{ value: string; label: string }>;

export type ShopViewModel = Readonly<{
  cards: readonly Readonly<{ id: string; model: ProductCardModel }>[];
  /** Index of the first card on this page, so the tone cycle continues instead of restarting. */
  toneOffset: number;
  totalCount: number;
  page: number;
  totalPages: number;
  previousHref: string | null;
  nextHref: string | null;
  /** Whether the shopper narrowed anything, which decides the empty state's wording. */
  filtered: boolean;
  /** The unfiltered listing, from the same builder as every other href. */
  clearHref: string;
  /**
   * This listing's filter and sort state as its canonical page-one href. Uncontrolled controls
   * (a GET form's `defaultValue`s) only read their state on mount, so a presentation keys them on
   * this: after a client-side navigation to another state they remount instead of still showing,
   * and resubmitting, the state the shopper just removed.
   */
  stateHref: string;
  /** Every sort, each linking to this listing re-sorted from page one. */
  sortOptions: readonly ListingOption<StorefrontDiscoverySort>[];
  /**
   * One entry per applied filter; `href` removes that filter alone, keeps every other one, and
   * returns to page one. `value` names the filter, so a presentation can key or group entries.
   */
  activeFilters: readonly ListingOption<ShopFilterKey>[];
  collectionFacets: readonly ShopCollectionFacet[];
  colorFacets: readonly string[];
  sizeFacets: readonly string[];
  discovery: StorefrontDiscoveryQuery;
  /**
   * The same bounds the loader rejects past, handed to the form so its affordances and the server's
   * answer cannot disagree. Retyping them in markup is how a field lets a shopper enter something
   * the route then refuses.
   */
  limits: Readonly<{ query: number; priceVnd: number }>;
}>;

export type ShopViewModelInput = Readonly<{
  discovery: StorefrontDiscoveryQuery;
  products: readonly ShopProduct[];
  facets: ShopFacets;
  totalCount: number;
  totalPages: number;
  page: number;
  hasPrevious: boolean;
  hasNext: boolean;
  pageSize: number;
  pricingRule?: StorefrontPricingRule;
  selectEventBySlug: ReadonlyMap<string, TrackingEvent>;
}>;

export type ShopFilterKey = "query" | "collection" | "color" | "size" | "minPrice" | "maxPrice" | "availability";

const SORT_LABELS: Readonly<Record<StorefrontDiscoverySort, string>> = {
  "name-asc": "Tên A–Z",
  "name-desc": "Tên Z–A",
  "price-asc": "Giá thấp → cao",
  "price-desc": "Giá cao → thấp",
};

const currency = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
});

const UNFILTERED: StorefrontDiscoveryQuery = Object.freeze({
  query: null,
  color: null,
  size: null,
  availability: null,
  minPriceVnd: null,
  maxPriceVnd: null,
  collection: null,
  sort: "name-asc",
  page: 1,
});

/**
 * The applied filters, each with the href that removes only it.
 *
 * Built from `buildStorefrontDiscoveryHref`, the listing's one href authority, so removing a filter
 * obeys the same rules as every other navigation: the other filters and the sort survive, and the
 * page resets because the result set changed.
 */
export function buildShopActiveFilters(
  discovery: StorefrontDiscoveryQuery,
): readonly ListingOption<ShopFilterKey>[] {
  const without = (patch: Partial<StorefrontDiscoveryQuery>) =>
    buildStorefrontDiscoveryHref({ ...discovery, ...patch }, 1);
  const filters: ListingOption<ShopFilterKey>[] = [];
  const add = (value: ShopFilterKey, label: string, href: string) =>
    filters.push(Object.freeze({ value, label, href, active: true }));

  if (discovery.query !== null) add("query", `Tìm: “${discovery.query}”`, without({ query: null }));
  if (discovery.collection !== null) {
    add("collection", `Bộ sưu tập: ${shopCollectionLabel(discovery.collection)}`, without({ collection: null }));
  }
  if (discovery.color !== null) add("color", `Màu: ${discovery.color}`, without({ color: null }));
  if (discovery.size !== null) add("size", `Kích cỡ: ${discovery.size}`, without({ size: null }));
  if (discovery.minPriceVnd !== null) {
    add("minPrice", `Giá từ ${currency.format(discovery.minPriceVnd)}`, without({ minPriceVnd: null }));
  }
  if (discovery.maxPriceVnd !== null) {
    add("maxPrice", `Giá đến ${currency.format(discovery.maxPriceVnd)}`, without({ maxPriceVnd: null }));
  }
  if (discovery.availability !== null) add("availability", "Còn hàng", without({ availability: null }));
  return Object.freeze(filters);
}

/** A facet slug as a heading: `ao-so-mi` reads `Ao So Mi`. */
export function shopCollectionLabel(slug: string): string {
  return slug
    .split("-")
    .map((part) => (part.length > 0 ? `${part[0]!.toUpperCase()}${part.slice(1)}` : part))
    .join(" ");
}

/**
 * Whether the shopper narrowed the catalog at all.
 *
 * The default sort counts as unfiltered: arriving at `/shop` and seeing "no products match your
 * filters" when no filter was applied is worse than saying the catalog is empty, which it is.
 */
export function hasActiveShopDiscovery(discovery: StorefrontDiscoveryQuery): boolean {
  return (
    discovery.query !== null
    || discovery.color !== null
    || discovery.size !== null
    || discovery.availability !== null
    || discovery.minPriceVnd !== null
    || discovery.maxPriceVnd !== null
    || discovery.collection !== null
    || discovery.sort !== "name-asc"
  );
}

export function buildShopViewModel(input: ShopViewModelInput): ShopViewModel {
  return Object.freeze({
    cards: Object.freeze(
      input.products.map((product) =>
        Object.freeze({
          id: product.id,
          model: buildProductCardModel({
            slug: product.slug,
            name: product.name,
            media: product.media,
            variants: product.variants,
            pricingRule: input.pricingRule,
            selectEvent: input.selectEventBySlug.get(product.slug) ?? null,
          }),
        }),
      ),
    ),
    toneOffset: (input.page - 1) * input.pageSize,
    totalCount: input.totalCount,
    page: input.page,
    totalPages: input.totalPages,
    previousHref: input.hasPrevious
      ? buildStorefrontDiscoveryHref(input.discovery, input.page - 1)
      : null,
    nextHref: input.hasNext ? buildStorefrontDiscoveryHref(input.discovery, input.page + 1) : null,
    filtered: hasActiveShopDiscovery(input.discovery),
    clearHref: buildStorefrontDiscoveryHref(UNFILTERED, 1),
    stateHref: buildStorefrontDiscoveryHref(input.discovery, 1),
    sortOptions: Object.freeze(
      STOREFRONT_DISCOVERY_SORTS.map((sort) =>
        Object.freeze({
          value: sort,
          label: SORT_LABELS[sort],
          href: buildStorefrontDiscoveryHref({ ...input.discovery, sort }, 1),
          active: input.discovery.sort === sort,
        }),
      ),
    ),
    activeFilters: buildShopActiveFilters(input.discovery),
    collectionFacets: Object.freeze(
      input.facets.collections.map((value) =>
        Object.freeze({ value, label: shopCollectionLabel(value) }),
      ),
    ),
    colorFacets: Object.freeze([...input.facets.colors]),
    sizeFacets: Object.freeze([...input.facets.sizes]),
    discovery: input.discovery,
    limits: Object.freeze({
      query: STOREFRONT_DISCOVERY_LIMITS.query,
      priceVnd: STOREFRONT_DISCOVERY_LIMITS.priceVnd,
    }),
  });
}
