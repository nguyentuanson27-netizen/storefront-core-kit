import assert from "node:assert/strict";
import test from "node:test";

import { BRAND } from "../../src/brand/index.ts";
import type { StorefrontVariantFacts } from "../../src/commerce/storefront-product.ts";
import {
  NEW_ARRIVALS_OFF_VIEW_MODEL,
  buildNewArrivalsViewModel,
  readNewArrivalsCurationEnabled,
  type NewArrivalsProduct,
} from "../../src/routes/new-arrivals-model.ts";
import {
  buildNewArrivalsBaseMetadata,
  buildNewArrivalsMetadata,
} from "../../src/routes/metadata/new-arrivals.ts";

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

function product(n: number): NewArrivalsProduct {
  return { id: `product-${n}`, slug: `product-${n}`, name: `Sản phẩm ${n}`, media: null, variants: [variant(n)] };
}

const build = (count: number, page: number, totalPages: number) =>
  buildNewArrivalsViewModel({
    products: Array.from({ length: count }, (_unused, index) => product(index + 1)),
    page,
    totalPages,
    selectEventBySlug: new Map(),
  }).curated!;

test("B03 the flag is strictly the string true and OFF by default", () => {
  assert.equal(readNewArrivalsCurationEnabled({}), false);
  assert.equal(readNewArrivalsCurationEnabled({ NEW_ARRIVALS_CURATION_ENABLED: "true" }), true);
  for (const other of ["True", "TRUE", "1", "yes", "on", " true", "true ", "false", ""]) {
    assert.equal(readNewArrivalsCurationEnabled({ NEW_ARRIVALS_CURATION_ENABLED: other }), false, JSON.stringify(other));
  }
});

test("B03 OFF carries nothing: the page renders exactly what it always has", () => {
  assert.deepEqual(NEW_ARRIVALS_OFF_VIEW_MODEL, { curated: null });
  assert.ok(Object.isFrozen(NEW_ARRIVALS_OFF_VIEW_MODEL));
});

test("B03 cards keep the order given and one card exists per product", () => {
  const curated = build(3, 1, 1);
  assert.deepEqual(curated.cards.map((card) => card.id), ["product-1", "product-2", "product-3"]);
  assert.equal(curated.empty, false);
  assert.ok(curated.cards.every((card) => typeof card.model === "object"));
});

test("B03 empty: no cards flags the accessible empty state, with no invented products", () => {
  const curated = build(0, 1, 1);
  assert.equal(curated.empty, true);
  assert.deepEqual(curated.cards, []);
  assert.equal(curated.previousHref, null);
  assert.equal(curated.nextHref, null);
});

test("B03 a page whose slots are all hidden is empty but still paginates by stored slots", () => {
  const curated = build(0, 1, 3);
  assert.equal(curated.empty, true);
  assert.equal(curated.nextHref, "/new-arrivals?page=2", "later pages are reachable");
  assert.equal(curated.totalPages, 3);
});

test("B03 pagination hrefs: page 1 is the bare path, later pages carry ?page=N", () => {
  assert.equal(build(24, 1, 3).previousHref, null);
  assert.equal(build(24, 1, 3).nextHref, "/new-arrivals?page=2");
  assert.equal(build(24, 2, 3).previousHref, "/new-arrivals", "back to page 1 is the canonical bare path");
  assert.equal(build(24, 2, 3).nextHref, "/new-arrivals?page=3");
  assert.equal(build(1, 3, 3).previousHref, "/new-arrivals?page=2");
  assert.equal(build(1, 3, 3).nextHref, null);
});

test("B03 the tone cycle continues across pages instead of restarting", () => {
  assert.equal(build(24, 1, 3).toneOffset, 0);
  assert.equal(build(24, 2, 3).toneOffset, 24);
  assert.equal(build(24, 3, 3).toneOffset, 48);
});

test("B03 the view model is frozen", () => {
  const curated = build(2, 1, 1);
  assert.ok(Object.isFrozen(curated));
  assert.ok(Object.isFrozen(curated.cards));
});

test("B03 metadata OFF is the original, and never reads the query string", async () => {
  // The exact values the route has always exported.
  const original = { title: "Hàng mới", description: `Những sản phẩm mới nhất từ ${BRAND.identity.name}.` };
  assert.deepEqual(buildNewArrivalsBaseMetadata(), original);

  const previous = process.env.NEW_ARRIVALS_CURATION_ENABLED;
  delete process.env.NEW_ARRIVALS_CURATION_ENABLED;
  try {
    let awaited = false;
    const spy = {
      then(resolve: (value: Record<string, string>) => unknown) {
        awaited = true;
        return Promise.resolve({}).then(resolve);
      },
    } as unknown as Promise<Record<string, string>>;
    const metadata = await buildNewArrivalsMetadata({ searchParams: spy });
    assert.equal(awaited, false, "searchParams must not be read when OFF");
    assert.deepEqual(metadata, buildNewArrivalsBaseMetadata());
  } finally {
    if (previous !== undefined) process.env.NEW_ARRIVALS_CURATION_ENABLED = previous;
  }
});

test("B03 metadata ON names later pages, leaves page 1 and malformed pages at the base", async () => {
  const previous = process.env.NEW_ARRIVALS_CURATION_ENABLED;
  process.env.NEW_ARRIVALS_CURATION_ENABLED = "true";
  try {
    const meta = (page: string | string[] | undefined) =>
      buildNewArrivalsMetadata({ searchParams: Promise.resolve({ page }) });
    assert.deepEqual(await meta(undefined), buildNewArrivalsBaseMetadata());
    assert.deepEqual(await meta("1"), buildNewArrivalsBaseMetadata());
    assert.equal((await meta("2")).title, "Hàng mới — Trang 2");
    assert.equal((await meta("21")).title, "Hàng mới — Trang 21");
    assert.deepEqual(await meta("22"), buildNewArrivalsBaseMetadata(), "the route 404s; metadata stays the base");
    assert.deepEqual(await meta("abc"), buildNewArrivalsBaseMetadata());
    assert.deepEqual(await meta(["2", "3"]), buildNewArrivalsBaseMetadata());
    assert.equal("alternates" in (await meta("2")), false, "no new canonical/indexation default");
  } finally {
    if (previous === undefined) delete process.env.NEW_ARRIVALS_CURATION_ENABLED;
    else process.env.NEW_ARRIVALS_CURATION_ENABLED = previous;
  }
});
