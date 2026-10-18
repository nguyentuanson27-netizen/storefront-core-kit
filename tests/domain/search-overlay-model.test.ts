import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSearchOverlayAnnouncement,
  INITIAL_SEARCH_OVERLAY,
  isSearchOverlayQueryReady,
  reduceSearchOverlay,
  resolveSuggestionArrow,
  type SearchOverlayEvent,
  type SearchOverlayState,
} from "../../src/components/headless/search-overlay-model.ts";
import {
  readSearchOverlayEnabled,
  type SearchSuggestionsModel,
} from "../../src/routes/search-suggestions-model.ts";

/** C05 — the search overlay's state and keyboard rules. It shows B07's answer; it decides no URL or price. */

const ok = (query: string, items = 2, totalCount = items): Extract<SearchSuggestionsModel, { ok: true }> => ({
  ok: true,
  query,
  items: Array.from({ length: items }, (_, i) => ({
    key: `p-${i}`,
    name: `P${i}`,
    href: `/shop/p-${i}`,
    image: null,
    priceText: "1 ₫",
    compareAtText: null,
    availability: "in-stock" as const,
  })),
  seeAllHref: `/shop?q=${query}`,
  totalCount,
  remainingCount: Math.max(totalCount - items, 0),
});

const run = (events: readonly SearchOverlayEvent[], from: SearchOverlayState = INITIAL_SEARCH_OVERLAY) =>
  events.reduce(reduceSearchOverlay, from);

const typed = (text: string) => run([{ type: "OPEN" }, { type: "FOCUS_HANDLED" }, { type: "INPUT", text }]);

test("opening focuses the input and starts from nothing", () => {
  const s = run([{ type: "OPEN" }]);
  assert.deepEqual([s.open, s.focus, s.status, s.query, s.result], [true, "input", "short", "", null]);
});

test("text below the minimum is 'short' and asks for nothing; at the minimum it is 'loading'", () => {
  assert.equal(typed("a").status, "short");
  assert.equal(typed("  a ").status, "short");
  assert.equal(typed("ao").status, "loading");
  assert.equal(isSearchOverlayQueryReady("ao"), true);
  assert.equal(isSearchOverlayQueryReady("a"), false);
  assert.equal(isSearchOverlayQueryReady("a".repeat(81)), false, "over the /shop bound is not asked");
});

test("a response for the current text and request fills the list", () => {
  const s = run([{ type: "REQUEST", requestId: 1 }, { type: "LOADED", requestId: 1, query: "ao", model: ok("ao", 3, 9) }], typed("ao"));
  assert.deepEqual([s.status, s.result?.items.length, s.result?.totalCount], ["ready", 3, 9]);
});

test("an answer for older text is dropped even if its request id matches", () => {
  const s = run(
    [
      { type: "REQUEST", requestId: 1 },
      { type: "INPUT", text: "ao so" },
      { type: "LOADED", requestId: 1, query: "ao", model: ok("ao") },
    ],
    typed("ao"),
  );
  assert.deepEqual([s.status, s.result], ["loading", null]);
});

test("a slow answer for an earlier request never replaces the newer one", () => {
  const s = run(
    [
      { type: "REQUEST", requestId: 1 },
      { type: "REQUEST", requestId: 2 },
      { type: "LOADED", requestId: 2, query: "ao", model: ok("ao", 1) },
      { type: "LOADED", requestId: 1, query: "ao", model: ok("ao", 5) },
    ],
    typed("ao"),
  );
  assert.equal(s.result?.items.length, 1);
});

test("an answer that lands after the overlay closed is dropped", () => {
  const closed = run([{ type: "REQUEST", requestId: 1 }, { type: "CLOSE" }], typed("ao"));
  const late = reduceSearchOverlay(closed, { type: "LOADED", requestId: 1, query: "ao", model: ok("ao") });
  assert.equal(late, closed);
});

test("typing clears the previous answer instead of showing it against new text", () => {
  const ready = run([{ type: "REQUEST", requestId: 1 }, { type: "LOADED", requestId: 1, query: "ao", model: ok("ao") }], typed("ao"));
  const next = reduceSearchOverlay(ready, { type: "INPUT", text: "ao s" });
  assert.deepEqual([next.status, next.result], ["loading", null]);
});

test("zero matches is 'empty', not an error", () => {
  const s = run([{ type: "REQUEST", requestId: 1 }, { type: "LOADED", requestId: 1, query: "zz", model: ok("zz", 0, 0) }], typed("zz"));
  assert.equal(s.status, "empty");
});

test("server failures are errors; a too-short or oversized refusal is the shopper's to fix", () => {
  const fail = (reason: "UNAVAILABLE" | "DISABLED" | "QUERY_TOO_SHORT" | "INVALID_QUERY") =>
    run([{ type: "REQUEST", requestId: 1 }, { type: "LOADED", requestId: 1, query: "ao", model: { ok: false, reason } }], typed("ao")).status;
  assert.equal(fail("UNAVAILABLE"), "error");
  assert.equal(fail("DISABLED"), "error");
  assert.equal(fail("QUERY_TOO_SHORT"), "short");
  assert.equal(fail("INVALID_QUERY"), "short");
  const thrown = run([{ type: "REQUEST", requestId: 1 }, { type: "FAILED", requestId: 1, query: "ao" }], typed("ao"));
  assert.deepEqual([thrown.status, thrown.result], ["error", null]);
});

test("closing resets the overlay, returns focus to the opener, and the next open starts clean", () => {
  const closed = run([{ type: "REQUEST", requestId: 1 }, { type: "LOADED", requestId: 1, query: "ao", model: ok("ao") }, { type: "CLOSE" }], typed("ao"));
  assert.deepEqual([closed.open, closed.query, closed.result, closed.focus], [false, "", null, "opener"]);
  const reopened = run([{ type: "OPEN" }], closed);
  assert.deepEqual([reopened.query, reopened.status, reopened.result], ["", "short", null]);
  assert.equal(run([{ type: "CLOSE" }]), INITIAL_SEARCH_OVERLAY);
});

test("events while closed change nothing", () => {
  for (const event of [{ type: "INPUT", text: "ao" }, { type: "REQUEST", requestId: 1 }] as const) {
    assert.equal(reduceSearchOverlay(INITIAL_SEARCH_OVERLAY, event), INITIAL_SEARCH_OVERLAY);
  }
});

test("arrows enter the list from the input, move down and up, and return to the input without wrapping", () => {
  const a = (key: string, activeIndex: number, count = 3) => resolveSuggestionArrow({ key, activeIndex, count });
  assert.equal(a("ArrowDown", -1), 0);
  assert.equal(a("ArrowDown", 0), 1);
  assert.equal(a("ArrowDown", 2), null, "no wrap at the end");
  assert.equal(a("ArrowUp", 2), 1);
  assert.equal(a("ArrowUp", 0), -1, "back to the input");
  assert.equal(a("ArrowUp", -1), null);
  assert.equal(a("ArrowDown", -1, 0), null, "nothing to enter");
  assert.equal(a("Enter", 0), null);
});

test("the announcement states loading, a count, empty or an error, and stays silent while short", () => {
  assert.equal(buildSearchOverlayAnnouncement(INITIAL_SEARCH_OVERLAY), null);
  assert.deepEqual(buildSearchOverlayAnnouncement(typed("ao")), { kind: "loading" });
  const ready = run([{ type: "REQUEST", requestId: 1 }, { type: "LOADED", requestId: 1, query: "ao", model: ok("ao", 2, 7) }], typed("ao"));
  assert.deepEqual(buildSearchOverlayAnnouncement(ready), { kind: "results", count: 2, total: 7 });
  const empty = run([{ type: "REQUEST", requestId: 1 }, { type: "LOADED", requestId: 1, query: "ao", model: ok("ao", 0, 0) }], typed("ao"));
  assert.deepEqual(buildSearchOverlayAnnouncement(empty), { kind: "empty" });
  const err = run([{ type: "REQUEST", requestId: 1 }, { type: "FAILED", requestId: 1, query: "ao" }], typed("ao"));
  assert.deepEqual(buildSearchOverlayAnnouncement(err), { kind: "error" });
});

test("the overlay needs both its own flag and search suggestions", () => {
  assert.equal(readSearchOverlayEnabled({}), false);
  assert.equal(readSearchOverlayEnabled({ SEARCH_OVERLAY_ENABLED: "true" }), false, "an overlay with nothing to suggest stays off");
  assert.equal(readSearchOverlayEnabled({ SEARCH_SUGGESTIONS_ENABLED: "true" }), false);
  assert.equal(readSearchOverlayEnabled({ SEARCH_OVERLAY_ENABLED: "true", SEARCH_SUGGESTIONS_ENABLED: "true" }), true);
  for (const value of ["", "false", "TRUE", "1", " true"]) {
    assert.equal(readSearchOverlayEnabled({ SEARCH_OVERLAY_ENABLED: value, SEARCH_SUGGESTIONS_ENABLED: "true" }), false, value);
  }
});
