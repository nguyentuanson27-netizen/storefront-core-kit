import assert from "node:assert/strict";
import test from "node:test";

import { HOMEPAGE_FEATURED_MAX_ITEMS } from "../../src/commerce/homepage-featured-repository.ts";
import {
  planNewArrivalsAppend,
  planNewArrivalsOrder,
} from "../../src/commerce/new-arrivals-admin.ts";
import { readHomepageFeaturedEnabled } from "../../src/routes/home-model.ts";

const limits = { maxItems: HOMEPAGE_FEATURED_MAX_ITEMS };
const ids = (count: number) => Array.from({ length: count }, (_unused, index) => `p${index}`);

test("B04 the approved ceiling is 12", () => {
  assert.equal(HOMEPAGE_FEATURED_MAX_ITEMS, 12);
});

test("B04 the flag is strictly the string true and OFF by default", () => {
  assert.equal(readHomepageFeaturedEnabled({}), false);
  assert.equal(readHomepageFeaturedEnabled({ HOMEPAGE_FEATURED_ENABLED: "true" }), true);
  for (const other of ["True", "TRUE", "1", "yes", " true", "false", ""]) {
    assert.equal(readHomepageFeaturedEnabled({ HOMEPAGE_FEATURED_ENABLED: other }), false, JSON.stringify(other));
  }
});

test("B04 the shared planner enforces the homepage ceiling, not the 500 of the other surface", () => {
  const twelve = ids(12);
  const ok = planNewArrivalsOrder(
    { revision: "1", productIds: twelve, positions: twelve.map(() => ""), removals: [] },
    limits,
  );
  assert.equal(ok.ok, true);

  const thirteen = ids(13);
  assert.deepEqual(
    planNewArrivalsOrder({ revision: "1", productIds: thirteen, positions: thirteen.map(() => ""), removals: [] }, limits),
    { ok: false, reason: "INVALID" },
  );
  // Without limits the other surface's default still allows 13.
  assert.equal(
    planNewArrivalsOrder({ revision: "1", productIds: thirteen, positions: thirteen.map(() => ""), removals: [] }).ok,
    true,
  );
});

test("B04 a position above the ceiling is invalid, one at the ceiling is fine", () => {
  const plan = (position: string) =>
    planNewArrivalsOrder({ revision: "1", productIds: ["a"], positions: [position], removals: [] }, limits);
  assert.equal(plan("12").ok, true);
  assert.deepEqual(plan("13"), { ok: false, reason: "INVALID" });
});

test("B04 appending to a full homepage list is refused", () => {
  assert.deepEqual(planNewArrivalsAppend({ revision: "1", productIds: ids(12), productId: "extra" }, limits), {
    ok: false,
    reason: "TOO_MANY",
  });
  assert.equal(planNewArrivalsAppend({ revision: "1", productIds: ids(11), productId: "extra" }, limits).ok, true);
});
