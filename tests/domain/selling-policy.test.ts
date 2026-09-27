import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_NEGATIVE_STOCK_LIMIT,
  capacityFloor,
  effectivePolicy,
  parseSellingPolicyChange,
  readSellingModeFlags,
  resolveSellingPolicy,
  type SellingModeFlags,
} from "../../src/commerce/selling-policy.ts";

const ALL_FLAG_COMBINATIONS: readonly SellingModeFlags[] = [
  { sellingModesEnabled: false, preorderEnabled: false },
  { sellingModesEnabled: false, preorderEnabled: true },
  { sellingModesEnabled: true, preorderEnabled: false },
  { sellingModesEnabled: true, preorderEnabled: true },
];
const ON: SellingModeFlags = { sellingModesEnabled: true, preorderEnabled: true };

test("no stored row is STANDARD with the default limit, and valid", () => {
  for (const stored of [null, undefined]) {
    assert.deepEqual(resolveSellingPolicy(stored), {
      sellingMode: "STANDARD",
      negativeStockLimit: DEFAULT_NEGATIVE_STOCK_LIMIT,
      isDefault: true,
      valid: true,
    });
  }
  assert.equal(DEFAULT_NEGATIVE_STOCK_LIMIT, -20);
});

test("an unknown stored mode resolves to STANDARD and keeps the stored limit", () => {
  assert.deepEqual(resolveSellingPolicy({ sellingMode: "BACKORDER", negativeStockLimit: -5 }), {
    sellingMode: "STANDARD",
    negativeStockLimit: -5,
    isDefault: false,
    valid: true,
  });
});

test("a stored limit outside [-100000, 0] is returned as stored and marked invalid", () => {
  for (const limit of [1, -100_001, 1.5, Number.NaN]) {
    const resolved = resolveSellingPolicy({ sellingMode: "OVERSELL", negativeStockLimit: limit });
    assert.equal(resolved.valid, false, String(limit));
    assert.equal(Object.is(resolved.negativeStockLimit, limit), true, "never replaced by the default");
  }
  assert.equal(resolveSellingPolicy({ sellingMode: "OVERSELL", negativeStockLimit: -100_000 }).valid, true);
  assert.equal(resolveSellingPolicy({ sellingMode: "OVERSELL", negativeStockLimit: 0 }).valid, true);
});

test("an invalid stored policy refuses every decision under all four flag combinations", () => {
  for (const sellingMode of ["STANDARD", "OVERSELL", "PREORDER"]) {
    for (const flags of ALL_FLAG_COMBINATIONS) {
      const effective = effectivePolicy({ sellingMode, negativeStockLimit: 5 }, flags);
      assert.equal(effective.kind, "REFUSE", `${sellingMode} ${JSON.stringify(flags)}`);
      assert.equal(effective.kind === "REFUSE" && effective.reason, "INVALID_POLICY");
    }
  }
});

test("STANDARD ignores the limit: its floor is always 0", () => {
  assert.equal(capacityFloor("STANDARD", -20), 0);
  assert.equal(capacityFloor("OVERSELL", -20), -20);
  assert.equal(capacityFloor("PREORDER", -7), -7);
  const effective = effectivePolicy({ sellingMode: "STANDARD", negativeStockLimit: -50 }, ON);
  assert.equal(effective.kind === "SELL" && effective.floor, 0);
});

test("with SELLING_MODES_ENABLED off every valid policy is effectively STANDARD", () => {
  for (const sellingMode of ["OVERSELL", "PREORDER"]) {
    for (const preorderEnabled of [false, true]) {
      const effective = effectivePolicy(
        { sellingMode, negativeStockLimit: -20 },
        { sellingModesEnabled: false, preorderEnabled },
      );
      assert.equal(effective.kind, "SELL");
      if (effective.kind !== "SELL") continue;
      assert.equal(effective.mode, "STANDARD");
      assert.equal(effective.floor, 0);
      assert.equal(effective.downgrade, "SELLING_MODES_DISABLED");
      assert.equal(effective.stored.sellingMode, sellingMode, "the stored mode is still reported");
    }
  }
});

test("flag on → PREORDER saved → preorder flag off: the product sells STANDARD, never preorder", () => {
  const stored = { sellingMode: "PREORDER", negativeStockLimit: -20 };
  const whileOn = effectivePolicy(stored, ON);
  assert.equal(whileOn.kind === "SELL" && whileOn.mode, "PREORDER");
  assert.equal(whileOn.kind === "SELL" && whileOn.floor, -20);

  const afterOff = effectivePolicy(stored, { sellingModesEnabled: true, preorderEnabled: false });
  assert.equal(afterOff.kind, "SELL");
  if (afterOff.kind !== "SELL") return;
  assert.equal(afterOff.mode, "STANDARD");
  assert.equal(afterOff.floor, 0);
  assert.equal(afterOff.downgrade, "PREORDER_DISABLED");
});

test("OVERSELL needs only the capability flag; the preorder flag does not affect it", () => {
  const effective = effectivePolicy(
    { sellingMode: "OVERSELL", negativeStockLimit: -20 },
    { sellingModesEnabled: true, preorderEnabled: false },
  );
  assert.equal(effective.kind === "SELL" && effective.mode, "OVERSELL");
  assert.equal(effective.kind === "SELL" && effective.downgrade, null);
});

test("no stored row is STANDARD under every flag combination, with no downgrade reported", () => {
  for (const flags of ALL_FLAG_COMBINATIONS) {
    const effective = effectivePolicy(null, flags);
    assert.equal(effective.kind === "SELL" && effective.mode, "STANDARD");
    assert.equal(effective.kind === "SELL" && effective.downgrade, null);
  }
});

test("flags turn on only on the exact value true", () => {
  assert.deepEqual(readSellingModeFlags({}), { sellingModesEnabled: false, preorderEnabled: false });
  for (const value of ["1", "TRUE", " true", "yes", ""]) {
    assert.deepEqual(
      readSellingModeFlags({ SELLING_MODES_ENABLED: value, SELLING_MODE_PREORDER_ENABLED: value }),
      { sellingModesEnabled: false, preorderEnabled: false },
      JSON.stringify(value),
    );
  }
  assert.deepEqual(
    readSellingModeFlags({ SELLING_MODES_ENABLED: "true", SELLING_MODE_PREORDER_ENABLED: "true" }),
    { sellingModesEnabled: true, preorderEnabled: true },
  );
});

test("admin input parsing is strict about the limit", () => {
  assert.deepEqual(parseSellingPolicyChange({ sellingMode: "DEFAULT", negativeStockLimit: "junk" }), {
    kind: "RESET",
  });
  assert.deepEqual(parseSellingPolicyChange({ sellingMode: "OVERSELL", negativeStockLimit: "-20" }), {
    kind: "SET",
    sellingMode: "OVERSELL",
    negativeStockLimit: -20,
  });
  assert.deepEqual(parseSellingPolicyChange({ sellingMode: "STANDARD", negativeStockLimit: "0" }), {
    kind: "SET",
    sellingMode: "STANDARD",
    negativeStockLimit: 0,
  });
  for (const limit of ["1", "-0", "-100001", " -20", "-20 ", "-2e1", "-20.0", "", "abc", -20, null]) {
    assert.equal(
      parseSellingPolicyChange({ sellingMode: "OVERSELL", negativeStockLimit: limit }),
      null,
      JSON.stringify(limit),
    );
  }
  assert.equal(parseSellingPolicyChange({ sellingMode: "BACKORDER", negativeStockLimit: "-1" }), null);
  assert.equal(parseSellingPolicyChange({ sellingMode: null, negativeStockLimit: "-1" }), null);
});
