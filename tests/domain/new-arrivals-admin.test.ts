import assert from "node:assert/strict";
import test from "node:test";

import {
  NEW_ARRIVALS_ADMIN_MESSAGES,
  NEW_ARRIVALS_MAX_PRODUCT_ID_LENGTH,
  parseNewArrivalsRevision,
  planNewArrivalsAppend,
  planNewArrivalsOrder,
  readNewArrivalsAdminReason,
} from "../../src/commerce/new-arrivals-admin.ts";

const plan = (productIds: string[], positions: unknown[], removals: string[] = [], revision: unknown = "3") =>
  planNewArrivalsOrder({ revision, productIds, positions, removals });

test("B02 saving untouched rows is a no-op on the order", () => {
  assert.deepEqual(plan(["a", "b", "c"], ["", "", ""]), { ok: true, revision: BigInt(3), productIds: ["a", "b", "c"] });
  assert.deepEqual(plan(["a", "b", "c"], ["1", "2", "3"]), { ok: true, revision: BigInt(3), productIds: ["a", "b", "c"] });
});

test("B02 position numbers reorder, and ties keep the rendered order", () => {
  assert.deepEqual(plan(["a", "b", "c"], ["3", "1", "2"]).ok && plan(["a", "b", "c"], ["3", "1", "2"]), {
    ok: true, revision: BigInt(3), productIds: ["b", "c", "a"],
  });
  const tie = plan(["a", "b", "c"], ["2", "2", "1"]);
  assert.ok(tie.ok);
  assert.deepEqual(tie.productIds, ["c", "a", "b"]);
});

test("B02 removals drop rows and the rest keep their relative order", () => {
  const result = plan(["a", "b", "c", "d"], ["", "", "", ""], ["b", "d"]);
  assert.ok(result.ok);
  assert.deepEqual(result.productIds, ["a", "c"]);
  const all = plan(["a"], [""], ["a"]);
  assert.ok(all.ok);
  assert.deepEqual(all.productIds, [], "removing everything clears the selection");
});

test("B02 a removed row's position is ignored", () => {
  const result = plan(["a", "b"], ["9", "1"], ["a"]);
  assert.ok(result.ok);
  assert.deepEqual(result.productIds, ["b"]);
});

test("B02 untrusted shapes are INVALID, duplicates are named", () => {
  assert.deepEqual(plan(["a", "b"], [""]), { ok: false, reason: "INVALID" }, "rows and positions must align");
  assert.deepEqual(plan(["a"], ["0"]), { ok: false, reason: "INVALID" });
  assert.deepEqual(plan(["a"], ["501"]), { ok: false, reason: "INVALID" });
  assert.deepEqual(plan(["a"], ["1.5"]), { ok: false, reason: "INVALID" });
  assert.deepEqual(plan(["a"], ["-1"]), { ok: false, reason: "INVALID" });
  assert.deepEqual(plan(["a"], [1]), { ok: false, reason: "INVALID" }, "positions arrive as strings");
  assert.deepEqual(plan([""], [""]), { ok: false, reason: "INVALID" });
  assert.deepEqual(plan(["x".repeat(NEW_ARRIVALS_MAX_PRODUCT_ID_LENGTH + 1)], [""]), { ok: false, reason: "INVALID" });
  assert.deepEqual(plan(["a"], [""], [""]), { ok: false, reason: "INVALID" });
  assert.deepEqual(plan(["a", "a"], ["", ""]), { ok: false, reason: "DUPLICATE_PRODUCT" });
  assert.deepEqual(plan(["a"], [""], [], null), { ok: false, reason: "INVALID" });
  assert.deepEqual(
    planNewArrivalsOrder({ revision: "1", productIds: "a" as unknown as string[], positions: [], removals: [] }),
    { ok: false, reason: "INVALID" },
  );
});

test("B02 more than 500 rendered rows is INVALID, not truncated", () => {
  const ids = Array.from({ length: 501 }, (_unused, index) => `p${index}`);
  assert.deepEqual(plan(ids, ids.map(() => "")), { ok: false, reason: "INVALID" });
  const max = Array.from({ length: 500 }, (_unused, index) => `p${index}`);
  assert.equal(plan(max, max.map(() => "")).ok, true);
});

test("B02 the revision is canonical decimal only", () => {
  assert.equal(parseNewArrivalsRevision("0"), BigInt(0));
  assert.equal(parseNewArrivalsRevision("123456789012345678"), BigInt("123456789012345678"));
  for (const bad of ["", "01", "-1", "+1", "1e3", "1.0", " 1", "1234567890123456789", 1, undefined, null]) {
    assert.equal(parseNewArrivalsRevision(bad), null, JSON.stringify(bad));
  }
});

test("B02 appending adds to the end and refuses duplicates and a full list", () => {
  const added = planNewArrivalsAppend({ revision: "2", productIds: ["a", "b"], productId: "c" });
  assert.deepEqual(added, { ok: true, revision: BigInt(2), productIds: ["a", "b", "c"] });
  assert.deepEqual(planNewArrivalsAppend({ revision: "2", productIds: ["a"], productId: "a" }), {
    ok: false,
    reason: "ALREADY_PRESENT",
  });
  const full = Array.from({ length: 500 }, (_unused, index) => `p${index}`);
  assert.deepEqual(planNewArrivalsAppend({ revision: "2", productIds: full, productId: "new" }), {
    ok: false,
    reason: "TOO_MANY",
  });
  assert.deepEqual(planNewArrivalsAppend({ revision: "x", productIds: [], productId: "a" }), {
    ok: false,
    reason: "INVALID",
  });
  assert.deepEqual(planNewArrivalsAppend({ revision: "2", productIds: [], productId: "" }), {
    ok: false,
    reason: "INVALID",
  });
});

test("B02 only known reasons reach the page; everything else collapses to INVALID", () => {
  for (const reason of Object.keys(NEW_ARRIVALS_ADMIN_MESSAGES)) {
    assert.equal(readNewArrivalsAdminReason(reason), reason);
  }
  for (const hostile of ["<script>", "toString", "__proto__", "constructor", undefined, ["TOO_MANY"], 1]) {
    assert.equal(readNewArrivalsAdminReason(hostile), "INVALID");
  }
});
