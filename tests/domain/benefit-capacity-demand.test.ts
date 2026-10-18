import assert from "node:assert/strict";
import test from "node:test";

import { aggregateBenefitCapacityDemand } from "../../src/commerce/benefit-capacity-demand.ts";
import { planCapacityResources } from "../../src/commerce/capacity-resources.ts";

test("A03 PAID X x1 + GIFT X x1 is one demand of 2, not two rows and not one unit", () => {
  assert.deepEqual(
    aggregateBenefitCapacityDemand([
      { role: "PAID", variantId: "x", quantity: 1 },
      { role: "GIFT", variantId: "x", quantity: 1 },
    ]),
    [{ variantId: "x", quantity: 2 }],
  );
});

test("A03 demand is summed per variant and ordered deterministically", () => {
  const demand = aggregateBenefitCapacityDemand([
    { role: "PAID", variantId: "b", quantity: 3 },
    { role: "GIFT", variantId: "a", quantity: 1 },
    { role: "PAID", variantId: "a", quantity: 2 },
  ]);
  assert.deepEqual(demand, [
    { variantId: "a", quantity: 3 },
    { variantId: "b", quantity: 3 },
  ]);
  assert.deepEqual(
    aggregateBenefitCapacityDemand([
      { role: "PAID", variantId: "a", quantity: 2 },
      { role: "PAID", variantId: "b", quantity: 3 },
      { role: "GIFT", variantId: "a", quantity: 1 },
    ]),
    demand,
    "input order must not change the result",
  );
});

test("A03 the existing planner turns the aggregated demand into one line with the summed quantity", () => {
  const demand = aggregateBenefitCapacityDemand([
    { role: "PAID", variantId: "x", quantity: 1 },
    { role: "GIFT", variantId: "x", quantity: 1 },
  ]);
  const plan = planCapacityResources(demand, []);
  assert.ok(plan.ok);
  assert.equal(plan.lines.length, 1);
  assert.equal(plan.lines[0]!.quantity, 2);
});

test("A03 a gift is never dropped from the reserved quantity", () => {
  const withGift = aggregateBenefitCapacityDemand([
    { role: "PAID", variantId: "x", quantity: 1 },
    { role: "GIFT", variantId: "y", quantity: 1 },
  ]);
  assert.deepEqual(withGift, [
    { variantId: "x", quantity: 1 },
    { variantId: "y", quantity: 1 },
  ]);
});

test("A03 impossible demand lines are call-site errors", () => {
  assert.throws(() => aggregateBenefitCapacityDemand([]), RangeError);
  assert.throws(() => aggregateBenefitCapacityDemand([{ role: "BONUS" as "PAID", variantId: "x", quantity: 1 }]), RangeError);
  assert.throws(() => aggregateBenefitCapacityDemand([{ role: "PAID", variantId: "", quantity: 1 }]), RangeError);
  assert.throws(() => aggregateBenefitCapacityDemand([{ role: "PAID", variantId: "x", quantity: 0 }]), RangeError);
  assert.throws(() => aggregateBenefitCapacityDemand([{ role: "GIFT", variantId: "x", quantity: 1.5 }]), RangeError);
  assert.throws(
    () =>
      aggregateBenefitCapacityDemand([
        { role: "PAID", variantId: "x", quantity: Number.MAX_SAFE_INTEGER },
        { role: "GIFT", variantId: "x", quantity: 1 },
      ]),
    RangeError,
  );
});
