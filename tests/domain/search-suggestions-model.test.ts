import assert from "node:assert/strict";
import test from "node:test";

import type { StorefrontProductMedia } from "../../src/commerce/product-media.ts";
import type { StorefrontVariantFacts } from "../../src/commerce/storefront-product.ts";
import {
  buildSearchSuggestionsModel,
  type SearchSuggestionProduct,
} from "../../src/routes/search-suggestions-model.ts";
import type { StorefrontSearchSuggestionCandidates } from "../../src/commerce/storefront-search-suggestions.ts";
import type { StorefrontDiscoveryQuery } from "../../src/commerce/storefront-discovery.ts";

/** B07 — the public shape of a suggestion list. Prices come from the card model, not from here. */

const vnd = (amount: string): string => `${amount} ₫`;

function variant(overrides: Partial<StorefrontVariantFacts> = {}): StorefrontVariantFacts {
  const retailPrice = overrides.retailPrice ?? 100_000;
  return {
    id: "internal-variant-id",
    pancakeVariationId: "pancake-1",
    color: null,
    size: "S",
    sellableStock: 5,
    retailPrice,
    retailPriceAfterDiscount: retailPrice,
    ...overrides,
  };
}

const media: StorefrontProductMedia = {
  primary: { url: "https://content.pancake.vn/a/1/2/3/primary.jpg", alt: "Ảnh chính" },
  gallery: [{ url: "https://content.pancake.vn/a/1/2/3/primary.jpg", alt: "Ảnh chính" }],
};

const discovery: StorefrontDiscoveryQuery = {
  query: "áo",
  color: null,
  size: null,
  availability: null,
  minPriceVnd: null,
  maxPriceVnd: null,
  collection: null,
  sort: "name-asc",
  page: 1,
};

function candidates(
  products: readonly SearchSuggestionProduct[],
  totalCount = products.length,
): StorefrontSearchSuggestionCandidates<SearchSuggestionProduct> {
  return { ok: true, query: "áo", products, totalCount, discovery };
}

test("a failed load maps to the same failure and nothing else", () => {
  assert.deepEqual(buildSearchSuggestionsModel({ ok: false, reason: "DISABLED" }), {
    ok: false,
    reason: "DISABLED",
  });
  assert.deepEqual(buildSearchSuggestionsModel({ ok: false, reason: "UNAVAILABLE" }), {
    ok: false,
    reason: "UNAVAILABLE",
  });
});

test("an item carries a canonical PDP link, a trusted image and the card's formatted price", () => {
  const model = buildSearchSuggestionsModel(
    candidates([{ slug: "ao-so-mi", name: "Áo sơ mi", media, variants: [variant()] }]),
  );
  assert.equal(model.ok, true);
  if (!model.ok) return;
  assert.deepEqual(model.items, [
    {
      key: "ao-so-mi",
      name: "Áo sơ mi",
      href: "/shop/ao-so-mi",
      image: media.primary,
      priceText: vnd("100.000"),
      compareAtText: null,
      availability: "in-stock",
    },
  ]);
});

test("a product without media has no image and an out-of-stock product says so", () => {
  const model = buildSearchSuggestionsModel(
    candidates([{ slug: "het", name: "Hết hàng", variants: [variant({ sellableStock: 0 })] }]),
  );
  assert.equal(model.ok && model.items[0]?.image, null);
  assert.equal(model.ok && model.items[0]?.availability, "out-of-stock");
});

test("the browser never receives internal ids, raw prices or stock counts", () => {
  const model = buildSearchSuggestionsModel(
    candidates([{ slug: "ao", name: "Áo", media, variants: [variant()] }]),
  );
  const serialized = JSON.stringify(model);
  for (const secret of ["internal-variant-id", "pancake-1", "retailPrice", "sellableStock", "100000"]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
});

test("see-all is the canonical /shop href for the same query and the remainder is counted", () => {
  const model = buildSearchSuggestionsModel(
    candidates([{ slug: "ao", name: "Áo", variants: [variant()] }], 9),
  );
  assert.equal(model.ok && model.seeAllHref, "/shop?q=%C3%A1o");
  assert.equal(model.ok && model.totalCount, 9);
  assert.equal(model.ok && model.remainingCount, 8);
});

test("a repeated slug yields one suggestion", () => {
  const product = { slug: "ao", name: "Áo", variants: [variant()] };
  const model = buildSearchSuggestionsModel(candidates([product, product]));
  assert.equal(model.ok && model.items.length, 1);
});

test("an empty result is a successful model with no items and no remainder", () => {
  const model = buildSearchSuggestionsModel(candidates([], 0));
  assert.equal(model.ok && model.items.length, 0);
  assert.equal(model.ok && model.remainingCount, 0);
});
