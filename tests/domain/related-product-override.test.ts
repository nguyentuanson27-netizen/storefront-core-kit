import assert from "node:assert/strict";
import test from "node:test";

import {
  RELATED_OVERRIDE_DISPLAY_LIMIT,
  RELATED_OVERRIDE_MAX_ITEMS,
  readRelatedOverrideEnabled,
  selectRelatedOverride,
} from "../../src/commerce/related-product-override.ts";

const items = (...ids: string[]) => ids.map((id) => ({ id }));

test("B05 the approved bounds are 8 stored and 4 shown", () => {
  assert.equal(RELATED_OVERRIDE_MAX_ITEMS, 8);
  assert.equal(RELATED_OVERRIDE_DISPLAY_LIMIT, 4);
});

test("B05 the flag is strictly the string true and OFF by default", () => {
  assert.equal(readRelatedOverrideEnabled({}), false);
  assert.equal(readRelatedOverrideEnabled({ RELATED_PRODUCTS_OVERRIDE_ENABLED: "true" }), true);
  for (const other of ["True", "1", "yes", " true", "false", ""]) {
    assert.equal(readRelatedOverrideEnabled({ RELATED_PRODUCTS_OVERRIDE_ENABLED: other }), false, JSON.stringify(other));
  }
});

test("B05 stored order is kept and the list stops at the display limit", () => {
  assert.deepEqual(selectRelatedOverride("self", items("a", "b", "c")), items("a", "b", "c"));
  assert.deepEqual(selectRelatedOverride("self", items("a", "b", "c", "d", "e", "f")), items("a", "b", "c", "d"));
});

test("B05 the current product and repeats are excluded defensively", () => {
  assert.deepEqual(selectRelatedOverride("self", items("a", "self", "b", "a", "c")), items("a", "b", "c"));
});

test("B05 hidden candidates are simply absent, so the next stored candidate fills the rail", () => {
  // `visible` is what survived visibility filtering: b and d were hidden.
  assert.deepEqual(selectRelatedOverride("self", items("a", "c", "e", "f", "g")), items("a", "c", "e", "f"));
});

test("B05 nothing visible yields an empty list, which the caller treats as 'use the fallback'", () => {
  assert.deepEqual(selectRelatedOverride("self", []), []);
  assert.deepEqual(selectRelatedOverride("self", items("self")), []);
});
