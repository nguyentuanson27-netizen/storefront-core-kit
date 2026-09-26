import assert from "node:assert/strict";
import test from "node:test";

import {
  STOREFRONT_DISCOVERY_LIMITS,
  type StorefrontDiscoveryQuery,
} from "../../src/commerce/storefront-discovery.ts";
import type { StorefrontVariantFacts } from "../../src/commerce/storefront-product.ts";
import {
  buildShopViewModel,
  hasActiveShopDiscovery,
  shopCollectionLabel,
  type ShopProduct,
  type ShopViewModelInput,
} from "../../src/routes/shop-model.ts";
import type { TrackingEvent } from "../../src/tracking/commerce-events.ts";

/**
 * The shop route's own decisions, held to the behaviour the page had before it was migrated.
 *
 * Pricing belongs to `buildProductCardModel` and is not retested here. What is tested is what the
 * route decides: whether the shopper actually filtered, how facet slugs read, where the pagination
 * links point, and the tone offset -- which has to survive paging or the grid visibly repeats.
 */

const image = (n: number) => ({ url: `https://content.pancake.vn/1/2/3/4/photo-${n}.jpg`, alt: "" });

function variant(n: number): StorefrontVariantFacts {
  return {
    id: `variant-${n}`,
    pancakeVariationId: `pancake-${n}`,
    color: null,
    size: "S",
    sellableStock: 3,
    retailPrice: 100_000,
    retailPriceAfterDiscount: 100_000,
  };
}

function product(n: number): ShopProduct {
  return {
    id: `product-${n}`,
    slug: `product-${n}`,
    name: `Sản phẩm ${n}`,
    media: { primary: image(n), gallery: [image(n)] },
    variants: [variant(n)],
  };
}

function discovery(overrides: Partial<StorefrontDiscoveryQuery> = {}): StorefrontDiscoveryQuery {
  return {
    query: null,
    color: null,
    size: null,
    availability: null,
    minPriceVnd: null,
    maxPriceVnd: null,
    collection: null,
    sort: "name-asc",
    page: 1,
    ...overrides,
  };
}

function input(overrides: Partial<ShopViewModelInput> = {}): ShopViewModelInput {
  return {
    discovery: discovery(),
    products: [],
    facets: { collections: [], colors: [], sizes: [] },
    totalCount: 0,
    totalPages: 1,
    page: 1,
    hasPrevious: false,
    hasNext: false,
    pageSize: 24,
    selectEventBySlug: new Map<string, TrackingEvent>(),
    ...overrides,
  };
}

/* ------------------------------------------------------------------ filtered state */

test("arriving at the shop with no query is not a filtered state", () => {
  // The empty page says "no products are on sale yet" rather than "nothing matches your filters",
  // and that turns on this one boolean.
  assert.equal(hasActiveShopDiscovery(discovery()), false);
});

test("every narrowing control counts as filtering", () => {
  const narrowings: Partial<StorefrontDiscoveryQuery>[] = [
    { query: "áo" },
    { color: "Đen" },
    { size: "M" },
    { availability: "in-stock" },
    { minPriceVnd: 100_000 },
    { maxPriceVnd: 500_000 },
    { collection: "ao-so-mi" },
    { sort: "price-asc" },
  ];

  for (const narrowing of narrowings) {
    assert.equal(
      hasActiveShopDiscovery(discovery(narrowing)),
      true,
      `${Object.keys(narrowing)[0]} must count as filtering`,
    );
  }
});

test("paging alone is not filtering", () => {
  assert.equal(hasActiveShopDiscovery(discovery({ page: 3 })), false);
});

/* ------------------------------------------------------------------ facet labels */

test("a facet slug reads as a heading", () => {
  assert.equal(shopCollectionLabel("ao-so-mi"), "Ao So Mi");
  assert.equal(shopCollectionLabel("quan"), "Quan");
});

test("a slug with empty parts does not lose them or crash", () => {
  assert.equal(shopCollectionLabel("ao--mi"), "Ao  Mi");
  assert.equal(shopCollectionLabel(""), "");
});

test("collection facets carry both the value the form submits and the label it shows", () => {
  const model = buildShopViewModel(
    input({ facets: { collections: ["ao-so-mi"], colors: ["Đen"], sizes: ["M"] } }),
  );

  assert.deepEqual(model.collectionFacets, [{ value: "ao-so-mi", label: "Ao So Mi" }]);
  assert.deepEqual(model.colorFacets, ["Đen"]);
  assert.deepEqual(model.sizeFacets, ["M"]);
});

/* -------------------------------------------------------------------- pagination */

test("pagination links are built only for the directions that exist", () => {
  const middle = buildShopViewModel(
    input({ page: 2, totalPages: 3, hasPrevious: true, hasNext: true }),
  );
  // Page one drops the `page` param entirely, so the first page has one canonical URL rather than
  // two spellings of it.
  assert.equal(middle.previousHref, "/shop");
  assert.equal(middle.nextHref, "/shop?page=3");

  const only = buildShopViewModel(input({ page: 1, totalPages: 1 }));
  assert.equal(only.previousHref, null);
  assert.equal(only.nextHref, null);
});

test("pagination links carry the filters forward, so paging does not silently widen the results", () => {
  const model = buildShopViewModel(
    input({
      discovery: discovery({ collection: "ao-so-mi", sort: "price-asc", page: 2 }),
      page: 2,
      totalPages: 3,
      hasNext: true,
    }),
  );

  assert.match(model.nextHref ?? "", /collection=ao-so-mi/);
  assert.match(model.nextHref ?? "", /sort=price-asc/);
  assert.match(model.nextHref ?? "", /page=3/);
});

/* ------------------------------------------------------------------ tone offset */

test("the tone cycle continues across pages instead of restarting", () => {
  // Restarting it makes page two open with the same colour run as page one, which reads as the grid
  // repeating itself.
  assert.equal(buildShopViewModel(input({ page: 1, pageSize: 24 })).toneOffset, 0);
  assert.equal(buildShopViewModel(input({ page: 2, pageSize: 24 })).toneOffset, 24);
  assert.equal(buildShopViewModel(input({ page: 3, pageSize: 24 })).toneOffset, 48);
});

/* ---------------------------------------------------------------------- cards */

test("every product becomes a card in catalog order, carrying its prebuilt select event", () => {
  const selectEvent = { name: "select_item", payload: {} } as unknown as TrackingEvent;
  const model = buildShopViewModel(
    input({
      products: [product(1), product(2)],
      selectEventBySlug: new Map([["product-2", selectEvent]]),
      totalCount: 2,
    }),
  );

  assert.deepEqual(model.cards.map((card) => card.id), ["product-1", "product-2"]);
  assert.equal(model.cards[0]?.model.selectEvent, null);
  assert.equal(model.cards[1]?.model.selectEvent, selectEvent);
});

test("the view model is frozen so markup cannot mutate a decision it was handed", () => {
  const model = buildShopViewModel(input({ products: [product(1)] }));

  assert.equal(Object.isFrozen(model), true);
  assert.equal(Object.isFrozen(model.cards), true);
});

/* --------------------------------------------------------------------- limits */

test("the form's bounds are the ones the loader enforces, not a copy", () => {
  // Retyping these in markup is how a field lets a shopper enter something the route then refuses.
  const model = buildShopViewModel(input());

  assert.deepEqual(model.limits, {
    query: STOREFRONT_DISCOVERY_LIMITS.query,
    priceVnd: STOREFRONT_DISCOVERY_LIMITS.priceVnd,
  });
});

/* ---------------------------------------------------- server-owned listing URL state */

test("the clear link is the route's own unfiltered href, not markup's guess", () => {
  const model = buildShopViewModel(input({ discovery: discovery({ color: "Ink", page: 3 }) }));
  assert.equal(model.clearHref, "/shop");
  // The form's remount key tracks filter state, not the page, so paging keeps typed input.
  assert.equal(model.stateHref, "/shop?color=Ink");
  assert.equal(
    buildShopViewModel(input({ discovery: discovery({ color: "Ink", page: 1 }) })).stateHref,
    model.stateHref,
  );
});

test("each sort option links to the listing re-sorted from page one, keeping the filters", () => {
  const model = buildShopViewModel(
    input({ discovery: discovery({ color: "Ink", sort: "price-asc", page: 2 }) }),
  );
  assert.deepEqual(
    model.sortOptions.map(({ value, href, active }) => ({ value, href, active })),
    [
      { value: "name-asc", href: "/shop?color=Ink", active: false },
      { value: "name-desc", href: "/shop?color=Ink&sort=name-desc", active: false },
      { value: "price-asc", href: "/shop?color=Ink&sort=price-asc", active: true },
      { value: "price-desc", href: "/shop?color=Ink&sort=price-desc", active: false },
    ],
  );
  assert.deepEqual(
    model.sortOptions.map(({ label }) => label),
    ["Tên A–Z", "Tên Z–A", "Giá thấp → cao", "Giá cao → thấp"],
  );
});

test("removing one filter keeps every other filter and the sort, and returns to page one", () => {
  const applied = discovery({
    query: "áo khoác",
    collection: "city-uniform",
    color: "Ink",
    size: "M",
    minPriceVnd: 100_000,
    maxPriceVnd: 900_000,
    availability: "in-stock",
    sort: "price-desc",
    page: 4,
  });
  const model = buildShopViewModel(input({ discovery: applied }));

  assert.deepEqual(
    model.activeFilters.map(({ value }) => value),
    ["query", "collection", "color", "size", "minPrice", "maxPrice", "availability"],
  );
  for (const filter of model.activeFilters) {
    assert.equal(filter.active, true);
    const params = new URL(filter.href, "https://shop.example").searchParams;
    assert.equal(params.get("page"), null, `${filter.value} resets to page one`);
    assert.equal(params.get("sort"), "price-desc", `${filter.value} keeps the sort`);
  }
  const byKey = new Map(model.activeFilters.map((filter) => [filter.value, filter]));
  const colorless = new URL(byKey.get("color")!.href, "https://shop.example").searchParams;
  assert.equal(colorless.get("color"), null);
  assert.equal(colorless.get("size"), "M");
  assert.equal(colorless.get("q"), "áo khoác");
  assert.equal(colorless.get("collection"), "city-uniform");
  assert.equal(colorless.get("minPrice"), "100000");
  assert.equal(colorless.get("maxPrice"), "900000");
  assert.equal(colorless.get("availability"), "in-stock");
  assert.equal(byKey.get("collection")!.label, "Bộ sưu tập: City Uniform");
  assert.match(byKey.get("minPrice")!.label, /^Giá từ 100\.000/);
});

test("an unfiltered or sort-only listing has no filters to remove", () => {
  assert.deepEqual(buildShopViewModel(input()).activeFilters, []);
  assert.deepEqual(buildShopViewModel(input({ discovery: discovery({ sort: "name-desc" }) })).activeFilters, []);
});
