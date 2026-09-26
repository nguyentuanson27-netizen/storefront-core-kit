import assert from "node:assert/strict";
import test from "node:test";

import {
  advisorySellableUnits,
  evaluatePlannedCapacity,
  planCapacityResources,
  wholeMirroredUnits,
} from "../../src/commerce/capacity-resources.ts";

test("a standalone line consumes its own variant, one unit per purchased unit", () => {
  assert.deepEqual(planCapacityResources([{ variantId: "v", quantity: 3 }], []), {
    ok: true,
    lines: [
      { variantId: "v", quantity: 3, resources: [{ variantId: "v", kind: "SELF", unitsPerLine: 1, quantity: 3 }] },
    ],
  });
});

test("a composite parent consumes each component x edge quantity x purchased quantity, never itself", () => {
  const plan = planCapacityResources(
    [{ variantId: "set", quantity: 2 }],
    [
      { parentVariantId: "set", componentVariantId: "top", quantity: 1 },
      { parentVariantId: "set", componentVariantId: "skirt", quantity: 3 },
    ],
  );
  assert.deepEqual(plan, {
    ok: true,
    lines: [
      {
        variantId: "set",
        quantity: 2,
        resources: [
          { variantId: "skirt", kind: "COMPONENT", unitsPerLine: 3, quantity: 6 },
          { variantId: "top", kind: "COMPONENT", unitsPerLine: 1, quantity: 2 },
        ],
      },
    ],
  });
});

test("duplicate purchased lines are merged before any resource is planned", () => {
  const plan = planCapacityResources(
    [
      { variantId: "v", quantity: 1 },
      { variantId: "v", quantity: 2 },
    ],
    [],
  );
  assert.ok(plan.ok);
  assert.equal(plan.lines.length, 1);
  assert.equal(plan.lines[0].quantity, 3);
  assert.equal(plan.lines[0].resources[0].quantity, 3);
});

test("unprovable topology and quantities fail closed", () => {
  assert.deepEqual(planCapacityResources([], []), { ok: false, reason: "EMPTY_ORDER", variantId: null });
  for (const quantity of [0, -1, 1.5, Number.NaN, 2_147_483_648]) {
    assert.equal(planCapacityResources([{ variantId: "v", quantity }], []).ok, false, String(quantity));
  }
  const nested = planCapacityResources(
    [{ variantId: "set", quantity: 1 }],
    [
      { parentVariantId: "set", componentVariantId: "inner", quantity: 1 },
      { parentVariantId: "inner", componentVariantId: "leaf", quantity: 1 },
    ],
  );
  assert.deepEqual(nested, { ok: false, reason: "INVALID_TOPOLOGY", variantId: "set" });
  for (const quantity of [0, -2, 1.5]) {
    assert.deepEqual(
      planCapacityResources(
        [{ variantId: "set", quantity: 1 }],
        [{ parentVariantId: "set", componentVariantId: "c", quantity }],
      ),
      { ok: false, reason: "INVALID_TOPOLOGY", variantId: "set" },
    );
  }
  assert.deepEqual(
    planCapacityResources(
      [{ variantId: "set", quantity: 1 }],
      [{ parentVariantId: "set", componentVariantId: "set", quantity: 1 }],
    ),
    { ok: false, reason: "INVALID_TOPOLOGY", variantId: "set" },
  );
  assert.deepEqual(
    planCapacityResources(
      [{ variantId: "set", quantity: 2 }],
      [{ parentVariantId: "set", componentVariantId: "c", quantity: 1_500_000_000 }],
    ),
    { ok: false, reason: "INVALID_TOPOLOGY", variantId: "set" },
  );
});

test("mirrored stock floors fractional aggregates and fails closed on non-finite values", () => {
  assert.equal(wholeMirroredUnits([]), 0);
  assert.equal(wholeMirroredUnits([1.5, 1.4]), 2);
  assert.equal(wholeMirroredUnits([2.999]), 2);
  assert.equal(wholeMirroredUnits([-1, 3]), 2);
  assert.equal(wholeMirroredUnits([Number.NaN]), null);
  assert.equal(wholeMirroredUnits([Number.POSITIVE_INFINITY]), null);
  assert.equal(wholeMirroredUnits([Number.MAX_VALUE, Number.MAX_VALUE]), null);
});

test("an order passes only if every shared resource fits after summing its lines", () => {
  const plan = planCapacityResources(
    [
      { variantId: "set", quantity: 1 },
      { variantId: "top", quantity: 1 },
    ],
    [{ parentVariantId: "set", componentVariantId: "top", quantity: 1 }],
  );
  assert.ok(plan.ok);
  const facts = (mirroredUnits: number, activeReservedUnits = 0) =>
    new Map([["top", { mirroredUnits, activeReservedUnits }]]);
  // One unit left: each line alone would fit, both together must not.
  assert.deepEqual(evaluatePlannedCapacity(plan.lines, facts(1)), { ok: false, variantId: "top" });
  assert.deepEqual(evaluatePlannedCapacity(plan.lines, facts(2)), { ok: true });
  assert.deepEqual(evaluatePlannedCapacity(plan.lines, facts(3, 2)), { ok: false, variantId: "top" });
  assert.deepEqual(evaluatePlannedCapacity(plan.lines, new Map()), { ok: false, variantId: "top" });
  assert.deepEqual(
    evaluatePlannedCapacity(plan.lines, new Map([["top", { mirroredUnits: null, activeReservedUnits: 0 }]])),
    { ok: false, variantId: "top" },
  );
});

test("advisory capacity for a set is the fewest whole sets its components can supply", () => {
  assert.equal(
    advisorySellableUnits([
      { unitsPerLine: 1, fact: { mirroredUnits: 10, activeReservedUnits: 2 } },
      { unitsPerLine: 3, fact: { mirroredUnits: 10, activeReservedUnits: 0 } },
    ]),
    3,
  );
  assert.equal(advisorySellableUnits([{ unitsPerLine: 1, fact: { mirroredUnits: -4, activeReservedUnits: 0 } }]), 0);
  assert.equal(advisorySellableUnits([{ unitsPerLine: 1, fact: { mirroredUnits: 1, activeReservedUnits: 5 } }]), 0);
  assert.equal(advisorySellableUnits([{ unitsPerLine: 1, fact: undefined }]), 0);
  assert.equal(advisorySellableUnits([{ unitsPerLine: 1, fact: { mirroredUnits: null, activeReservedUnits: 0 } }]), 0);
  assert.equal(advisorySellableUnits([]), 0);
});
