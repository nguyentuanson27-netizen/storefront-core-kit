import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateBenefitEligibility,
  type BenefitEligibilityCampaign,
  type BenefitEligibilityLine,
} from "../../src/commerce/benefit-eligibility.ts";
import { aggregateBenefitCapacityDemand } from "../../src/commerce/benefit-capacity-demand.ts";
import {
  benefitQuoteFactsFromPersistedOrder,
  buildBenefitQuoteFacts,
  giftLineId,
  paidLineId,
  projectSignedBenefitQuoteForPancake,
  projectPersistedBenefitOrderForPancake,
  quoteFormatFor,
  toBenefitOrderRows,
  type BenefitCampaignIdentity,
  type BenefitGiftLineInput,
  type BenefitPaidLineInput,
  type BenefitVariantDescriptor,
} from "../../src/commerce/benefit-quote-adapters.ts";
import { issueBenefitQuoteProof, verifyBenefitQuoteProof } from "../../src/commerce/benefit-quote-proof.ts";
import { DEFAULT_GUEST_SHIPPING_POLICY } from "../../src/commerce/guest-shipping-policy.ts";

const secret = "test-server-secret-at-least-32-characters-long";
const cartId = "0f8d3c2a-4b1e-4d7a-9c6b-2e5f1a8d4c30";
const policy = DEFAULT_GUEST_SHIPPING_POLICY;

const campaignIdentity: BenefitCampaignIdentity = { id: "camp-1", kind: "GIFT_ITEM", name: "Mua 1 tặng 1" };
const tierIdentity: BenefitCampaignIdentity = { id: "camp-1", kind: "QUANTITY_TIER", name: "Giảm theo số lượng" };

const evalLine = (
  lineKey: string,
  quantity: number,
  unitPriceVnd: number,
  campaignIds: string[] = [],
  legacy: BenefitEligibilityLine["legacy"] = "NONE",
): BenefitEligibilityLine => ({ lineKey, quantity, unitPriceVnd, legacy, campaignIds });

const giftCampaign: BenefitEligibilityCampaign = {
  id: "camp-1",
  tiers: [{ minEligibleQuantity: null, minBasisVnd: 500_000, percentageValue: null }],
};
const tierCampaign: BenefitEligibilityCampaign = {
  id: "camp-1",
  tiers: [
    { minEligibleQuantity: 2, minBasisVnd: null, percentageValue: 10 },
    { minEligibleQuantity: 4, minBasisVnd: null, percentageValue: 20 },
  ],
};

const paidInputs: BenefitPaidLineInput[] = [
  { lineKey: "vx", variantExternalId: "pancake-x", quantity: 1 },
  { lineKey: "vy", variantExternalId: "pancake-y", quantity: 2 },
];
const variants = new Map<string, BenefitVariantDescriptor>([
  ["pancake-x", { variantId: "vx", productName: "Áo X", color: "Đen", size: "M" }],
  ["pancake-y", { variantId: "vy", productName: "Quần Y", color: null, size: "L" }],
]);
const gifts: BenefitGiftLineInput[] = [
  { giftKey: "vx", variantExternalId: "pancake-x", quantity: 1, entitlementKey: "gift-1" },
];

function giftScenario() {
  const evaluation = evaluateBenefitEligibility({
    lines: [evalLine("vx", 1, 500_000, ["camp-1"]), evalLine("vy", 2, 100_000)],
    campaigns: [giftCampaign],
    shippingPolicy: policy,
  });
  return { evaluation, facts: buildBenefitQuoteFacts({ paidLines: paidInputs, gifts, evaluation }) };
}

/** What a database round-trip returns: the rows' stored columns, as the persisted-rebuild reads them. */
function persisted(facts: ReturnType<typeof giftScenario>["facts"], campaign: BenefitCampaignIdentity | null) {
  const { order, lines } = toBenefitOrderRows(facts, campaign, variants);
  return {
    order: {
      quoteVersion: order.quoteVersion as number | null,
      benefitCampaignId: order.benefitCampaignId,
      benefitEligibleQuantity: order.benefitEligibleQuantity,
      benefitBasisVnd: order.benefitBasisVnd,
      benefitTierIndex: order.benefitTierIndex,
      merchandiseSubtotalVnd: order.merchandiseSubtotalVnd as bigint | null,
      shippingFeeVnd: order.shippingFeeVnd as bigint | null,
      totalVnd: order.totalVnd as bigint | null,
    },
    rows: lines,
  };
}

const proofOf = (facts: NonNullable<ReturnType<typeof benefitQuoteFactsFromPersistedOrder>>) =>
  issueBenefitQuoteProof({ quote: facts, cartId, secret });

test("A04 a gift quote: PAID X + GIFT X are two lines and the proof verifies", () => {
  const { evaluation, facts } = giftScenario();
  assert.equal(quoteFormatFor(evaluation), "laq2");
  assert.deepEqual(
    facts.lines.map((line) => [line.lineId, line.role, line.variantExternalId, line.unitPriceVnd]),
    [
      [paidLineId("vx"), "PAID", "pancake-x", 500_000],
      [paidLineId("vy"), "PAID", "pancake-y", 100_000],
      [giftLineId("camp-1", "vx"), "GIFT", "pancake-x", 0],
    ],
  );
  assert.equal(facts.paidQuantity, 3, "the gift never adds to the paid quantity");
  assert.equal(facts.shippingFeeVnd, 0, "three paid units ship free, gift or not");
  const proof = issueBenefitQuoteProof({ quote: facts, cartId, secret });
  assert.ok(proof);
  assert.deepEqual(verifyBenefitQuoteProof({ proof, cartId, currentQuote: facts, secret }), { ok: true });
});

test("A04 rendered proof equals the proof rebuilt from the persisted rows (gift quote)", () => {
  const { facts } = giftScenario();
  const rendered = issueBenefitQuoteProof({ quote: facts, cartId, secret });
  const stored = persisted(facts, campaignIdentity);
  const rebuilt = benefitQuoteFactsFromPersistedOrder(stored.order, stored.rows);
  assert.ok(rebuilt);
  assert.equal(proofOf(rebuilt), rendered, "byte-identical proof");
});

test("A04 rendered proof equals the rebuilt proof for a tier discount", () => {
  const evaluation = evaluateBenefitEligibility({
    lines: [evalLine("vx", 1, 500_000, ["camp-1"]), evalLine("vy", 2, 100_000, ["camp-1"])],
    campaigns: [tierCampaign],
    shippingPolicy: policy,
  });
  assert.equal(evaluation.tierIndex, 0);
  const facts = buildBenefitQuoteFacts({ paidLines: paidInputs, gifts: [], evaluation });
  assert.ok(facts.lines.every((line) => line.campaignId === "camp-1"));
  const stored = persisted(facts, tierIdentity);
  assert.equal(stored.order.benefitTierIndex, 0);
  const rebuilt = benefitQuoteFactsFromPersistedOrder(stored.order, stored.rows);
  assert.equal(proofOf(rebuilt!), issueBenefitQuoteProof({ quote: facts, cartId, secret }));
  assert.equal(stored.rows[0]!.benefitKind, "QUANTITY_TIER");
  assert.equal(stored.rows[0]!.benefitCampaignName, "Giảm theo số lượng");
});

test("A04 a grant with no line carrying the campaign still rebuilds, because the order stores the campaign id", () => {
  // Both lines were legacy-discounted: basis counts, no A1 price benefit lands on a line.
  const evaluation = evaluateBenefitEligibility({
    lines: [evalLine("vx", 2, 300_000, ["camp-1"], "DISCOUNTED"), evalLine("vy", 2, 100_000, ["camp-1"], "DISCOUNTED")],
    campaigns: [tierCampaign],
    shippingPolicy: policy,
  });
  assert.equal(evaluation.tierIndex, 1);
  const facts = buildBenefitQuoteFacts({
    paidLines: [
      { lineKey: "vx", variantExternalId: "pancake-x", quantity: 2 },
      { lineKey: "vy", variantExternalId: "pancake-y", quantity: 2 },
    ],
    gifts: [],
    evaluation,
  });
  assert.ok(facts.lines.every((line) => line.campaignId === null));
  assert.equal(facts.grants.length, 1);
  const stored = persisted(facts, tierIdentity);
  const rebuilt = benefitQuoteFactsFromPersistedOrder(stored.order, stored.rows);
  assert.equal(proofOf(rebuilt!), issueBenefitQuoteProof({ quote: facts, cartId, secret }));
});

test("A04 no grant: no campaign facts are stored and the rebuild still matches", () => {
  const evaluation = evaluateBenefitEligibility({
    lines: [evalLine("vx", 1, 500_000), evalLine("vy", 2, 100_000)],
    campaigns: [],
    shippingPolicy: policy,
  });
  assert.equal(quoteFormatFor(evaluation), "laq1", "no campaign keeps the legacy format");
  const facts = buildBenefitQuoteFacts({ paidLines: paidInputs, gifts: [], evaluation });
  assert.deepEqual(
    projectSignedBenefitQuoteForPancake(facts),
    { ok: false, reason: "VENDOR_PROJECTION_INVALID" },
    "a no-grant quote belongs to laq1 and must not enter benefit vendor dispatch",
  );
  const stored = persisted(facts, null);
  assert.equal(stored.order.benefitCampaignId, null);
  assert.equal(stored.order.benefitEligibleQuantity, null);
  const rebuilt = benefitQuoteFactsFromPersistedOrder(stored.order, stored.rows);
  assert.equal(proofOf(rebuilt!), issueBenefitQuoteProof({ quote: facts, cartId, secret }));
});

test("A04 a refusal keeps the legacy format and the legacy money", () => {
  const evaluation = evaluateBenefitEligibility({
    lines: [evalLine("vx", 1, 500_000, ["camp-1"], "AMBIGUOUS"), evalLine("vy", 2, 100_000)],
    campaigns: [giftCampaign],
    shippingPolicy: policy,
  });
  assert.equal(evaluation.refusal, "A1_LEGACY_AMBIGUOUS");
  assert.equal(quoteFormatFor(evaluation), "laq1");
  assert.equal(evaluation.discountVnd, 0);
});

test("A04 a legacy order is never re-read as a benefit quote", () => {
  const { facts } = giftScenario();
  const stored = persisted(facts, campaignIdentity);
  assert.equal(benefitQuoteFactsFromPersistedOrder({ ...stored.order, quoteVersion: null }, stored.rows), null);
  assert.equal(
    benefitQuoteFactsFromPersistedOrder(stored.order, stored.rows.map((row) => ({ ...row, lineId: null }))),
    null,
  );
  assert.equal(
    benefitQuoteFactsFromPersistedOrder(stored.order, stored.rows.map((row) => ({ ...row, lineRole: null }))),
    null,
  );
  assert.equal(benefitQuoteFactsFromPersistedOrder(stored.order, []), null);
});

test("A04 tampered persisted rows fail the rebuilt proof comparison instead of being trusted", () => {
  const { facts } = giftScenario();
  const rendered = issueBenefitQuoteProof({ quote: facts, cartId, secret })!;
  const stored = persisted(facts, campaignIdentity);
  const changed = stored.rows.map((row, index) =>
    index === 2 ? { ...row, entitlementKey: "gift-9" } : row,
  );
  const rebuilt = benefitQuoteFactsFromPersistedOrder(stored.order, changed);
  assert.ok(rebuilt);
  assert.deepEqual(verifyBenefitQuoteProof({ proof: rendered, cartId, currentQuote: rebuilt, secret }), {
    ok: false,
    reason: "PRICE_CHANGED",
  });
});

test("A04 the reservation input comes from the same lines: PAID X + GIFT X holds 2 of X", () => {
  const { facts } = giftScenario();
  const demand = aggregateBenefitCapacityDemand(
    facts.lines.map((line) => ({ role: line.role, variantId: line.variantExternalId, quantity: line.quantity })),
  );
  assert.deepEqual(demand, [
    { variantId: "pancake-x", quantity: 2 },
    { variantId: "pancake-y", quantity: 2 },
  ]);
});

test("A04 inconsistent inputs are call-site errors", () => {
  const { evaluation } = giftScenario();
  assert.throws(
    () => buildBenefitQuoteFacts({ paidLines: paidInputs, gifts, evaluation: { ...evaluation, giftUnlocked: false } }),
    RangeError,
    "gifts need a granted gift step",
  );
  assert.throws(() => buildBenefitQuoteFacts({ paidLines: paidInputs.slice(0, 1), gifts, evaluation }), RangeError);
  assert.throws(
    () => buildBenefitQuoteFacts({ paidLines: [{ ...paidInputs[0]!, quantity: 5 }, paidInputs[1]!], gifts, evaluation }),
    RangeError,
  );
  assert.throws(
    () =>
      buildBenefitQuoteFacts({
        paidLines: [{ ...paidInputs[0]!, lineKey: "x".repeat(70) }, paidInputs[1]!],
        gifts,
        evaluation: { ...evaluation, lines: [{ ...evaluation.lines[0]!, lineKey: "x".repeat(70) }, evaluation.lines[1]!] },
      }),
    RangeError,
    "line ids are bounded by the 64-character column",
  );
  const { facts } = giftScenario();
  assert.throws(() => toBenefitOrderRows(facts, null, variants), RangeError, "campaign identity required");
  assert.throws(() => toBenefitOrderRows(facts, { ...campaignIdentity, id: "other" }, variants), RangeError);
  assert.throws(() => toBenefitOrderRows(facts, campaignIdentity, new Map()), RangeError, "undescribed variant");
});

test("A08 La.Na D-08 projection derives only from the laq2 signed role lines, not extra prices", () => {
  const { facts } = giftScenario();
  const projected = projectSignedBenefitQuoteForPancake(facts);
  assert.ok(projected.ok);
  if (!projected.ok) return;
  assert.deepEqual(
    projected.lines.map((line) => [line.pancakeVariationId, line.quantity, line.unitPriceVnd]),
    [
      ["pancake-x", 1, 499_000],
      ["pancake-x", 1, 1_000],
      ["pancake-y", 2, 100_000],
    ],
    "website gift stays 0 VND while Pancake receives offset paid/gift lines",
  );
  assert.equal(projected.paidTotalVnd, facts.paidSubtotalVnd);
  assert.equal(projected.lines.reduce((sum, line) => sum + line.quantity * line.unitPriceVnd, 0), facts.paidSubtotalVnd);
});

test("A08 a persisted laq2 snapshot reconstructs the exact same Pancake payload and hash", () => {
  const { facts } = giftScenario();
  const stored = persisted(facts, campaignIdentity);
  assert.deepEqual(
    projectPersistedBenefitOrderForPancake(stored.order, stored.rows),
    projectSignedBenefitQuoteForPancake(facts),
  );
  assert.deepEqual(
    projectPersistedBenefitOrderForPancake({ ...stored.order, quoteVersion: null }, stored.rows),
    { ok: false, reason: "VENDOR_PROJECTION_INVALID" },
    "legacy order cannot be reinterpreted as a benefit vendor payload",
  );
});
