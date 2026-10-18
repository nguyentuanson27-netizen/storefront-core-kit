import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPlpFilterSummary,
  buildPlpResultAnnouncement,
  INITIAL_PLP_FILTER_DISCLOSURE,
  isPlpFilterPanelVisible,
  isPlpFilterTriggerVisible,
  reducePlpFilterDisclosure,
  resolvePlpChipRemovalFocus,
  type PlpFilterDisclosureEvent,
  type PlpFilterDisclosureState,
} from "../../src/components/headless/plp-filter-model.ts";
import {
  buildShopActiveFilters,
  buildShopViewModel,
  readShopFilterDisclosureEnabled,
} from "../../src/routes/shop-model.ts";
import type { StorefrontDiscoveryQuery } from "../../src/commerce/storefront-discovery.ts";

/** C02 — the filter region's interaction rules. No URL, sort or price is decided in this model. */

function run(events: readonly PlpFilterDisclosureEvent[], from = INITIAL_PLP_FILTER_DISCLOSURE) {
  return events.reduce(reducePlpFilterDisclosure, from);
}

const narrow: PlpFilterDisclosureState = run([{ type: "VIEWPORT", wide: false }]);
const wide: PlpFilterDisclosureState = run([{ type: "VIEWPORT", wide: true }]);

test("before the client has measured, the panel is visible and there is no trigger", () => {
  assert.equal(INITIAL_PLP_FILTER_DISCLOSURE.ready, false);
  assert.equal(isPlpFilterPanelVisible(INITIAL_PLP_FILTER_DISCLOSURE), true);
  assert.equal(isPlpFilterTriggerVisible(INITIAL_PLP_FILTER_DISCLOSURE), false);
  // A toggle that arrives before measurement cannot hide the form from a no-JS-equivalent state.
  assert.equal(run([{ type: "TOGGLE" }]), INITIAL_PLP_FILTER_DISCLOSURE);
});

test("a narrow viewport collapses the panel and shows the trigger, without moving focus", () => {
  assert.equal(narrow.ready, true);
  assert.equal(isPlpFilterPanelVisible(narrow), false);
  assert.equal(isPlpFilterTriggerVisible(narrow), true);
  assert.equal(narrow.focus, null);
});

test("a wide viewport never collapses and has no trigger", () => {
  assert.equal(isPlpFilterPanelVisible(wide), true);
  assert.equal(isPlpFilterTriggerVisible(wide), false);
  assert.equal(run([{ type: "TOGGLE" }, { type: "ESCAPE" }, { type: "NAVIGATED" }], wide), wide);
});

test("opening moves focus into the panel; toggling again returns it to the trigger", () => {
  const opened = run([{ type: "TOGGLE" }], narrow);
  assert.deepEqual([opened.open, opened.focus], [true, "panel"]);
  assert.equal(isPlpFilterPanelVisible(opened), true);

  const closed = run([{ type: "FOCUS_HANDLED" }, { type: "TOGGLE" }], opened);
  assert.deepEqual([closed.open, closed.focus], [false, "trigger"]);
});

test("Escape closes an open collapsed panel and restores focus to the trigger", () => {
  const closed = run([{ type: "TOGGLE" }, { type: "ESCAPE" }], narrow);
  assert.deepEqual([closed.open, closed.focus], [false, "trigger"]);
});

test("Escape does nothing when there is nothing to close", () => {
  assert.equal(run([{ type: "ESCAPE" }], narrow), narrow);
  assert.equal(run([{ type: "ESCAPE" }]), INITIAL_PLP_FILTER_DISCLOSURE);
});

test("the listing re-rendering for a new filter state closes the open panel onto the trigger", () => {
  const closed = run([{ type: "TOGGLE" }, { type: "FOCUS_HANDLED" }, { type: "NAVIGATED" }], narrow);
  assert.deepEqual([closed.open, closed.focus], [false, "trigger"]);
});

test("navigating with restoreFocus:false closes the panel and asks for no focus, so a chip's neighbour keeps it", () => {
  const opened = run([{ type: "TOGGLE" }, { type: "FOCUS_HANDLED" }], narrow);
  const closed = run([{ type: "NAVIGATED", restoreFocus: false }], opened);
  assert.deepEqual([closed.open, closed.focus], [false, null]);
  // The default is unchanged: no flag still returns focus to the trigger.
  assert.equal(run([{ type: "NAVIGATED" }], opened).focus, "trigger");
  assert.equal(run([{ type: "NAVIGATED", restoreFocus: true }], opened).focus, "trigger");
});

test("navigating while already collapsed does not steal focus", () => {
  assert.equal(run([{ type: "NAVIGATED" }], narrow), narrow);
});

test("a repeated identical viewport report is a no-op, and a change resets the panel", () => {
  assert.equal(run([{ type: "VIEWPORT", wide: false }], narrow), narrow);
  const rotated = run([{ type: "TOGGLE" }, { type: "VIEWPORT", wide: true }], narrow);
  assert.deepEqual([rotated.wide, rotated.open, rotated.focus], [true, false, null]);
});

test("FOCUS_HANDLED clears the intent exactly once", () => {
  const opened = run([{ type: "TOGGLE" }], narrow);
  const cleared = run([{ type: "FOCUS_HANDLED" }], opened);
  assert.equal(cleared.focus, null);
  assert.equal(run([{ type: "FOCUS_HANDLED" }], cleared), cleared);
});

test("the active count is the number of distinct applied filters", () => {
  assert.deepEqual(buildPlpFilterSummary([]), { activeCount: 0, hasActive: false });
  assert.deepEqual(buildPlpFilterSummary([{ value: "color" }, { value: "size" }]), {
    activeCount: 2,
    hasActive: true,
  });
  assert.equal(buildPlpFilterSummary([{ value: "color" }, { value: "color" }, { value: null }]).activeCount, 1);
});

test("sort is not a filter: the shop's own active filters never include it", () => {
  const discovery: StorefrontDiscoveryQuery = {
    query: null,
    color: null,
    size: null,
    availability: null,
    minPriceVnd: null,
    maxPriceVnd: null,
    collection: null,
    sort: "price-desc",
    page: 3,
  };
  assert.equal(buildPlpFilterSummary(buildShopActiveFilters(discovery)).activeCount, 0);
  assert.equal(
    buildPlpFilterSummary(buildShopActiveFilters({ ...discovery, color: "Ink", maxPriceVnd: 5 })).activeCount,
    2,
  );
});

test("after removing a chip focus goes to the next, else the previous, else nowhere", () => {
  const keys = ["query", "color", "size"];
  assert.equal(resolvePlpChipRemovalFocus(keys, "query"), "color");
  assert.equal(resolvePlpChipRemovalFocus(keys, "color"), "size");
  assert.equal(resolvePlpChipRemovalFocus(keys, "size"), "color");
  assert.equal(resolvePlpChipRemovalFocus(["color"], "color"), null);
  assert.equal(resolvePlpChipRemovalFocus(keys, "missing"), null);
  assert.equal(resolvePlpChipRemovalFocus([], "color"), null);
});

test("the result announcement states a count or an empty result", () => {
  assert.deepEqual(buildPlpResultAnnouncement(12), { kind: "results", count: 12 });
  assert.deepEqual(buildPlpResultAnnouncement(0), { kind: "empty" });
  assert.deepEqual(buildPlpResultAnnouncement(-1), { kind: "empty" });
  assert.deepEqual(buildPlpResultAnnouncement(Number.NaN), { kind: "empty" });
});

test("the collapsible panel is OFF unless SHOP_FILTER_DISCLOSURE_ENABLED is exactly \"true\"", () => {
  assert.equal(readShopFilterDisclosureEnabled({}), false);
  for (const value of ["", "false", "TRUE", "1", " true"]) {
    assert.equal(readShopFilterDisclosureEnabled({ SHOP_FILTER_DISCLOSURE_ENABLED: value }), false, value);
  }
  assert.equal(readShopFilterDisclosureEnabled({ SHOP_FILTER_DISCLOSURE_ENABLED: "true" }), true);
});

test("the shop view model carries the flag and defaults it off", () => {
  const base = {
    discovery: {
      query: null,
      color: null,
      size: null,
      availability: null,
      minPriceVnd: null,
      maxPriceVnd: null,
      collection: null,
      sort: "name-asc",
      page: 1,
    } satisfies StorefrontDiscoveryQuery,
    products: [],
    facets: { collections: [], colors: [], sizes: [] },
    totalCount: 0,
    totalPages: 1,
    page: 1,
    hasPrevious: false,
    hasNext: false,
    pageSize: 24,
    selectEventBySlug: new Map(),
  };
  assert.equal(buildShopViewModel(base).filterDisclosure, false);
  assert.equal(buildShopViewModel({ ...base, filterDisclosure: false }).filterDisclosure, false);
  assert.equal(buildShopViewModel({ ...base, filterDisclosure: true }).filterDisclosure, true);
});
