import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import type { BenefitCampaignDraft } from "../../src/commerce/benefit-campaign.ts";
import {
  createBenefitCampaignDraft,
  disableBenefitCampaign,
  publishBenefitCampaign,
} from "../../src/commerce/benefit-campaign-repository.ts";
import {
  clearCartGift,
  revalidateCartGift,
  selectCartGift,
} from "../../src/commerce/benefit-gift-selection-repository.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const SHOP_ID = 999_012;
const EARLY = new Date("2026-01-01T00:00:00.000Z");
const NOW = new Date("2026-06-01T00:00:00.000Z");
const PREFIX = "gift-selection";

test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

async function cleanup() {
  await prisma.cart.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.benefitCampaign.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.productMirror.deleteMany({ where: { pancakeProductId: { startsWith: PREFIX } } });
}

async function variant(name: string): Promise<string> {
  const key = `${PREFIX}-${name}`;
  const product = await prisma.productMirror.create({
    data: { pancakeShopId: SHOP_ID, pancakeProductId: key, slug: key, name: key, syncedAt: EARLY },
  });
  const created = await prisma.variantMirror.create({
    data: { id: key, pancakeVariationId: key, productId: product.id, syncedAt: EARLY },
  });
  return created.id;
}

async function cart(name: string, expiresAt = new Date("2027-01-01T00:00:00.000Z")): Promise<string> {
  const created = await prisma.cart.create({ data: { id: `${PREFIX}-${name}`, expiresAt } });
  return created.id;
}

async function giftCampaign(name: string, gifts: string[], overrides: Partial<BenefitCampaignDraft> = {}) {
  const draft: BenefitCampaignDraft = {
    kind: "GIFT_ITEM",
    name: `${PREFIX}-${name}`,
    startsAt: null,
    endsAt: null,
    targets: [],
    tiers: [{ thresholdQuantity: null, thresholdSubtotalVnd: 500_000, percentageValue: null }],
    gifts: gifts.map((variantId, index) => ({ variantId, quantity: index + 1 })),
    ...overrides,
  };
  const created = await createBenefitCampaignDraft(prisma, draft, null);
  assert.ok(created.ok, JSON.stringify(created));
  const published = await publishBenefitCampaign(prisma, { id: created.id, expectedVersion: 1, now: NOW });
  assert.ok(published.ok, JSON.stringify(published));
  return created.id;
}

const revalidate = (cartId: string, campaignId: string, granted = true) =>
  revalidateCartGift(prisma, { cartId, campaignId, granted, now: NOW });

test("A07 a choice is stored, replaced and cleared, and resolves with the campaign's own quantity", async () => {
  await cleanup();
  const [g1, g2] = [await variant("a1"), await variant("a2")];
  const campaignId = await giftCampaign("basic", [g1, g2]);
  const cartId = await cart("basic");

  assert.equal((await revalidate(cartId, campaignId)).state, "NEEDS_CHOICE");

  assert.deepEqual(await selectCartGift(prisma, { cartId, campaignId, giftVariantId: g2, now: NOW }), { ok: true });
  assert.deepEqual(await revalidate(cartId, campaignId), { state: "READY", gift: { variantId: g2, quantity: 2 } });

  assert.deepEqual(await selectCartGift(prisma, { cartId, campaignId, giftVariantId: g1, now: NOW }), { ok: true });
  assert.deepEqual(await revalidate(cartId, campaignId), { state: "READY", gift: { variantId: g1, quantity: 1 } });
  assert.equal(await prisma.cartGiftSelection.count({ where: { cartId } }), 1, "replace, not append");

  await clearCartGift(prisma, { cartId, campaignId });
  await clearCartGift(prisma, { cartId, campaignId });
  assert.equal((await revalidate(cartId, campaignId)).state, "NEEDS_CHOICE");
  await cleanup();
});

test("A07 refusals: unknown cart, expired cart, inactive campaign, a gift the campaign does not offer", async () => {
  await cleanup();
  const [g1, other] = [await variant("r1"), await variant("r2")];
  const campaignId = await giftCampaign("refusals", [g1]);
  const cartId = await cart("refusals");
  const select = (overrides: Record<string, unknown>) =>
    selectCartGift(prisma, { cartId, campaignId, giftVariantId: g1, now: NOW, ...overrides } as never);

  assert.deepEqual(await select({ cartId: "no-such-cart" }), { ok: false, reason: "CART_NOT_FOUND" });
  const expired = await cart("expired", new Date("2026-05-01T00:00:00.000Z"));
  assert.deepEqual(await select({ cartId: expired }), { ok: false, reason: "CART_NOT_FOUND" });
  assert.deepEqual(await select({ campaignId: "no-such-campaign" }), { ok: false, reason: "CAMPAIGN_INACTIVE" });
  assert.deepEqual(await select({ giftVariantId: other }), { ok: false, reason: "GIFT_NOT_OFFERED" });
  assert.deepEqual(await select({ giftVariantId: "x".repeat(65) }), { ok: false, reason: "GIFT_NOT_OFFERED" });

  const tier = await createBenefitCampaignDraft(prisma, {
    kind: "QUANTITY_TIER", name: `${PREFIX}-tier`, startsAt: null, endsAt: null, targets: [],
    tiers: [{ thresholdQuantity: 2, thresholdSubtotalVnd: null, percentageValue: 10 }], gifts: [],
  }, null);
  assert.ok(tier.ok);
  await publishBenefitCampaign(prisma, { id: tier.id, expectedVersion: 1, now: NOW });
  assert.deepEqual(await select({ campaignId: tier.id }), { ok: false, reason: "CAMPAIGN_INACTIVE" }, "a tier campaign has no gifts to choose");

  await disableBenefitCampaign(prisma, { id: campaignId, now: NOW });
  assert.deepEqual(await select({}), { ok: false, reason: "CAMPAIGN_INACTIVE" });
  assert.equal(await prisma.cartGiftSelection.count(), 0, "nothing was stored by any refusal");
  await cleanup();
});

test("A07 the database refuses a gift the campaign does not offer, even if the application is bypassed", async () => {
  await cleanup();
  const [g1, other] = [await variant("d1"), await variant("d2")];
  const campaignId = await giftCampaign("db", [g1]);
  const cartId = await cart("db");
  await assert.rejects(
    prisma.cartGiftSelection.create({ data: { cartId, campaignId, giftVariantId: other } }),
    /foreign key|constraint/i,
  );
  await prisma.cartGiftSelection.create({ data: { cartId, campaignId, giftVariantId: g1 } });
  await assert.rejects(
    prisma.cartGiftSelection.create({ data: { cartId, campaignId, giftVariantId: g1 } }),
    /unique/i,
    "one choice per cart and campaign",
  );
  await cleanup();
});

test("A07 a campaign that stops offering the chosen gift leaves the cart needing a choice, never a substitute", async () => {
  await cleanup();
  const [g1, g2, g3] = [await variant("s1"), await variant("s2"), await variant("s3")];
  const campaignId = await giftCampaign("stale", [g1, g2, g3]);
  const cartId = await cart("stale");
  await selectCartGift(prisma, { cartId, campaignId, giftVariantId: g1, now: NOW });

  // The application never edits an enabled campaign's gifts; this is the database-level safety net.
  await prisma.benefitCampaignGift.deleteMany({ where: { campaignId, variantId: g1 } });
  assert.equal(await prisma.cartGiftSelection.count({ where: { cartId } }), 0, "the choice went with the gift");
  const resolution = await revalidate(cartId, campaignId);
  assert.equal(resolution.state, "NEEDS_CHOICE", "the buyer chooses again; no other gift is picked for them");
  await cleanup();
});

test("A07 revalidation is fresh: disabling or ending the campaign blocks a stored choice", async () => {
  await cleanup();
  const g1 = await variant("f1");
  const campaignId = await giftCampaign("fresh", [g1]);
  const cartId = await cart("fresh");
  await selectCartGift(prisma, { cartId, campaignId, giftVariantId: g1, now: NOW });
  assert.equal((await revalidate(cartId, campaignId)).state, "READY");

  await disableBenefitCampaign(prisma, { id: campaignId, now: NOW });
  assert.deepEqual(await revalidate(cartId, campaignId), { state: "BLOCKED", reason: "CAMPAIGN_INACTIVE" });
  assert.deepEqual(await revalidate(cartId, campaignId, false), { state: "NOT_APPLICABLE" }, "not granted: nothing to block");

  const ending = await giftCampaign("fresh-ending", [g1], { endsAt: new Date("2026-06-02T00:00:00.000Z") });
  await selectCartGift(prisma, { cartId, campaignId: ending, giftVariantId: g1, now: NOW });
  assert.equal((await revalidate(cartId, ending)).state, "READY");
  const later = await revalidateCartGift(prisma, { cartId, campaignId: ending, granted: true, now: new Date("2026-06-02T00:00:00.000Z") });
  assert.deepEqual(later, { state: "BLOCKED", reason: "CAMPAIGN_INACTIVE" });
  await cleanup();
});

test("A07 choosing a gift never changes the paid cart, and deleting the cart removes the choice", async () => {
  await cleanup();
  const [g1, paid] = [await variant("p1"), await variant("p2")];
  const campaignId = await giftCampaign("paid", [g1]);
  const cartId = await cart("paid");
  await prisma.cartItem.create({ data: { cartId, variantId: paid, quantity: 3 } });

  await selectCartGift(prisma, { cartId, campaignId, giftVariantId: g1, now: NOW });
  const items = await prisma.cartItem.findMany({ where: { cartId } });
  assert.deepEqual(items.map((item) => [item.variantId, item.quantity]), [[paid, 3]]);

  await prisma.cart.delete({ where: { id: cartId } });
  assert.equal(await prisma.cartGiftSelection.count({ where: { campaignId } }), 0);
  await cleanup();
});

test("A07 many concurrent choices for one cart end with exactly one stored row", async () => {
  await cleanup();
  const gifts = [await variant("c1"), await variant("c2"), await variant("c3")];
  const campaignId = await giftCampaign("race", gifts);
  const cartId = await cart("race");
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      selectCartGift(prisma, { cartId, campaignId, giftVariantId: gifts[index % 3]!, now: NOW }),
    ),
  );
  assert.ok(results.every((result) => result.ok), JSON.stringify(results));
  assert.equal(await prisma.cartGiftSelection.count({ where: { cartId } }), 1);
  await cleanup();
});
