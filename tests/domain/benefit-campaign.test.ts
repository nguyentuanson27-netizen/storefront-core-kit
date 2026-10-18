import assert from "node:assert/strict";
import test from "node:test";

import {
  BENEFIT_MAX_GIFTS,
  BENEFIT_MAX_TARGETS,
  BENEFIT_MAX_TIERS,
  findBenefitPublishConflicts,
  validateBenefitCampaignDraft,
  windowsIntersect,
  type BenefitCampaignDraft,
  type BenefitScopeFacts,
  type BenefitTierDraft,
} from "../../src/commerce/benefit-campaign.ts";

const d = (iso: string) => new Date(iso);

const priceTier = (quantity: number, percent: number): BenefitTierDraft => ({
  thresholdQuantity: quantity,
  thresholdSubtotalVnd: null,
  percentageValue: percent,
});

const tierDraft = (overrides: Partial<BenefitCampaignDraft> = {}): BenefitCampaignDraft => ({
  kind: "QUANTITY_TIER",
  name: "Giảm theo số lượng",
  startsAt: null,
  endsAt: null,
  targets: [],
  tiers: [priceTier(2, 10), priceTier(4, 20)],
  gifts: [],
  ...overrides,
});

const giftDraft = (overrides: Partial<BenefitCampaignDraft> = {}): BenefitCampaignDraft => ({
  kind: "GIFT_ITEM",
  name: "Mua 1 tặng 1",
  startsAt: null,
  endsAt: null,
  targets: [{ productId: "p1" }],
  tiers: [{ thresholdQuantity: null, thresholdSubtotalVnd: 500_000, percentageValue: null }],
  gifts: [{ variantId: "gv1", quantity: 1 }],
  ...overrides,
});

const refusal = (draft: BenefitCampaignDraft) => {
  const result = validateBenefitCampaignDraft(draft);
  return result.ok ? null : result.reason;
};

test("A06 valid tier and gift definitions are accepted; the name is trimmed", () => {
  assert.equal(validateBenefitCampaignDraft(tierDraft()).ok, true);
  assert.equal(validateBenefitCampaignDraft(giftDraft()).ok, true);
  const trimmed = validateBenefitCampaignDraft(tierDraft({ name: "  Giảm giá  " }));
  assert.ok(trimmed.ok);
  assert.equal(trimmed.draft.name, "Giảm giá");
});

test("A06 kind, name and window bounds", () => {
  assert.equal(refusal(tierDraft({ kind: "OTHER" as "GIFT_ITEM" })), "INVALID_KIND");
  assert.equal(refusal(tierDraft({ name: "" })), "INVALID_NAME");
  assert.equal(refusal(tierDraft({ name: "   " })), "INVALID_NAME");
  assert.equal(refusal(tierDraft({ name: "x".repeat(121) })), "INVALID_NAME");
  assert.equal(validateBenefitCampaignDraft(tierDraft({ name: "x".repeat(120) })).ok, true);
  assert.equal(refusal(tierDraft({ startsAt: d("2026-02-01"), endsAt: d("2026-01-01") })), "INVALID_WINDOW");
  assert.equal(refusal(tierDraft({ startsAt: d("2026-01-01"), endsAt: d("2026-01-01") })), "INVALID_WINDOW", "empty window");
  assert.equal(refusal(tierDraft({ startsAt: new Date("nope") })), "INVALID_WINDOW");
  assert.equal(validateBenefitCampaignDraft(tierDraft({ startsAt: d("2026-01-01"), endsAt: null })).ok, true);
});

test("A06 tier ladders: at most 8, one threshold kind, strictly increasing, percentage 1-99", () => {
  const eight = Array.from({ length: BENEFIT_MAX_TIERS }, (_unused, index) => priceTier(index + 1, 10));
  assert.equal(validateBenefitCampaignDraft(tierDraft({ tiers: eight })).ok, true);
  assert.equal(refusal(tierDraft({ tiers: [...eight, priceTier(9, 10)] })), "INVALID_TIERS", "nine steps");
  assert.equal(refusal(tierDraft({ tiers: [] })), "INVALID_TIERS");
  assert.equal(refusal(tierDraft({ tiers: [priceTier(2, 10), priceTier(2, 20)] })), "INVALID_TIERS", "equal thresholds");
  assert.equal(refusal(tierDraft({ tiers: [priceTier(4, 10), priceTier(2, 20)] })), "INVALID_TIERS", "descending");
  assert.equal(refusal(tierDraft({ tiers: [priceTier(2, 0)] })), "INVALID_TIERS");
  assert.equal(refusal(tierDraft({ tiers: [priceTier(2, 100)] })), "INVALID_TIERS");
  assert.equal(refusal(tierDraft({ tiers: [priceTier(0, 10)] })), "INVALID_TIERS");
  assert.equal(refusal(tierDraft({ tiers: [priceTier(1.5, 10)] })), "INVALID_TIERS");
  assert.equal(
    refusal(tierDraft({ tiers: [priceTier(2, 10), { thresholdQuantity: null, thresholdSubtotalVnd: 900_000, percentageValue: 20 }] })),
    "INVALID_TIERS",
    "mixed threshold kinds",
  );
  assert.equal(
    refusal(tierDraft({ tiers: [{ thresholdQuantity: 2, thresholdSubtotalVnd: 5, percentageValue: 10 }] })),
    "INVALID_TIERS",
    "two thresholds on one step",
  );
  assert.equal(
    refusal(tierDraft({ tiers: [{ thresholdQuantity: null, thresholdSubtotalVnd: null, percentageValue: 10 }] })),
    "INVALID_TIERS",
    "no threshold",
  );
  assert.equal(
    refusal(tierDraft({ tiers: [{ thresholdQuantity: 2, thresholdSubtotalVnd: null, percentageValue: null }] })),
    "INVALID_TIERS",
    "a price campaign needs price steps",
  );
});

test("A06 gift campaigns: one step, a gift step carries no percentage, 1-5 gifts of quantity 1-5", () => {
  const gift = (n: number) => ({ variantId: `gv${n}`, quantity: 1 });
  assert.equal(validateBenefitCampaignDraft(giftDraft({ gifts: Array.from({ length: BENEFIT_MAX_GIFTS }, (_u, i) => gift(i)) })).ok, true);
  assert.equal(refusal(giftDraft({ gifts: Array.from({ length: BENEFIT_MAX_GIFTS + 1 }, (_u, i) => gift(i)) })), "INVALID_GIFTS");
  assert.equal(refusal(giftDraft({ gifts: [] })), "INVALID_GIFTS");
  assert.equal(refusal(giftDraft({ gifts: [gift(1), gift(1)] })), "INVALID_GIFTS", "duplicate gift");
  assert.equal(refusal(giftDraft({ gifts: [{ variantId: "gv", quantity: 0 }] })), "INVALID_GIFTS");
  assert.equal(refusal(giftDraft({ gifts: [{ variantId: "gv", quantity: 6 }] })), "INVALID_GIFTS");
  assert.equal(refusal(giftDraft({ gifts: [{ variantId: "", quantity: 1 }] })), "INVALID_GIFTS");
  assert.equal(
    refusal(giftDraft({ tiers: [{ thresholdQuantity: 1, thresholdSubtotalVnd: null, percentageValue: 10 }] })),
    "INVALID_TIERS",
    "a gift step with a percentage",
  );
  assert.equal(
    refusal(giftDraft({ tiers: [{ thresholdQuantity: 1, thresholdSubtotalVnd: null, percentageValue: null }, { thresholdQuantity: 2, thresholdSubtotalVnd: null, percentageValue: null }] })),
    "INVALID_TIERS",
    "a gift campaign has exactly one step",
  );
  assert.equal(refusal(tierDraft({ gifts: [{ variantId: "gv", quantity: 1 }] })), "INVALID_GIFTS", "a tier campaign has no gifts");
});

test("A06 targets: empty means store-wide; each is exactly one id; no duplicates; bounded", () => {
  assert.equal(validateBenefitCampaignDraft(tierDraft({ targets: [] })).ok, true);
  assert.equal(validateBenefitCampaignDraft(tierDraft({ targets: [{ productId: "p1" }, { variantId: "v1" }] })).ok, true);
  assert.equal(refusal(tierDraft({ targets: [{ productId: "p1" }, { productId: "p1" }] })), "INVALID_TARGETS");
  assert.equal(refusal(tierDraft({ targets: [{ productId: "p1", variantId: "v1" } as never] })), "INVALID_TARGETS");
  assert.equal(refusal(tierDraft({ targets: [{} as never] })), "INVALID_TARGETS");
  assert.equal(refusal(tierDraft({ targets: [{ productId: "" }] })), "INVALID_TARGETS");
  const many = Array.from({ length: BENEFIT_MAX_TARGETS + 1 }, (_u, i) => ({ productId: `p${i}` }));
  assert.equal(refusal(tierDraft({ targets: many })), "INVALID_TARGETS");
  assert.equal(validateBenefitCampaignDraft(tierDraft({ targets: many.slice(0, BENEFIT_MAX_TARGETS) })).ok, true);
});

test("A06 windows are half-open and null is unbounded", () => {
  const w = (a: string | null, b: string | null) => ({ startsAt: a ? d(a) : null, endsAt: b ? d(b) : null });
  assert.equal(windowsIntersect(w("2026-01-01", "2026-02-01"), w("2026-02-01", "2026-03-01")), false, "touching ends do not overlap");
  assert.equal(windowsIntersect(w("2026-01-01", "2026-02-01"), w("2026-01-31", "2026-03-01")), true);
  assert.equal(windowsIntersect(w(null, null), w("2026-01-01", "2026-02-01")), true);
  assert.equal(windowsIntersect(w(null, "2026-01-01"), w("2026-01-01", null)), false);
  assert.equal(windowsIntersect(w("2026-05-01", null), w("2026-01-01", "2026-02-01")), false);
});

const scope = (
  id: string,
  productIds: string[] | null,
  startsAt: string | null = null,
  endsAt: string | null = null,
): BenefitScopeFacts => ({
  id,
  name: `campaign ${id}`,
  startsAt: startsAt ? d(startsAt) : null,
  endsAt: endsAt ? d(endsAt) : null,
  productIds: productIds ? new Set(productIds) : null,
});

test("A06 two benefit campaigns conflict when windows and scopes both intersect", () => {
  const candidate = scope("new", ["p1", "p2"], "2026-01-01", "2026-02-01");
  assert.deepEqual(findBenefitPublishConflicts(candidate, [scope("a", ["p2", "p3"], "2026-01-15", "2026-03-01")], []), [
    { with: "BENEFIT", id: "a", name: "campaign a" },
  ]);
  assert.deepEqual(findBenefitPublishConflicts(candidate, [scope("b", ["p9"], "2026-01-15", "2026-03-01")], []), [], "disjoint products");
  assert.deepEqual(findBenefitPublishConflicts(candidate, [scope("c", ["p1"], "2026-02-01", "2026-03-01")], []), [], "disjoint windows");
});

test("A06 a store-wide benefit campaign intersects every other benefit campaign in its window", () => {
  const storeWide = scope("wide", null, "2026-01-01", "2026-02-01");
  assert.equal(findBenefitPublishConflicts(storeWide, [scope("a", ["p1"], "2026-01-10", "2026-01-20")], []).length, 1);
  assert.equal(findBenefitPublishConflicts(scope("new", ["p1"], "2026-01-10", "2026-01-20"), [storeWide], []).length, 1);
  assert.equal(findBenefitPublishConflicts(storeWide, [scope("a", ["p1"], "2026-03-01", null)], []).length, 0);
});

test("A06 against legacy: explicit scopes that share a product in an overlapping window conflict", () => {
  const candidate = scope("new", ["p1"], "2026-01-01", "2026-02-01");
  assert.deepEqual(findBenefitPublishConflicts(candidate, [], [scope("legacy-1", ["p1", "p5"], "2026-01-15", "2026-01-20")]), [
    { with: "LEGACY", id: "legacy-1", name: "campaign legacy-1" },
  ]);
  assert.deepEqual(findBenefitPublishConflicts(candidate, [], [scope("legacy-2", ["p7"], "2026-01-15", "2026-01-20")]), []);
  assert.deepEqual(findBenefitPublishConflicts(candidate, [], [scope("legacy-3", ["p1"], "2026-02-01", "2026-03-01")]), []);
});

test("A06 owner decision 2: a store-wide benefit campaign skips the legacy refusal, and so does a store-wide legacy one", () => {
  const legacy = scope("legacy", ["p1"], "2026-01-01", "2026-02-01");
  assert.deepEqual(findBenefitPublishConflicts(scope("wide", null, "2026-01-01", "2026-02-01"), [], [legacy]), []);
  assert.deepEqual(
    findBenefitPublishConflicts(scope("new", ["p1"], "2026-01-01", "2026-02-01"), [], [scope("legacy-wide", null, "2026-01-01", "2026-02-01")]),
    [],
  );
});

test("A06 a campaign never conflicts with itself, and several conflicts are all named", () => {
  const candidate = scope("same", ["p1"]);
  assert.deepEqual(findBenefitPublishConflicts(candidate, [scope("same", ["p1"])], []), []);
  const conflicts = findBenefitPublishConflicts(candidate, [scope("a", ["p1"]), scope("b", ["p1"])], [scope("l", ["p1"])]);
  assert.deepEqual(conflicts.map(({ id }) => id), ["a", "b", "l"]);
});
