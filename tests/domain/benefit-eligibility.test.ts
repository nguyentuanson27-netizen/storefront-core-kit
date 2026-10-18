import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyLegacyPricing,
  evaluateBenefitEligibility,
  type BenefitEligibilityCampaign,
  type BenefitEligibilityLine,
} from "../../src/commerce/benefit-eligibility.ts";
import { DEFAULT_GUEST_SHIPPING_POLICY } from "../../src/commerce/guest-shipping-policy.ts";
import {
  resolvePromotionPricing,
  type ApplicablePromotionCampaign,
} from "../../src/commerce/promotion-pricing.ts";

const policy = DEFAULT_GUEST_SHIPPING_POLICY; // fee 30,000; free when subtotal > 1,000,000 OR qty >= 3

function line(
  lineKey: string,
  quantity: number,
  unitPriceVnd: number,
  campaignIds: string[] = [],
  legacy: BenefitEligibilityLine["legacy"] = "NONE",
): BenefitEligibilityLine {
  return { lineKey, quantity, unitPriceVnd, legacy, campaignIds };
}

const percentCampaign = (
  id: string,
  tiers: Array<[number, number]>,
  by: "quantity" | "basis" = "quantity",
): BenefitEligibilityCampaign => ({
  id,
  tiers: tiers.map(([threshold, percentageValue]) => ({
    minEligibleQuantity: by === "quantity" ? threshold : null,
    minBasisVnd: by === "basis" ? threshold : null,
    percentageValue,
  })),
});

const evaluate = (
  lines: BenefitEligibilityLine[],
  campaigns: BenefitEligibilityCampaign[] = [],
) => evaluateBenefitEligibility({ lines, campaigns, shippingPolicy: policy });

const legacyCampaign = (
  overrides: Partial<ApplicablePromotionCampaign> = {},
): ApplicablePromotionCampaign => ({
  id: "legacy-1",
  name: "Sale",
  kind: "PROMOTION",
  discountType: "PERCENTAGE",
  percentageValue: 10,
  fixedPriceVnd: null,
  startsAt: null,
  endsAt: null,
  ...overrides,
});
const now = new Date("2026-10-18T00:00:00Z");

test("A05 the legacy verdict is read from the resolver's own result", () => {
  const price = (campaigns: ApplicablePromotionCampaign[], base: number | null = 100_000) =>
    classifyLegacyPricing(resolvePromotionPricing({ basePriceVnd: base, campaigns, now }));

  assert.equal(price([]), "NONE");
  assert.equal(price([legacyCampaign()]), "DISCOUNTED");
  assert.equal(price([legacyCampaign(), legacyCampaign({ id: "legacy-2" })]), "AMBIGUOUS");
  assert.equal(price([legacyCampaign({ percentageValue: null })]), "AMBIGUOUS");
  assert.equal(price([], null), null, "an unpurchasable line has no verdict");
});

test("A05 with no campaign the quote is the legacy quote and shipping is the legacy rule", () => {
  const result = evaluate([line("a", 1, 400_000)]);
  assert.equal(result.campaignId, null);
  assert.equal(result.refusal, null);
  assert.equal(result.discountVnd, 0);
  assert.equal(result.paidSubtotalVnd, 400_000);
  assert.equal(result.shippingFeeVnd, 30_000);
  assert.equal(result.totalVnd, 430_000);
});

test("A05 shipping subtotal boundary is strict: 999,999 / 1,000,000 charge, 1,000,001 is free", () => {
  assert.equal(evaluate([line("a", 1, 999_999)]).shippingFeeVnd, 30_000);
  assert.equal(evaluate([line("a", 1, 1_000_000)]).shippingFeeVnd, 30_000);
  assert.equal(evaluate([line("a", 1, 1_000_001)]).shippingFeeVnd, 0);
});

test("A05 shipping quantity boundary is inclusive: 2 units charge, 3 are free", () => {
  assert.equal(evaluate([line("a", 2, 100_000)]).shippingFeeVnd, 30_000);
  assert.equal(evaluate([line("a", 3, 100_000)]).shippingFeeVnd, 0);
  assert.equal(evaluate([line("a", 1, 100_000), line("b", 2, 100_000)]).shippingFeeVnd, 0);
});

test("A05 mixed cart: A x1 eligible + B x2 ineligible => campaign count 1, shipping count 3", () => {
  const result = evaluate(
    [line("A", 1, 300_000, ["c1"]), line("B", 2, 200_000)],
    [percentCampaign("c1", [[1, 10]])],
  );
  assert.equal(result.eligiblePaidQuantity, 1);
  assert.equal(result.paidQuantity, 3);
  assert.equal(result.shippingFeeVnd, 0, "shipping counts all three paid units");
  assert.equal(result.lines.find((l) => l.lineKey === "B")!.benefitApplied, false);
});

test("A05 no eligible units => the campaign is not evaluated but shipping still counts the cart", () => {
  const result = evaluate([line("B", 3, 100_000)], [percentCampaign("c1", [[1, 10]])]);
  assert.equal(result.campaignId, null);
  assert.equal(result.eligiblePaidQuantity, 0);
  assert.equal(result.paidQuantity, 3);
  assert.equal(result.shippingFeeVnd, 0);
});

test("A05 tier thresholds by quantity: just below / at / above", () => {
  const campaign = percentCampaign("c1", [[2, 10], [4, 20]]);
  const at = (quantity: number) => evaluate([line("A", quantity, 100_000, ["c1"])], [campaign]);

  assert.equal(at(1).tierIndex, null);
  assert.equal(at(1).discountVnd, 0);
  assert.equal(at(2).tierIndex, 0);
  assert.equal(at(3).tierIndex, 0);
  assert.equal(at(4).tierIndex, 1);
  assert.equal(at(5).tierIndex, 1);
  assert.equal(at(4).paidSubtotalVnd, 4 * 80_000);
});

test("A05 tier thresholds by basis are measured on the frozen basis, just below / at / above", () => {
  const campaign = percentCampaign("c1", [[500_000, 10]], "basis");
  const at = (unit: number) => evaluate([line("A", 1, unit, ["c1"])], [campaign]);

  assert.equal(at(499_999).tierIndex, null);
  assert.equal(at(500_000).tierIndex, 0);
  assert.equal(at(500_001).tierIndex, 0);
});

test("A05 a legacy-discounted line counts toward the basis at its effective price but gets no A1 benefit", () => {
  const result = evaluate(
    [line("sale", 1, 450_000, ["c1"], "DISCOUNTED"), line("full", 1, 100_000, ["c1"])],
    [percentCampaign("c1", [[500_000, 10]], "basis")],
  );
  assert.equal(result.basisVnd, 550_000);
  assert.equal(result.tierIndex, 0, "450,000 counts toward the 500,000 threshold");
  const sale = result.lines.find((l) => l.lineKey === "sale")!;
  const full = result.lines.find((l) => l.lineKey === "full")!;
  assert.equal(sale.benefitApplied, false);
  assert.equal(sale.finalUnitPriceVnd, 450_000, "no second discount on a legacy-discounted line");
  assert.equal(full.benefitApplied, true);
  assert.equal(full.finalUnitPriceVnd, 90_000);
});

test("A05 an ambiguous legacy line refuses the whole campaign and leaves legacy money alone", () => {
  const lines = [line("amb", 1, 400_000, ["c1"], "AMBIGUOUS"), line("ok", 2, 100_000, ["c1"])];
  const result = evaluate(lines, [percentCampaign("c1", [[1, 50]])]);
  assert.equal(result.refusal, "A1_LEGACY_AMBIGUOUS");
  assert.equal(result.tierIndex, null);
  assert.equal(result.discountVnd, 0);
  assert.equal(result.paidSubtotalVnd, 600_000);
  assert.ok(result.lines.every((l) => !l.benefitApplied));
});

test("A05 an ambiguous line outside the campaign scope does not refuse it", () => {
  const result = evaluate(
    [line("amb", 1, 400_000, [], "AMBIGUOUS"), line("ok", 2, 100_000, ["c1"])],
    [percentCampaign("c1", [[1, 10]])],
  );
  assert.equal(result.refusal, null);
  assert.equal(result.tierIndex, 0);
});

test("A05 two campaigns with in-scope lines => none is granted, no ranking", () => {
  const result = evaluate(
    [line("a", 1, 100_000, ["c1"]), line("b", 1, 100_000, ["c2"])],
    [percentCampaign("c1", [[1, 10]]), percentCampaign("c2", [[1, 20]])],
  );
  assert.equal(result.refusal, "A1_MULTIPLE_CAMPAIGNS");
  assert.equal(result.campaignId, null);
  assert.equal(result.discountVnd, 0);

  const sameLine = evaluate(
    [line("a", 1, 100_000, ["c1", "c2"])],
    [percentCampaign("c1", [[1, 10]]), percentCampaign("c2", [[1, 20]])],
  );
  assert.equal(sameLine.refusal, "A1_MULTIPLE_CAMPAIGNS");
});

test("A05 a second campaign with no in-scope line in this cart does not conflict", () => {
  const result = evaluate(
    [line("a", 1, 100_000, ["c1"])],
    [percentCampaign("c1", [[1, 10]]), percentCampaign("c2", [[1, 20]])],
  );
  assert.equal(result.refusal, null);
  assert.equal(result.campaignId, "c1");
});

test("A05 one pass: the discount never feeds back into the tier, only into shipping", () => {
  // Basis 1,050,000 reaches the 1,000,000 step; after 10% the paid subtotal is 945,000, below the
  // free-shipping threshold, so shipping is charged — and the tier is not re-evaluated downward.
  const result = evaluate(
    [line("a", 1, 525_000, ["c1"]), line("b", 1, 525_000, ["c1"])],
    [percentCampaign("c1", [[1_000_000, 10]], "basis")],
  );
  assert.equal(result.basisVnd, 1_050_000);
  assert.equal(result.tierIndex, 0);
  assert.equal(result.paidSubtotalVnd, 945_000);
  assert.equal(result.shippingFeeVnd, 30_000);
  assert.equal(result.totalVnd, 975_000);
});

test("A05 a gift step unlocks a gift without changing price or shipping count", () => {
  const campaign: BenefitEligibilityCampaign = {
    id: "g1",
    tiers: [{ minEligibleQuantity: null, minBasisVnd: 500_000, percentageValue: null }],
  };
  const below = evaluate([line("a", 1, 499_999, ["g1"])], [campaign]);
  assert.equal(below.giftUnlocked, false);

  const reached = evaluate([line("a", 1, 500_000, ["g1"])], [campaign]);
  assert.equal(reached.giftUnlocked, true);
  assert.equal(reached.discountVnd, 0);
  assert.equal(reached.paidQuantity, 1, "a gift never adds to the paid quantity");
  assert.equal(reached.shippingFeeVnd, 30_000);
});

test("A05 percentage rounding matches the legacy resolver for the same unit price", () => {
  for (const unit of [1, 2, 3, 99, 101, 12_345, 999_999, 1_000_001]) {
    for (const percent of [1, 5, 10, 33, 50, 99]) {
      const legacy = resolvePromotionPricing({
        basePriceVnd: unit,
        campaigns: [legacyCampaign({ percentageValue: percent })],
        now,
      });
      const result = evaluate([line("a", 1, unit, ["c1"])], [percentCampaign("c1", [[1, percent]])]);
      const expected = legacy.isDiscounted ? legacy.effectivePriceVnd : unit;
      assert.equal(result.lines[0]!.finalUnitPriceVnd, expected, `${unit} at ${percent}%`);
    }
  }
});

test("A05 the result is frozen and the inputs are not mutated", () => {
  const lines = [line("a", 1, 100_000, ["c1"])];
  const snapshot = JSON.stringify(lines);
  const result = evaluate(lines, [percentCampaign("c1", [[1, 10]])]);
  assert.equal(JSON.stringify(lines), snapshot);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.lines));
});

test("A05 malformed input is a call-site error, never a silent guess", () => {
  const ok = [line("a", 1, 100_000, ["c1"])];
  const campaign = percentCampaign("c1", [[1, 10]]);
  assert.throws(() => evaluate([], [campaign]), RangeError);
  assert.throws(() => evaluate([line("a", 0, 100_000)]), RangeError);
  assert.throws(() => evaluate([line("a", 1, 0)]), RangeError);
  assert.throws(() => evaluate([line("a", 1.5, 100_000)]), RangeError);
  assert.throws(() => evaluate([line("a", 1, 100_000), line("a", 1, 100_000)]), RangeError);
  assert.throws(() => evaluate([line("a", 1, 100_000, [], "BOGUS" as "NONE")]), RangeError);
  assert.throws(() => evaluate([line("a", Number.MAX_SAFE_INTEGER, 2)]), RangeError);
  assert.throws(() => evaluate(ok, [campaign, campaign]), RangeError);
  assert.throws(() => evaluate(ok, [{ id: "c1", tiers: [] }]), RangeError);
  assert.throws(() => evaluate(ok, [percentCampaign("c1", [[1, 0]])]), RangeError);
  assert.throws(() => evaluate(ok, [percentCampaign("c1", [[1, 100]])]), RangeError);
  assert.throws(() => evaluate(ok, [percentCampaign("c1", [[2, 10], [2, 20]])]), RangeError);
  assert.throws(() => evaluate(ok, [percentCampaign("c1", [[4, 10], [2, 20]])]), RangeError);
  assert.throws(
    () =>
      evaluate(ok, [
        { id: "c1", tiers: [{ minEligibleQuantity: 1, minBasisVnd: 1, percentageValue: 10 }] },
      ]),
    RangeError,
  );
  assert.throws(
    () =>
      evaluate(ok, [
        {
          id: "c1",
          tiers: [
            { minEligibleQuantity: 1, minBasisVnd: null, percentageValue: 10 },
            { minEligibleQuantity: 2, minBasisVnd: null, percentageValue: null },
          ],
        },
      ]),
    RangeError,
    "a ladder may not mix price and gift steps",
  );
});

test("A05 a percentage that rounds back to the unit price leaves the line alone", () => {
  // 1 VND at 1%: (1*99+50)/100 = 1 — not a discount, exactly like the legacy resolver.
  const result = evaluate([line("a", 1, 1, ["c1"])], [percentCampaign("c1", [[1, 1]])]);
  assert.equal(result.tierIndex, 0);
  assert.equal(result.lines[0]!.benefitApplied, false);
  assert.equal(result.discountVnd, 0);
});
