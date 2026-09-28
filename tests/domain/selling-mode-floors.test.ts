import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluatePlannedCapacity,
  planCapacityResources,
  resolveResourceFloors,
  type CapacityLinePlan,
  type CompositeEdgeFact,
  type ResourceCapacityFact,
} from "../../src/commerce/capacity-resources.ts";
import { effectivePolicy, type EffectiveSellingPolicy, type SellingModeFlags } from "../../src/commerce/selling-policy.ts";

const ON: SellingModeFlags = { sellingModesEnabled: true, preorderEnabled: true };
const OFF: SellingModeFlags = { sellingModesEnabled: false, preorderEnabled: false };

function plan(lines: { variantId: string; quantity: number }[], edges: CompositeEdgeFact[] = []): readonly CapacityLinePlan[] {
  const result = planCapacityResources(lines, edges);
  assert.ok(result.ok);
  return result.lines;
}

function facts(entries: Record<string, number | null>, held: Record<string, number> = {}) {
  return new Map<string, ResourceCapacityFact>(
    Object.entries(entries).map(([id, mirroredUnits]) => [id, { mirroredUnits, activeReservedUnits: held[id] ?? 0 }]),
  );
}

function policies(byVariant: Record<string, { sellingMode: string; negativeStockLimit: number } | null>, flags = ON) {
  return (variantId: string): EffectiveSellingPolicy => {
    assert.ok(variantId in byVariant, `policy asked for unexpected variant ${variantId}`);
    return effectivePolicy(byVariant[variantId], flags);
  };
}

function decide(
  lines: { variantId: string; quantity: number }[],
  stock: Record<string, number | null>,
  byVariant: Parameters<typeof policies>[0],
  { edges = [] as CompositeEdgeFact[], held = {} as Record<string, number>, flags = ON } = {},
) {
  const planned = plan(lines, edges);
  const floors = resolveResourceFloors(planned, policies(byVariant, flags));
  if (!floors.ok) return floors;
  return evaluatePlannedCapacity(planned, facts(stock, held), floors.floors);
}

const OVERSELL_20 = { sellingMode: "OVERSELL", negativeStockLimit: -20 };

test("without floors, evaluation is exactly the floor-0 rule it replaced", () => {
  const planned = plan([{ variantId: "v", quantity: 1 }]);
  assert.deepEqual(evaluatePlannedCapacity(planned, facts({ v: 1 })), { ok: true });
  assert.deepEqual(evaluatePlannedCapacity(planned, facts({ v: 0 })), { ok: false, variantId: "v", floor: 0 });
  assert.deepEqual(evaluatePlannedCapacity(planned, facts({ v: 1 }, { v: 1 })), { ok: false, variantId: "v", floor: 0 });
});

test("boundary at the limit: −19 allows one more unit, −20 refuses, and 2 units at −19 refuse", () => {
  assert.deepEqual(decide([{ variantId: "v", quantity: 1 }], { v: -19 }, { v: OVERSELL_20 }), { ok: true });
  assert.deepEqual(decide([{ variantId: "v", quantity: 1 }], { v: -20 }, { v: OVERSELL_20 }), {
    ok: false,
    variantId: "v",
    floor: -20,
  });
  assert.deepEqual(decide([{ variantId: "v", quantity: 2 }], { v: -19 }, { v: OVERSELL_20 }), {
    ok: false,
    variantId: "v",
    floor: -20,
  });
  // Holds count toward the limit exactly like mirrored consumption.
  assert.equal(decide([{ variantId: "v", quantity: 1 }], { v: -10 }, { v: OVERSELL_20 }, { held: { v: 10 } }).ok, false);
});

test("STANDARD ignores the stored limit, and the capability flag off turns OVERSELL into STANDARD", () => {
  const standard = { sellingMode: "STANDARD", negativeStockLimit: -20 };
  assert.equal(decide([{ variantId: "v", quantity: 1 }], { v: 0 }, { v: standard }).ok, false);
  assert.equal(decide([{ variantId: "v", quantity: 1 }], { v: 0 }, { v: OVERSELL_20 }).ok, true);
  assert.deepEqual(decide([{ variantId: "v", quantity: 1 }], { v: 0 }, { v: OVERSELL_20 }, { flags: OFF }), {
    ok: false,
    variantId: "v",
    floor: 0,
  });
  // A stored PREORDER with its own flag off sells as STANDARD, never below zero.
  const preorder = { sellingMode: "PREORDER", negativeStockLimit: -20 };
  assert.equal(
    decide([{ variantId: "v", quantity: 1 }], { v: 0 }, { v: preorder }, {
      flags: { sellingModesEnabled: true, preorderEnabled: false },
    }).ok,
    false,
  );
  assert.equal(decide([{ variantId: "v", quantity: 1 }], { v: 0 }, { v: preorder }).ok, true);
});

test("an invalid stored policy refuses the whole order under every flag combination", () => {
  for (const flags of [OFF, ON, { sellingModesEnabled: true, preorderEnabled: false }, { sellingModesEnabled: false, preorderEnabled: true }]) {
    assert.deepEqual(
      decide(
        [{ variantId: "ok", quantity: 1 }, { variantId: "bad", quantity: 1 }],
        { ok: 9, bad: 9 },
        { ok: null, bad: { sellingMode: "STANDARD", negativeStockLimit: 4 } },
        { flags },
      ),
      { ok: false, reason: "INVALID_POLICY", variantId: "bad" },
      JSON.stringify(flags),
    );
  }
});

test("floors are per variant: one variant at its limit does not stop a sibling above it", () => {
  const byVariant = { s: OVERSELL_20, m: OVERSELL_20 };
  assert.deepEqual(decide([{ variantId: "s", quantity: 1 }], { s: -20, m: -3 }, byVariant), {
    ok: false,
    variantId: "s",
    floor: -20,
  });
  assert.deepEqual(decide([{ variantId: "m", quantity: 1 }], { s: -20, m: -3 }, byVariant), { ok: true });
});

test("a set spends its components at floor 0, whatever the component's own product allows", () => {
  const edges = [
    { parentVariantId: "set", componentVariantId: "top", quantity: 1 },
    { parentVariantId: "set", componentVariantId: "skirt", quantity: 1 },
  ];
  // The component's product is never asked: only the purchased variant's policy counts.
  assert.deepEqual(decide([{ variantId: "set", quantity: 1 }], { top: 5, skirt: 0 }, { set: null }, { edges }), {
    ok: false,
    variantId: "skirt",
    floor: 0,
  });
  // A direct sale of that component keeps its own OVERSELL floor.
  assert.deepEqual(decide([{ variantId: "skirt", quantity: 1 }], { skirt: 0 }, { skirt: OVERSELL_20 }), { ok: true });
});

test("a variant bought directly and inside a set in one order is checked at floor 0 for its whole demand", () => {
  const edges = [{ parentVariantId: "set", componentVariantId: "skirt", quantity: 1 }];
  const planned = plan([{ variantId: "set", quantity: 1 }, { variantId: "skirt", quantity: 1 }], edges);
  const floors = resolveResourceFloors(planned, policies({ set: null, skirt: OVERSELL_20 }));
  assert.ok(floors.ok);
  assert.equal(floors.floors.get("skirt"), 0);
  // 1 unit on hand, 2 demanded: only floor −20 would let this through, and it does not apply.
  assert.deepEqual(evaluatePlannedCapacity(planned, facts({ skirt: 1 }), floors.floors), {
    ok: false,
    variantId: "skirt",
    floor: 0,
  });
});

test("a composite parent under a non-STANDARD effective mode refuses COMPOSITE_MODE_UNSUPPORTED", () => {
  const edges = [{ parentVariantId: "set", componentVariantId: "top", quantity: 1 }];
  for (const sellingMode of ["OVERSELL", "PREORDER"]) {
    assert.deepEqual(
      decide([{ variantId: "set", quantity: 1 }], { top: 5 }, { set: { sellingMode, negativeStockLimit: -20 } }, { edges }),
      { ok: false, reason: "COMPOSITE_MODE_UNSUPPORTED", variantId: "set" },
      sellingMode,
    );
  }
  // With the capability off the same row is effectively STANDARD, which a set may sell under.
  assert.deepEqual(
    decide([{ variantId: "set", quantity: 1 }], { top: 5 }, { set: OVERSELL_20 }, { edges, flags: OFF }),
    { ok: true },
  );
});

test("an untrusted mirror still refuses under a negative floor", () => {
  assert.deepEqual(decide([{ variantId: "v", quantity: 1 }], { v: null }, { v: OVERSELL_20 }), {
    ok: false,
    variantId: "v",
    floor: -20,
  });
});
