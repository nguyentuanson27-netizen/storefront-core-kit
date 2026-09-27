import assert from "node:assert/strict";
import test from "node:test";

import type { AdvisoryCapacityResource } from "../../src/commerce/capacity-reservation-repository.ts";
import { advisorySellableUnits, wholeFreeUnits } from "../../src/commerce/capacity-resources.ts";
import type { SellingPolicyReportRow } from "../../src/commerce/selling-policy-repository.ts";
import { buildSellingPolicyReport, formatSellingPolicyReport } from "../../src/operations/selling-policy-report.ts";

function self(variantId: string, mirroredUnits: number | null, activeReservedUnits = 0): AdvisoryCapacityResource[] {
  return [{ variantId, kind: "SELF", unitsPerLine: 1, fact: { mirroredUnits, activeReservedUnits } }];
}

function row(overrides: Partial<SellingPolicyReportRow> & Pick<SellingPolicyReportRow, "stored">): SellingPolicyReportRow {
  return {
    productId: "p",
    productSlug: "tee",
    updatedAt: new Date("2026-09-28T00:00:00Z"),
    variants: [{ variantId: "v", isCompositeParent: false, capacityResources: self("v", -3) }],
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
    {
      variantId: "v",
      capacityBasis: "standalone",
      freeUnits: -3,
      floor: -20,
      sellableUnits: 17,
      readyUnits: 0,
      atOrBelowFloor: false,
    },
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
        variants: [
          {
            variantId: "set",
            isCompositeParent: true,
            capacityResources: [
              { variantId: "top", kind: "COMPONENT", unitsPerLine: 1, fact: { mirroredUnits: 5, activeReservedUnits: 0 } },
            ],
          },
        ],
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

test("a composite parent reports whole sets from its components, never its own stock, against floor 0", () => {
  // Parent's own mirror says 9, but it is never read: one required component is exhausted.
  const parent = {
    variantId: "set",
    isCompositeParent: true,
    capacityResources: [
      { variantId: "top", kind: "COMPONENT", unitsPerLine: 1, fact: { mirroredUnits: 4, activeReservedUnits: 0 } },
      { variantId: "skirt", kind: "COMPONENT", unitsPerLine: 2, fact: { mirroredUnits: 1, activeReservedUnits: 0 } },
    ],
  } satisfies SellingPolicyReportRow["variants"][number];

  for (const sellingMode of ["STANDARD", "OVERSELL"]) {
    const [line] = buildSellingPolicyReport(
      [row({ stored: { sellingMode, negativeStockLimit: -20 }, variants: [parent] })],
      { sellingModesEnabled: true, preorderEnabled: true },
    );
    assert.deepEqual(line.variants, [
      {
        variantId: "set",
        capacityBasis: "components",
        freeUnits: 0,
        floor: 0,
        sellableUnits: 0,
        readyUnits: 0,
        atOrBelowFloor: true,
      },
    ], sellingMode);
    assert.ok(line.flags.includes("AT_OR_BELOW_FLOOR"));
  }
});

test("unprovable topology and an untrusted mirror are reported as unknown, not as stock", () => {
  const [line] = buildSellingPolicyReport(
    [
      row({
        stored: { sellingMode: "STANDARD", negativeStockLimit: -20 },
        variants: [
          { variantId: "nested", isCompositeParent: true, capacityResources: null },
          { variantId: "gone", isCompositeParent: false, capacityResources: self("gone", null) },
        ],
      }),
    ],
    { sellingModesEnabled: false, preorderEnabled: false },
  );
  assert.deepEqual(
    line.variants.map(({ capacityBasis, freeUnits, sellableUnits, readyUnits }) => ({ capacityBasis, freeUnits, sellableUnits, readyUnits })),
    [
      { capacityBasis: "unprovable", freeUnits: null, sellableUnits: null, readyUnits: null },
      { capacityBasis: "standalone", freeUnits: null, sellableUnits: null, readyUnits: null },
    ],
  );
});

test("at floor 0 the report's units are exactly the storefront's advisory units", () => {
  const cases = [
    self("a", 7, 2),
    self("b", -4, 0),
    self("c", 3, 5),
    [
      { variantId: "x", kind: "COMPONENT" as const, unitsPerLine: 2, fact: { mirroredUnits: 9, activeReservedUnits: 2 } },
      { variantId: "y", kind: "COMPONENT" as const, unitsPerLine: 1, fact: { mirroredUnits: 5, activeReservedUnits: 0 } },
    ],
    [
      { variantId: "x", kind: "COMPONENT" as const, unitsPerLine: 3, fact: { mirroredUnits: -2, activeReservedUnits: 0 } },
    ],
  ];
  for (const resources of cases) {
    const free = wholeFreeUnits(resources);
    assert.equal(Math.max(0, free ?? 0), advisorySellableUnits(resources), JSON.stringify(resources));
  }
});
