import assert from "node:assert/strict";
import test from "node:test";

import type { SellingPolicyReportRow } from "../../src/commerce/selling-policy-repository.ts";
import { buildSellingPolicyReport, formatSellingPolicyReport } from "../../src/operations/selling-policy-report.ts";

function row(overrides: Partial<SellingPolicyReportRow> & Pick<SellingPolicyReportRow, "stored">): SellingPolicyReportRow {
  return {
    productId: "p",
    productSlug: "tee",
    updatedAt: new Date("2026-09-28T00:00:00Z"),
    variants: [{ variantId: "v", isCompositeParent: false, mirroredUnits: -3, activeReservedUnits: 0 }],
    ...overrides,
  };
}

test("the report shows stored vs effective policy and per-variant units under the flags", () => {
  const [line] = buildSellingPolicyReport(
    [row({ stored: { sellingMode: "OVERSELL", negativeStockLimit: -20 } })],
    { sellingModesEnabled: true, preorderEnabled: false },
  );
  assert.equal(line.effectiveMode, "OVERSELL");
  assert.equal(line.floor, -20);
  assert.deepEqual(line.flags, []);
  assert.deepEqual(line.variants, [
    { variantId: "v", freeUnits: -3, sellableUnits: 17, readyUnits: 0, atOrBelowFloor: false },
  ]);
});

test("downgrades, invalid rows, unsupported composites and exhausted variants are flagged", () => {
  const flagsOff = { sellingModesEnabled: false, preorderEnabled: false };
  const [downgraded] = buildSellingPolicyReport([row({ stored: { sellingMode: "OVERSELL", negativeStockLimit: -20 } })], flagsOff);
  assert.equal(downgraded.effectiveMode, "STANDARD");
  assert.deepEqual(downgraded.flags, ["AT_OR_BELOW_FLOOR", "SELLING_MODES_DISABLED"]);

  const [preorderOff] = buildSellingPolicyReport(
    [row({ stored: { sellingMode: "PREORDER", negativeStockLimit: -20 } })],
    { sellingModesEnabled: true, preorderEnabled: false },
  );
  assert.ok(preorderOff.flags.includes("PREORDER_DISABLED"));

  const [invalid] = buildSellingPolicyReport([row({ stored: { sellingMode: "OVERSELL", negativeStockLimit: 3 } })], flagsOff);
  assert.equal(invalid.effectiveMode, "REFUSE");
  assert.equal(invalid.floor, null);
  assert.deepEqual(invalid.flags, ["INVALID_POLICY"]);
  assert.equal(invalid.variants[0].sellableUnits, null);

  const [composite] = buildSellingPolicyReport(
    [
      row({
        stored: { sellingMode: "OVERSELL", negativeStockLimit: -20 },
        variants: [{ variantId: "set", isCompositeParent: true, mirroredUnits: 5, activeReservedUnits: 0 }],
      }),
    ],
    { sellingModesEnabled: true, preorderEnabled: true },
  );
  assert.deepEqual(composite.flags, ["COMPOSITE_MODE_UNSUPPORTED"]);
});

test("the formatted report states both flags and prints no buyer data", () => {
  const flags = { sellingModesEnabled: false, preorderEnabled: false };
  const text = formatSellingPolicyReport(
    buildSellingPolicyReport([row({ stored: { sellingMode: "STANDARD", negativeStockLimit: -20 } })], flags),
    flags,
  );
  assert.match(text, /^selling modes: disabled; preorder: disabled$/m);
  assert.match(text, /tee: stored STANDARD -20 → effective STANDARD \(floor 0\)/);
});
