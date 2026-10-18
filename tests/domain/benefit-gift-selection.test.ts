import assert from "node:assert/strict";
import test from "node:test";

import {
  isCampaignActive,
  resolveGiftSelection,
  type GiftCampaignFacts,
} from "../../src/commerce/benefit-gift-selection.ts";

const NOW = new Date("2026-06-01T00:00:00.000Z");
const campaign = (overrides: Partial<GiftCampaignFacts> = {}): GiftCampaignFacts => ({
  kind: "GIFT_ITEM",
  isEnabled: true,
  startsAt: null,
  endsAt: null,
  gifts: [{ variantId: "g1", quantity: 1 }, { variantId: "g2", quantity: 2 }],
  ...overrides,
});
const resolve = (c: GiftCampaignFacts | null, selected: string | null, granted = true) =>
  resolveGiftSelection({ campaign: c, granted, selectedGiftVariantId: selected, now: NOW });

test("A07 no campaign, a tier campaign or a benefit that is not granted: nothing to resolve", () => {
  assert.deepEqual(resolve(null, "g1"), { state: "NOT_APPLICABLE" });
  assert.deepEqual(resolve(campaign({ kind: "QUANTITY_TIER" }), "g1"), { state: "NOT_APPLICABLE" });
  assert.deepEqual(resolve(campaign(), "g1", false), { state: "NOT_APPLICABLE" });
  assert.deepEqual(resolve(campaign({ isEnabled: false }), "g1", false), { state: "NOT_APPLICABLE" }, "ungranted wins over inactive");
});

test("A07 a valid choice resolves to the campaign's own quantity, never one supplied by the client", () => {
  assert.deepEqual(resolve(campaign(), "g2"), { state: "READY", gift: { variantId: "g2", quantity: 2 } });
});

test("A07 several gifts and no choice need a choice; a single gift needs none", () => {
  const result = resolve(campaign(), null);
  assert.equal(result.state, "NEEDS_CHOICE");
  assert.deepEqual(resolve(campaign({ gifts: [{ variantId: "only", quantity: 3 }] }), null), {
    state: "READY",
    gift: { variantId: "only", quantity: 3 },
  });
});

test("A07 a stale choice is blocked and never substituted", () => {
  assert.deepEqual(resolve(campaign(), "gone"), { state: "BLOCKED", reason: "GIFT_NOT_OFFERED" });
  // Even when exactly one other gift remains, the old choice is not silently swapped for it.
  assert.deepEqual(resolve(campaign({ gifts: [{ variantId: "g1", quantity: 1 }] }), "g2"), {
    state: "BLOCKED",
    reason: "GIFT_NOT_OFFERED",
  });
});

test("A07 a disabled, not-yet-started or ended campaign blocks a granted benefit", () => {
  const blocked = { state: "BLOCKED", reason: "CAMPAIGN_INACTIVE" };
  assert.deepEqual(resolve(campaign({ isEnabled: false }), "g1"), blocked);
  assert.deepEqual(resolve(campaign({ startsAt: new Date(NOW.getTime() + 1) }), "g1"), blocked);
  assert.deepEqual(resolve(campaign({ endsAt: NOW }), "g1"), blocked, "the end is exclusive");
  assert.equal(resolve(campaign({ startsAt: NOW }), "g1").state, "READY", "the start is inclusive");
});

test("A07 a gift campaign that offers nothing blocks rather than granting an empty gift", () => {
  assert.deepEqual(resolve(campaign({ gifts: [] }), null), { state: "BLOCKED", reason: "NO_GIFTS_OFFERED" });
});

test("A07 window boundaries and an invalid clock", () => {
  const window = { isEnabled: true, startsAt: new Date("2026-01-01"), endsAt: new Date("2026-02-01") };
  assert.equal(isCampaignActive(window, new Date("2026-01-01")), true);
  assert.equal(isCampaignActive(window, new Date("2026-02-01")), false);
  assert.equal(isCampaignActive(window, new Date("2025-12-31T23:59:59.999Z")), false);
  assert.equal(isCampaignActive(window, new Date(Number.NaN)), false);
});
