import assert from "node:assert/strict";
import test from "node:test";

import { parseBenefitCampaignForm, type BenefitFormFields } from "../../src/commerce/benefit-campaign-form.ts";

const tierForm = (overrides: Partial<BenefitFormFields> = {}): BenefitFormFields => ({
  kind: "QUANTITY_TIER",
  name: " Mua nhiều giảm nhiều ",
  startsAt: "2026-05-01T00:00",
  endsAt: "",
  thresholdKind: "QUANTITY",
  productSlugs: "ao-so-mi, quan-tay\nao-so-mi",
  tierThresholds: ["2", "4", "", ""],
  tierPercents: ["10", "20", "", ""],
  giftRefs: [],
  giftQuantities: [],
  ...overrides,
});

const reason = (fields: BenefitFormFields) => {
  const result = parseBenefitCampaignForm(fields);
  return result.ok ? null : result.reason;
};

test("A06 form: a tier form parses, trims, de-duplicates slugs and skips blank rows", () => {
  const result = parseBenefitCampaignForm(tierForm());
  assert.ok(result.ok);
  assert.equal(result.form.name, "Mua nhiều giảm nhiều");
  assert.deepEqual(result.form.productSlugs, ["ao-so-mi", "quan-tay"]);
  assert.deepEqual(result.form.tiers, [
    { thresholdQuantity: 2, thresholdSubtotalVnd: null, percentageValue: 10 },
    { thresholdQuantity: 4, thresholdSubtotalVnd: null, percentageValue: 20 },
  ]);
  assert.equal(result.form.startsAt?.toISOString(), "2026-04-30T17:00:00.000Z", "Vietnam time is UTC+7");
  assert.equal(result.form.endsAt, null);
});

test("A06 form: a gift form uses one subtotal step and no percentage", () => {
  const result = parseBenefitCampaignForm(
    tierForm({
      kind: "GIFT_ITEM",
      thresholdKind: "SUBTOTAL",
      tierThresholds: ["500000"],
      tierPercents: [""],
      giftRefs: ["v1", " v2 ", ""],
      giftQuantities: ["1", "2", ""],
    }),
  );
  assert.ok(result.ok);
  assert.deepEqual(result.form.tiers, [{ thresholdQuantity: null, thresholdSubtotalVnd: 500_000, percentageValue: null }]);
  assert.deepEqual(result.form.gifts, [{ ref: "v1", quantity: 1 }, { ref: "v2", quantity: 2 }]);
});

test("A06 form: bad kind, name, dates and threshold kind are typed refusals", () => {
  assert.equal(reason(tierForm({ kind: "OTHER" })), "INVALID_KIND");
  assert.equal(reason(tierForm({ kind: undefined })), "INVALID_KIND");
  assert.equal(reason(tierForm({ name: "   " })), "INVALID_NAME");
  assert.equal(reason(tierForm({ startsAt: "2026-02-30T00:00" })), "INVALID_DATE_TIME");
  assert.equal(reason(tierForm({ endsAt: "tomorrow" })), "INVALID_DATE_TIME");
  assert.equal(reason(tierForm({ thresholdKind: "OTHER" })), "INVALID_TIERS");
});

test("A06 form: numbers must be plain positive integers, never coerced", () => {
  for (const bad of ["1e3", "-2", "0", "2.5", "0x10", "2 3", "९", "9999999999999999"]) {
    assert.equal(reason(tierForm({ tierThresholds: [bad], tierPercents: ["10"] })), "INVALID_TIERS", `threshold ${bad}`);
    assert.equal(reason(tierForm({ tierThresholds: ["2"], tierPercents: [bad] })), "INVALID_TIERS", `percent ${bad}`);
  }
  assert.equal(reason(tierForm({ tierThresholds: ["2"], tierPercents: [""] })), "INVALID_TIERS", "a price step needs a percentage");
  assert.equal(reason(tierForm({ tierThresholds: [""], tierPercents: ["10"] })), "INVALID_TIERS", "a percentage needs a threshold");
});

test("A06 form: gifts need a reference and a quantity of 1 to 5, and only gift campaigns take them", () => {
  const gift = (giftRefs: unknown[], giftQuantities: unknown[]) =>
    reason(tierForm({ kind: "GIFT_ITEM", thresholdKind: "SUBTOTAL", tierThresholds: ["1000"], tierPercents: [""], giftRefs, giftQuantities }));
  assert.equal(gift(["v1"], [""]), "INVALID_GIFTS");
  assert.equal(gift([""], ["1"]), "INVALID_GIFTS");
  assert.equal(gift(["v1"], ["6"]), "INVALID_GIFTS");
  assert.equal(gift(["x".repeat(65)], ["1"]), "INVALID_GIFTS");
  assert.equal(gift(["v1"], ["1"]), null);
  assert.equal(reason(tierForm({ giftRefs: ["v1"], giftQuantities: ["1"] })), "INVALID_GIFTS");
});

test("A06 form: hostile input is bounded and never throws", () => {
  const many = Array.from({ length: 5000 }, (_, index) => `s${index}`).join(",");
  const result = parseBenefitCampaignForm(tierForm({ productSlugs: many, tierThresholds: Array(5000).fill("1"), tierPercents: Array(5000).fill("1") }));
  assert.ok(result.ok || result.reason === "INVALID_TIERS");
  assert.doesNotThrow(() => parseBenefitCampaignForm({} as BenefitFormFields | never as never));
});
