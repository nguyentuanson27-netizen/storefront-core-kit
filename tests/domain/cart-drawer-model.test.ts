import assert from "node:assert/strict";
import test from "node:test";

import {
  INITIAL_CART_DRAWER,
  reduceCartDrawer,
  resolveFocusTrapTarget,
  shouldOpenCartDrawer,
  type CartDrawerEvent,
  type CartDrawerState,
} from "../../src/components/headless/cart-drawer-model.ts";
import {
  buildCartDrawerView,
  readCartDrawerEnabled,
  type CartDrawerView,
} from "../../src/routes/cart-drawer-model.ts";
import { buildCartViewModel } from "../../src/routes/cart-model.ts";
import type { StorefrontCartLine } from "../../src/commerce/storefront-cart.ts";

/** C03 — cart drawer state, focus rules and the narrow view. The drawer decides no money. */

const view = (subtotalText = "100.000 ₫"): CartDrawerView => ({
  isEmpty: false,
  lines: [],
  subtotalText,
  hasUnavailableLines: false,
  canCheckout: true,
});

const run = (events: readonly CartDrawerEvent[], from: CartDrawerState = INITIAL_CART_DRAWER) =>
  events.reduce(reduceCartDrawer, from);

test("opening starts a read, shows nothing from before, and asks to focus the dialog", () => {
  const state = run([{ type: "OPEN", requestId: 1 }]);
  assert.deepEqual(
    [state.open, state.status, state.requestId, state.view, state.focus],
    [true, "loading", 1, null, "dialog"],
  );
});

test("the matching response fills the drawer", () => {
  const state = run([{ type: "OPEN", requestId: 1 }, { type: "LOADED", requestId: 1, view: view() }]);
  assert.deepEqual([state.status, state.view?.subtotalText], ["ready", "100.000 ₫"]);
});

test("a response for an older open is dropped, so an old cart never overwrites a newer one", () => {
  const state = run([
    { type: "OPEN", requestId: 1 },
    { type: "FAILED", requestId: 1 },
    { type: "OPEN", requestId: 2 },
    { type: "LOADED", requestId: 1, view: view("OLD") },
  ]);
  assert.deepEqual([state.status, state.view, state.requestId], ["loading", null, 2]);
  const fresh = reduceCartDrawer(state, { type: "LOADED", requestId: 2, view: view("NEW") });
  assert.equal(fresh.view?.subtotalText, "NEW");
});

test("a response that lands after the drawer was closed is dropped", () => {
  const closed = run([{ type: "OPEN", requestId: 1 }, { type: "CLOSE" }]);
  const late = reduceCartDrawer(closed, { type: "LOADED", requestId: 1, view: view() });
  assert.equal(late, closed);
  assert.equal(late.view, null);
});

test("a double activation while loading does not start a second read", () => {
  const first = run([{ type: "OPEN", requestId: 1 }]);
  assert.equal(reduceCartDrawer(first, { type: "OPEN", requestId: 2 }), first);
});

test("reopening never shows the previous contents as current", () => {
  const ready = run([{ type: "OPEN", requestId: 1 }, { type: "LOADED", requestId: 1, view: view() }]);
  const reopened = run([{ type: "CLOSE" }, { type: "OPEN", requestId: 2 }], ready);
  assert.deepEqual([reopened.status, reopened.view], ["loading", null]);
});

test("a failed read can be retried in place without moving focus", () => {
  const failed = run([{ type: "OPEN", requestId: 1 }, { type: "FOCUS_HANDLED" }, { type: "FAILED", requestId: 1 }]);
  assert.equal(failed.status, "error");
  const retry = reduceCartDrawer(failed, { type: "OPEN", requestId: 2 });
  assert.deepEqual([retry.status, retry.requestId, retry.focus], ["loading", 2, null]);
});

test("a null view (capability off) is an error state, not an empty cart", () => {
  const state = run([{ type: "OPEN", requestId: 1 }, { type: "LOADED", requestId: 1, view: null }]);
  assert.deepEqual([state.status, state.view], ["error", null]);
});

test("closing returns focus to the opener, once", () => {
  const closed = run([{ type: "OPEN", requestId: 1 }, { type: "FOCUS_HANDLED" }, { type: "CLOSE" }]);
  assert.deepEqual([closed.open, closed.status, closed.focus], [false, "idle", "opener"]);
  assert.equal(run([{ type: "FOCUS_HANDLED" }], closed).focus, null);
  assert.equal(run([{ type: "CLOSE" }]), INITIAL_CART_DRAWER, "closing a closed drawer is a no-op");
});

test("Tab wraps at the edges and is otherwise left to the browser", () => {
  assert.equal(resolveFocusTrapTarget({ shiftKey: false, activeIndex: 2, count: 3 }), 0);
  assert.equal(resolveFocusTrapTarget({ shiftKey: true, activeIndex: 0, count: 3 }), 2);
  assert.equal(resolveFocusTrapTarget({ shiftKey: false, activeIndex: 0, count: 3 }), null);
  assert.equal(resolveFocusTrapTarget({ shiftKey: true, activeIndex: 2, count: 3 }), null);
  assert.equal(resolveFocusTrapTarget({ shiftKey: false, activeIndex: 0, count: 1 }), 0);
});

test("focus that left the dialog is pulled back in, and an empty dialog traps nothing", () => {
  assert.equal(resolveFocusTrapTarget({ shiftKey: false, activeIndex: -1, count: 3 }), 0);
  assert.equal(resolveFocusTrapTarget({ shiftKey: true, activeIndex: -1, count: 3 }), 2);
  assert.equal(resolveFocusTrapTarget({ shiftKey: false, activeIndex: 9, count: 3 }), 0);
  assert.equal(resolveFocusTrapTarget({ shiftKey: false, activeIndex: 0, count: 0 }), null);
});

test("only a plain primary click opens the drawer; modified and middle clicks keep the link", () => {
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
  assert.equal(shouldOpenCartDrawer(click), true);
  for (const patch of [{ button: 1 }, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { defaultPrevented: true }]) {
    assert.equal(shouldOpenCartDrawer({ ...click, ...patch }), false, JSON.stringify(patch));
  }
});

/* ----------------------------------------------------------------- narrow view */

function line(overrides: Partial<StorefrontCartLine> = {}): StorefrontCartLine {
  return {
    variantId: "internal-variant-id",
    productName: "Áo khoác",
    productSlug: "ao-khoac",
    color: "Đen",
    size: "M",
    quantity: 2,
    price: 500_000,
    available: true,
    unavailableReason: null,
    isPreorder: false,
    media: { primary: { url: "https://content.pancake.vn/a.jpg", alt: "Ảnh" }, gallery: [] },
    ...overrides,
  } as StorefrontCartLine;
}

test("the drawer's figures are the cart route's own, passed through, never recomputed", () => {
  const cart = buildCartViewModel({ lines: [line(), line({ productName: "Quần", productSlug: "quan", quantity: 1, price: 300_000 })], commerceTrackingEnabled: false });
  const drawer = buildCartDrawerView(cart);
  assert.equal(drawer.subtotalText, cart.subtotalText);
  assert.equal(drawer.canCheckout, cart.canCheckout);
  assert.deepEqual(
    drawer.lines.map((l) => [l.productName, l.priceText, l.quantity, l.optionLabel, l.href]),
    cart.lines.map((l) => [l.productName, l.priceText, l.quantity, l.optionLabel, l.productSlug === null ? null : `/shop/${l.productSlug}`]),
  );
});

test("the browser gets no internal variant id and no tracking flag", () => {
  const drawer = buildCartDrawerView(buildCartViewModel({ lines: [line()], commerceTrackingEnabled: true }));
  const serialized = JSON.stringify(drawer);
  assert.equal(serialized.includes("internal-variant-id"), false);
  assert.equal(serialized.includes("commerceTrackingEnabled"), false);
  assert.deepEqual(drawer.lines.map((l) => l.key), ["line-0"]);
});

test("an unavailable line disables checkout and says why; a gone product has no link", () => {
  const drawer = buildCartDrawerView(
    buildCartViewModel({
      lines: [line({ available: false, unavailableReason: "OUT_OF_STOCK" }), line({ productSlug: null, productName: null })],
      commerceTrackingEnabled: false,
    }),
  );
  assert.equal(drawer.canCheckout, false);
  assert.equal(drawer.hasUnavailableLines, true);
  assert.equal(drawer.lines[0]?.availabilityLabel, "Tạm hết hàng");
  assert.equal(drawer.lines[1]?.href, null);
});

test("an empty cart is an empty drawer", () => {
  const drawer = buildCartDrawerView(buildCartViewModel({ lines: [], commerceTrackingEnabled: false }));
  assert.deepEqual([drawer.isEmpty, drawer.lines.length, drawer.canCheckout], [true, 0, true]);
});

test("the drawer is OFF unless CART_DRAWER_ENABLED is exactly \"true\"", () => {
  assert.equal(readCartDrawerEnabled({}), false);
  for (const value of ["", "false", "TRUE", "1", " true"]) {
    assert.equal(readCartDrawerEnabled({ CART_DRAWER_ENABLED: value }), false, value);
  }
  assert.equal(readCartDrawerEnabled({ CART_DRAWER_ENABLED: "true" }), true);
});
