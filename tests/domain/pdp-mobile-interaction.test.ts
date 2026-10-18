import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SWIPE_THRESHOLDS,
  resolveGalleryKey,
  resolveGalleryNavigation,
  resolveGalleryStep,
  resolvePurchaseCtaState,
  resolveStickyBarVisible,
  resolveSwipeDirection,
  type PurchaseCtaView,
} from "../../src/components/headless/pdp-mobile-interaction-model.ts";
import { resolveVariantSelectionView } from "../../src/components/headless/variant-selection-model.ts";
import type { StorefrontProjectionOption } from "../../src/commerce/storefront-projection.ts";

/** C01 — mobile PDP interaction rules. Money and purchasability stay `variant-selection-model`'s. */

/* ---------------------------------------------------------------------- gallery */

test("a step moves one photo and refuses at either end instead of wrapping", () => {
  assert.deepEqual(resolveGalleryStep({ activeIndex: 0, imageCount: 3, direction: "next" }), { index: 1, changed: true });
  assert.deepEqual(resolveGalleryStep({ activeIndex: 2, imageCount: 3, direction: "previous" }), { index: 1, changed: true });
  assert.deepEqual(resolveGalleryStep({ activeIndex: 2, imageCount: 3, direction: "next" }), { index: 2, changed: false });
  assert.deepEqual(resolveGalleryStep({ activeIndex: 0, imageCount: 3, direction: "previous" }), { index: 0, changed: false });
});

test("a gallery of one or none cannot step", () => {
  for (const imageCount of [0, 1, -1, Number.NaN]) {
    assert.equal(resolveGalleryStep({ activeIndex: 0, imageCount, direction: "next" }).changed, false, String(imageCount));
  }
});

test("an out-of-range active index is clamped, never trusted", () => {
  assert.deepEqual(resolveGalleryStep({ activeIndex: 99, imageCount: 3, direction: "previous" }), { index: 1, changed: true });
  assert.deepEqual(resolveGalleryStep({ activeIndex: -5, imageCount: 3, direction: "next" }), { index: 1, changed: true });
  assert.deepEqual(resolveGalleryStep({ activeIndex: Number.NaN, imageCount: 3, direction: "next" }), { index: 1, changed: true });
});

test("navigation state names the position and which controls are usable", () => {
  assert.deepEqual(resolveGalleryNavigation(0, 4), { canPrevious: false, canNext: true, position: 1, count: 4 });
  assert.deepEqual(resolveGalleryNavigation(3, 4), { canPrevious: true, canNext: false, position: 4, count: 4 });
  assert.deepEqual(resolveGalleryNavigation(0, 0), { canPrevious: false, canNext: false, position: 0, count: 0 });
  assert.deepEqual(resolveGalleryNavigation(9, 4), { canPrevious: true, canNext: false, position: 4, count: 4 });
});

test("arrow, Home and End keys move the gallery; other keys are not consumed", () => {
  const at = (activeIndex: number) => ({ activeIndex, imageCount: 5 });
  assert.equal(resolveGalleryKey("ArrowRight", at(1)), 2);
  assert.equal(resolveGalleryKey("ArrowLeft", at(1)), 0);
  assert.equal(resolveGalleryKey("ArrowLeft", at(0)), 0);
  assert.equal(resolveGalleryKey("Home", at(3)), 0);
  assert.equal(resolveGalleryKey("End", at(1)), 4);
  for (const key of ["ArrowUp", "ArrowDown", "Enter", " ", "Tab", "a"]) {
    assert.equal(resolveGalleryKey(key, at(1)), null, key);
  }
  assert.equal(resolveGalleryKey("ArrowRight", { activeIndex: 0, imageCount: 1 }), null);
});

test("a short, fast, mostly horizontal drag is a swipe; left reveals the next photo", () => {
  assert.equal(resolveSwipeDirection({ dx: -80, dy: 5, durationMs: 200 }), "next");
  assert.equal(resolveSwipeDirection({ dx: 80, dy: -5, durationMs: 200 }), "previous");
});

test("a page scroll, a tiny drag or a slow drag is not a swipe", () => {
  assert.equal(resolveSwipeDirection({ dx: -20, dy: 0, durationMs: 100 }), null, "too short");
  assert.equal(resolveSwipeDirection({ dx: -90, dy: 90, durationMs: 100 }), null, "diagonal");
  assert.equal(resolveSwipeDirection({ dx: -60, dy: 120, durationMs: 100 }), null, "vertical scroll");
  assert.equal(resolveSwipeDirection({ dx: -90, dy: 0, durationMs: 5_000 }), null, "too slow");
});

test("the swipe thresholds are exact at the boundary", () => {
  const t = DEFAULT_SWIPE_THRESHOLDS;
  assert.equal(resolveSwipeDirection({ dx: -t.minDistancePx, dy: 0, durationMs: 100 }), "next");
  assert.equal(resolveSwipeDirection({ dx: -(t.minDistancePx - 1), dy: 0, durationMs: 100 }), null);
  assert.equal(resolveSwipeDirection({ dx: -t.minDistancePx, dy: 0, durationMs: t.maxDurationMs }), "next");
  assert.equal(resolveSwipeDirection({ dx: -t.minDistancePx, dy: 0, durationMs: t.maxDurationMs + 1 }), null);
  // Exactly the dominance ratio is still a swipe; just under is a scroll.
  assert.equal(resolveSwipeDirection({ dx: -90, dy: 60, durationMs: 100 }), "next");
  assert.equal(resolveSwipeDirection({ dx: -89, dy: 60, durationMs: 100 }), null);
});

test("non-finite gesture values are never a swipe", () => {
  for (const gesture of [
    { dx: Number.NaN, dy: 0, durationMs: 1 },
    { dx: -90, dy: Number.POSITIVE_INFINITY, durationMs: 1 },
    { dx: -90, dy: 0, durationMs: Number.NaN },
    { dx: -90, dy: 0, durationMs: -1 },
  ]) {
    assert.equal(resolveSwipeDirection(gesture), null);
  }
});

/* ------------------------------------------------------------------- CTA state */

function option(overrides: Partial<StorefrontProjectionOption> = {}): StorefrontProjectionOption {
  return {
    id: "v1",
    pancakeVariationId: "p1",
    kindKey: null,
    kindLabel: null,
    color: null,
    size: "S",
    price: 100_000,
    basePriceVnd: null,
    isDiscounted: false,
    purchasable: true,
    unavailableReason: null,
    ...overrides,
  } as StorefrontProjectionOption;
}

function cta(
  options: StorefrontProjectionOption[],
  selection: { kindKey?: string | null; color?: string | null; size?: string | null } = {},
  extras: { isPending?: boolean; preorderLabel?: string } = {},
) {
  const resolved = { kindKey: null, color: null, size: null, ...selection };
  const view = resolveVariantSelectionView({
    options,
    productLevelOptions: options,
    selection: resolved,
    preorderLabel: extras.preorderLabel,
  });
  return resolvePurchaseCtaState({ view, selection: resolved, isPending: extras.isPending ?? false });
}

test("no purchasable option is its own state, not 'choose'", () => {
  assert.equal(cta([option({ purchasable: false, unavailableReason: "OUT_OF_STOCK" })]).kind, "none");
  assert.equal(cta([]).kind, "none");
});

test("nothing chosen yet asks for size, and for colour first when the product has colours", () => {
  const sizeOnly = cta([option({ id: "a", size: "S" }), option({ id: "b", size: "M" })]);
  assert.deepEqual([sizeOnly.kind, sizeOnly.missing, sizeOnly.canAdd], ["choose", ["size"], false]);

  const coloured = cta([
    option({ id: "a", size: "S", color: "Ink" }),
    option({ id: "b", size: "M", color: "Stone" }),
  ]);
  assert.deepEqual([coloured.kind, coloured.missing], ["choose", ["color", "size"]]);

  const sizePicked = cta(
    [option({ id: "a", size: "S", color: "Ink" }), option({ id: "b", size: "S", color: "Stone" })],
    { size: "S" },
  );
  assert.deepEqual([sizePicked.kind, sizePicked.missing], ["choose", ["color"]]);
});

test("a product with kinds asks for the kind first", () => {
  const state = cta([
    option({ id: "a", kindKey: "k1", kindLabel: "Một", size: "S" }),
    option({ id: "b", kindKey: "k2", kindLabel: "Hai", size: "S" }),
  ]);
  assert.deepEqual([state.kind, state.missing], ["choose", ["kind", "size"]]);
});

test("a complete choice that resolves to nothing still asks the shopper to choose", () => {
  const state = cta(
    [option({ id: "a", size: "S", color: "Ink" }), option({ id: "b", size: "M", color: "Stone" })],
    { size: "M", color: "Ink" },
  );
  assert.equal(state.kind, "choose");
  assert.deepEqual(state.missing, ["color"]);
});

test("a selected option that cannot be bought is unavailable with its reason", () => {
  const state = cta(
    [option({ id: "a", size: "S" }), option({ id: "b", size: "M", purchasable: false, unavailableReason: "OUT_OF_STOCK" })],
    { size: "M" },
  );
  assert.deepEqual([state.kind, state.canAdd, state.unavailableReason], ["unavailable", false, "OUT_OF_STOCK"]);
});

test("a selected purchasable option is ready, or a preorder when the marker applies", () => {
  const ready = cta([option({ id: "a", size: "S" })], { size: "S" });
  assert.deepEqual([ready.kind, ready.canAdd], ["ready", true]);

  const preorder = cta([option({ id: "a", size: "S", isPreorderSale: true })], { size: "S" }, { preorderLabel: "Đặt trước" });
  assert.deepEqual([preorder.kind, preorder.canAdd], ["preorder", true]);
});

test("an add in flight is pending whatever else is true", () => {
  assert.equal(cta([option({ id: "a", size: "S" })], { size: "S" }, { isPending: true }).kind, "pending");
  assert.equal(cta([option({ id: "a", size: "S" })], {}, { isPending: true }).kind, "pending");
});

test("the CTA never reports canAdd unless the selection view says it can", () => {
  const view: PurchaseCtaView = {
    hasKindOptions: false,
    hasColorOptions: false,
    hasPurchasableVariant: true,
    selectedVariantId: "v",
    canAdd: false,
    selectedUnavailableReason: null,
    preorderMessage: "Đặt trước",
  };
  const state = resolvePurchaseCtaState({ view, selection: { kindKey: null, color: null, size: "S" }, isPending: false });
  assert.deepEqual([state.kind, state.canAdd], ["unavailable", false]);
});

/* ---------------------------------------------------------------- sticky bar */

test("the sticky bar needs a measured, narrow viewport, an off-screen panel and the shopper still inside the detail region", () => {
  const base = { ready: true, wide: false, panelIntersecting: false, regionIntersecting: true, ctaKind: "choose" as const };
  assert.equal(resolveStickyBarVisible(base), true);
  assert.equal(resolveStickyBarVisible({ ...base, ready: false }), false, "never before measurement");
  assert.equal(resolveStickyBarVisible({ ...base, wide: true }), false, "never on a wide viewport");
  assert.equal(resolveStickyBarVisible({ ...base, panelIntersecting: true }), false, "the real action is on screen");
  assert.equal(resolveStickyBarVisible({ ...base, regionIntersecting: false }), false, "scrolled past the detail region: it would only cover the footer");
  assert.equal(resolveStickyBarVisible({ ...base, ctaKind: "none" }), false, "nothing to buy");
  for (const ctaKind of ["pending", "choose", "unavailable", "preorder", "ready"] as const) {
    assert.equal(resolveStickyBarVisible({ ...base, ctaKind }), true, ctaKind);
  }
});

/* ----------------------------------------------------------------------- gate */

test("the mobile PDP interactions are OFF unless PDP_MOBILE_INTERACTIONS_ENABLED is exactly \"true\"", async () => {
  const { readPdpMobileInteractionsEnabled } = await import("../../src/routes/product-model.ts");
  assert.equal(readPdpMobileInteractionsEnabled({}), false);
  for (const value of ["", "false", "TRUE", "1", " true", "yes"]) {
    assert.equal(readPdpMobileInteractionsEnabled({ PDP_MOBILE_INTERACTIONS_ENABLED: value }), false, value);
  }
  assert.equal(readPdpMobileInteractionsEnabled({ PDP_MOBILE_INTERACTIONS_ENABLED: "true" }), true);
});
