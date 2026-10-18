import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import type { BenefitCampaignDraft } from "../../src/commerce/benefit-campaign.ts";
import {
  createBenefitCampaignDraft,
  disableBenefitCampaign,
  listBenefitCampaigns,
  publishBenefitCampaign,
  readBenefitRevision,
  replaceBenefitCampaignDraft,
} from "../../src/commerce/benefit-campaign-repository.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const SHOP_ID = 999_010;
const EARLY = new Date("2026-01-01T00:00:00.000Z");
const NOW = new Date("2026-06-01T00:00:00.000Z");
const PREFIX = "benefit-campaign";

test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

async function cleanup() {
  await prisma.benefitCampaign.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.promotionCampaign.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.productMirror.deleteMany({ where: { pancakeProductId: { startsWith: PREFIX } } });
}

async function product(name: string): Promise<{ productId: string; variantId: string }> {
  const key = `${PREFIX}-${name}`;
  const created = await prisma.productMirror.create({
    data: { pancakeShopId: SHOP_ID, pancakeProductId: key, slug: key, name: key, syncedAt: EARLY },
  });
  const variant = await prisma.variantMirror.create({
    data: { id: key, pancakeVariationId: key, productId: created.id, syncedAt: EARLY },
  });
  return { productId: created.id, variantId: variant.id };
}

const tierDraft = (name: string, overrides: Partial<BenefitCampaignDraft> = {}): BenefitCampaignDraft => ({
  kind: "QUANTITY_TIER",
  name: `${PREFIX}-${name}`,
  startsAt: new Date("2026-05-01T00:00:00.000Z"),
  endsAt: new Date("2026-07-01T00:00:00.000Z"),
  targets: [],
  tiers: [
    { thresholdQuantity: 2, thresholdSubtotalVnd: null, percentageValue: 10 },
    { thresholdQuantity: 4, thresholdSubtotalVnd: null, percentageValue: 20 },
  ],
  gifts: [],
  ...overrides,
});

async function create(draft: BenefitCampaignDraft) {
  const result = await createBenefitCampaignDraft(prisma, draft, null);
  assert.ok(result.ok, JSON.stringify(result));
  return result;
}

const publish = (id: string, version = 1) => publishBenefitCampaign(prisma, { id, expectedVersion: version, now: NOW });

test("A06 a draft is stored with its definition and starts disabled", async () => {
  await cleanup();
  const p = await product("p1");
  const draft = await create(
    tierDraft("tier", { targets: [{ productId: p.productId }, { variantId: p.variantId }] }),
  );
  const [row] = (await listBenefitCampaigns(prisma)).filter((campaign) => campaign.id === draft.id);
  assert.equal(row!.isEnabled, false);
  assert.equal(row!.tierCount, 2);
  assert.equal(row!.targetCount, 2);
  assert.equal(row!.version, 1);

  const tiers = await prisma.benefitCampaignTier.findMany({ where: { campaignId: draft.id }, orderBy: { position: "asc" } });
  assert.deepEqual(tiers.map((tier) => [tier.position, tier.thresholdQuantity, tier.percentageValue]), [[0, 2, 10], [1, 4, 20]]);
  await cleanup();
});

test("A06 a gift campaign stores its gifts in order", async () => {
  await cleanup();
  const trigger = await product("trigger");
  const g1 = await product("g1");
  const g2 = await product("g2");
  const draft = await create({
    kind: "GIFT_ITEM",
    name: `${PREFIX}-gift`,
    startsAt: null,
    endsAt: null,
    targets: [{ productId: trigger.productId }],
    tiers: [{ thresholdQuantity: null, thresholdSubtotalVnd: 500_000, percentageValue: null }],
    gifts: [{ variantId: g1.variantId, quantity: 1 }, { variantId: g2.variantId, quantity: 2 }],
  });
  const gifts = await prisma.benefitCampaignGift.findMany({ where: { campaignId: draft.id }, orderBy: { position: "asc" } });
  assert.deepEqual(gifts.map((gift) => [gift.variantId, gift.quantity]), [[g1.variantId, 1], [g2.variantId, 2]]);
  const tier = await prisma.benefitCampaignTier.findFirstOrThrow({ where: { campaignId: draft.id } });
  assert.equal(tier.thresholdSubtotalVnd, BigInt(500_000));
  await cleanup();
});

test("A06 invalid definitions and unknown references are refused and write nothing", async () => {
  await cleanup();
  const before = await prisma.benefitCampaign.count({ where: { name: { startsWith: PREFIX } } });
  const refuse = async (draft: BenefitCampaignDraft, reason: string) => {
    const result = await createBenefitCampaignDraft(prisma, draft, null);
    assert.deepEqual(result.ok ? null : result.reason, reason);
  };
  await refuse(tierDraft("bad-name", { name: "" }), "INVALID_NAME");
  await refuse(tierDraft("bad-tiers", { tiers: [] }), "INVALID_TIERS");
  await refuse(tierDraft("unknown-product", { targets: [{ productId: "no-such-product" }] }), "UNKNOWN_TARGET");
  await refuse(tierDraft("unknown-variant", { targets: [{ variantId: "no-such-variant" }] }), "UNKNOWN_TARGET");
  await refuse(
    {
      kind: "GIFT_ITEM",
      name: `${PREFIX}-unknown-gift`,
      startsAt: null,
      endsAt: null,
      targets: [],
      tiers: [{ thresholdQuantity: 1, thresholdSubtotalVnd: null, percentageValue: null }],
      gifts: [{ variantId: "no-such-gift", quantity: 1 }],
    },
    "UNKNOWN_GIFT",
  );
  assert.equal(await prisma.benefitCampaign.count({ where: { name: { startsWith: PREFIX } } }), before);
  await cleanup();
});

test("A06 the database itself refuses what the application should never hand it", async () => {
  await cleanup();
  const p = await product("raw");
  const campaign = await create(tierDraft("raw"));
  const tier = (data: Record<string, unknown>) => prisma.benefitCampaignTier.create({ data: { campaignId: campaign.id, position: 5, thresholdQuantity: 9, percentageValue: 10, ...data } as never });

  await assert.rejects(tier({ position: 8 }), /position_range|check/i, "a ninth step");
  await assert.rejects(tier({ thresholdSubtotalVnd: BigInt(5) }), /one_threshold|check/i, "two thresholds");
  await assert.rejects(tier({ thresholdQuantity: null }), /one_threshold|check/i, "no threshold");
  await assert.rejects(tier({ percentageValue: 100 }), /percentage_range|check/i);
  await assert.rejects(tier({ percentageValue: 0 }), /percentage_range|check/i);
  await assert.rejects(tier({ thresholdQuantity: 0 }), /threshold_positive|check/i);
  await assert.rejects(tier({ position: 0 }), /unique/i, "a duplicate position");

  const gift = (data: Record<string, unknown>) => prisma.benefitCampaignGift.create({ data: { campaignId: campaign.id, variantId: p.variantId, position: 0, quantity: 1, ...data } as never });
  await assert.rejects(gift({ position: 5 }), /position_range|check/i, "a sixth gift");
  await assert.rejects(gift({ quantity: 6 }), /quantity_range|check/i);
  await assert.rejects(gift({ quantity: 0 }), /quantity_range|check/i);

  const target = (data: Record<string, unknown>) => prisma.benefitCampaignTarget.create({ data: { campaignId: campaign.id, ...data } as never });
  await assert.rejects(target({ productId: p.productId, variantId: p.variantId }), /exactly_one|check/i);
  await assert.rejects(target({}), /exactly_one|check/i);

  const make = (data: Record<string, unknown>) => prisma.benefitCampaign.create({ data: { kind: "QUANTITY_TIER", name: `${PREFIX}-raw-2`, ...data } as never });
  await assert.rejects(make({ kind: "OTHER" }), /kind_known|check/i);
  await assert.rejects(make({ name: "" }), /name_length|check/i);
  await assert.rejects(make({ name: "x".repeat(121) }), /name_length|check/i);
  await assert.rejects(make({ startsAt: new Date("2026-02-01"), endsAt: new Date("2026-01-01") }), /window_order|check/i);
  await assert.rejects(make({ version: 0 }), /version_positive|check/i);
  await cleanup();
});

test("A06 publishing enables a draft, bumps the version and advances the revision", async () => {
  await cleanup();
  const campaign = await create(tierDraft("publish"));
  const before = await readBenefitRevision(prisma);

  const result = await publish(campaign.id);
  assert.deepEqual(result, { ok: true, id: campaign.id, version: 2 });
  const row = await prisma.benefitCampaign.findUniqueOrThrow({ where: { id: campaign.id } });
  assert.equal(row.isEnabled, true);
  assert.deepEqual(row.enabledAt, NOW);
  assert.equal(await readBenefitRevision(prisma), before + BigInt(1));

  assert.deepEqual(await publish(campaign.id, 2), { ok: false, reason: "ALREADY_ENABLED" });
  await cleanup();
});

test("A06 stale versions, unknown ids and ended windows are refused", async () => {
  await cleanup();
  const campaign = await create(tierDraft("refusals"));
  assert.deepEqual(await publish(campaign.id, 7), { ok: false, reason: "STALE_VERSION" });
  assert.deepEqual(await publish("no-such-campaign"), { ok: false, reason: "NOT_FOUND" });

  const ended = await create(tierDraft("ended", { startsAt: new Date("2026-01-01"), endsAt: new Date("2026-02-01") }));
  assert.deepEqual(await publish(ended.id), { ok: false, reason: "WINDOW_ENDED" });
  assert.equal((await prisma.benefitCampaign.findUniqueOrThrow({ where: { id: ended.id } })).isEnabled, false);
  await cleanup();
});

test("A06 overlapping scopes in overlapping windows are refused and name the conflicting campaign", async () => {
  await cleanup();
  const a = await product("a");
  const b = await product("b");
  const first = await create(tierDraft("first", { targets: [{ productId: a.productId }] }));
  assert.equal((await publish(first.id)).ok, true);

  const overlapping = await create(tierDraft("overlap", { targets: [{ variantId: a.variantId }] }));
  const refused = await publish(overlapping.id);
  assert.equal(refused.ok, false);
  assert.ok(!refused.ok && refused.reason === "CONFLICT");
  assert.deepEqual(refused.conflicts, [{ with: "BENEFIT", id: first.id, name: `${PREFIX}-first` }], "a variant target covers its product");
  assert.equal((await prisma.benefitCampaign.findUniqueOrThrow({ where: { id: overlapping.id } })).isEnabled, false);

  const disjoint = await create(tierDraft("disjoint", { targets: [{ productId: b.productId }] }));
  assert.equal((await publish(disjoint.id)).ok, true);

  const later = await create(tierDraft("later", { targets: [{ productId: a.productId }], startsAt: new Date("2026-07-01T00:00:00.000Z"), endsAt: null }));
  assert.equal((await publish(later.id)).ok, true, "adjacent windows do not overlap");

  const storeWide = await create(tierDraft("wide"));
  const wide = await publish(storeWide.id);
  assert.ok(!wide.ok && wide.reason === "CONFLICT", "store-wide intersects every other benefit campaign");
  await cleanup();
});

test("A06 against legacy: shared explicit targets refuse; a store-wide benefit campaign does not", async () => {
  await cleanup();
  const a = await product("legacy-a");
  await prisma.promotionCampaign.create({
    data: {
      kind: "PROMOTION",
      name: `${PREFIX}-legacy`,
      discountType: "PERCENTAGE",
      percentageValue: 10,
      isEnabled: true,
      enabledAt: EARLY,
      targets: { create: [{ productId: a.productId }] },
    },
  });
  const legacy = await prisma.promotionCampaign.findFirstOrThrow({ where: { name: `${PREFIX}-legacy` } });

  const scoped = await create(tierDraft("scoped", { targets: [{ productId: a.productId }] }));
  const refused = await publish(scoped.id);
  assert.ok(!refused.ok && refused.reason === "CONFLICT");
  assert.deepEqual(refused.conflicts, [{ with: "LEGACY", id: legacy.id, name: `${PREFIX}-legacy` }]);

  const wide = await create(tierDraft("wide-legacy"));
  assert.equal((await publish(wide.id)).ok, true, "owner decision 2: store-wide skips the legacy refusal");
  await cleanup();
});

test("A06 two administrators publishing conflicting campaigns at once: exactly one wins", async () => {
  await cleanup();
  const a = await product("race");
  const left = await create(tierDraft("left", { targets: [{ productId: a.productId }] }));
  const right = await create(tierDraft("right", { targets: [{ productId: a.productId }] }));

  const results = await Promise.all([publish(left.id), publish(right.id)]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => !result.ok && result.reason === "CONFLICT").length, 1);
  assert.equal(await prisma.benefitCampaign.count({ where: { name: { startsWith: `${PREFIX}-` }, isEnabled: true } }), 1);
  await cleanup();
});

test("A06 disabling is repeatable, but an already-started campaign cannot be published again", async () => {
  await cleanup();
  const campaign = await create(tierDraft("disable"));
  await publish(campaign.id);
  const disabled = await disableBenefitCampaign(prisma, { id: campaign.id, now: NOW });
  assert.deepEqual(disabled, { ok: true, id: campaign.id, version: 3 });
  const row = await prisma.benefitCampaign.findUniqueOrThrow({ where: { id: campaign.id } });
  assert.equal(row.isEnabled, false);
  assert.deepEqual(row.disabledAt, NOW);
  assert.equal(row.enabledAt?.getTime(), NOW.getTime(), "history is kept");

  assert.deepEqual(await disableBenefitCampaign(prisma, { id: campaign.id, now: NOW }), { ok: true, id: campaign.id, version: 3 });
  assert.deepEqual(await disableBenefitCampaign(prisma, { id: "nope", now: NOW }), { ok: false, reason: "NOT_FOUND" });
  assert.deepEqual(await publish(campaign.id, 3), { ok: false, reason: "ALREADY_STARTED" });
  assert.equal((await prisma.benefitCampaign.findUniqueOrThrow({ where: { id: campaign.id } })).isEnabled, false);
  await cleanup();
});

test("A06 a draft may be redefined with the right version; a started campaign may not", async () => {
  await cleanup();
  const a = await product("edit");
  const campaign = await create(tierDraft("edit"));

  const replaced = await replaceBenefitCampaignDraft(prisma, {
    id: campaign.id,
    expectedVersion: 1,
    draft: tierDraft("edit-renamed", { targets: [{ productId: a.productId }], tiers: [{ thresholdQuantity: 3, thresholdSubtotalVnd: null, percentageValue: 15 }] }),
  });
  assert.deepEqual(replaced, { ok: true, id: campaign.id, version: 2 });
  assert.equal(await prisma.benefitCampaignTier.count({ where: { campaignId: campaign.id } }), 1, "the old steps are replaced");
  assert.equal(await prisma.benefitCampaignTarget.count({ where: { campaignId: campaign.id } }), 1);

  const draft = tierDraft("edit-again");
  assert.deepEqual(await replaceBenefitCampaignDraft(prisma, { id: campaign.id, expectedVersion: 1, draft }), { ok: false, reason: "STALE_VERSION" });
  assert.deepEqual(await replaceBenefitCampaignDraft(prisma, { id: "nope", expectedVersion: 1, draft }), { ok: false, reason: "NOT_FOUND" });
  assert.deepEqual(
    await replaceBenefitCampaignDraft(prisma, { id: campaign.id, expectedVersion: 2, draft: tierDraft("edit-bad", { targets: [{ productId: "no-such-product" }] }) }),
    { ok: false, reason: "UNKNOWN_TARGET" },
  );
  assert.equal(await prisma.benefitCampaignTier.count({ where: { campaignId: campaign.id } }), 1, "a refused edit changed nothing");

  await publish(campaign.id, 2);
  await disableBenefitCampaign(prisma, { id: campaign.id, now: NOW });
  const started = await replaceBenefitCampaignDraft(prisma, { id: campaign.id, expectedVersion: 4, draft });
  assert.deepEqual(started, { ok: false, reason: "ALREADY_STARTED" });
  await cleanup();
});

test("A06 deleting a catalog row removes the target or gift that pointed at it", async () => {
  await cleanup();
  const trigger = await product("cascade-t");
  const gift = await product("cascade-g");
  const campaign = await create({
    kind: "GIFT_ITEM",
    name: `${PREFIX}-cascade`,
    startsAt: null,
    endsAt: null,
    targets: [{ productId: trigger.productId }],
    tiers: [{ thresholdQuantity: 1, thresholdSubtotalVnd: null, percentageValue: null }],
    gifts: [{ variantId: gift.variantId, quantity: 1 }],
  });
  await prisma.productMirror.delete({ where: { id: gift.productId } });
  assert.equal(await prisma.benefitCampaignGift.count({ where: { campaignId: campaign.id } }), 0);
  await prisma.productMirror.delete({ where: { id: trigger.productId } });
  assert.equal(await prisma.benefitCampaignTarget.count({ where: { campaignId: campaign.id } }), 0);
  assert.equal(await prisma.benefitCampaign.count({ where: { id: campaign.id } }), 1, "the campaign itself stays");
  await cleanup();
});


test("A06 distinct variants of one product may publish separately, but a whole-product target conflicts", async () => {
  await cleanup();
  const sameProduct = await product("variants");
  const secondVariant = await prisma.variantMirror.create({
    data: {
      id: `${PREFIX}-variant-l`,
      pancakeVariationId: `${PREFIX}-variant-l`,
      productId: sameProduct.productId,
      syncedAt: EARLY,
    },
  });

  const sizeM = await create(tierDraft("variant-m", { targets: [{ variantId: sameProduct.variantId }] }));
  const sizeL = await create(tierDraft("variant-l", { targets: [{ variantId: secondVariant.id }] }));
  assert.equal((await publish(sizeM.id)).ok, true);
  assert.equal((await publish(sizeL.id)).ok, true, "distinct variants of one product must not conflict");

  const entireProduct = await create(tierDraft("entire-product", { targets: [{ productId: sameProduct.productId }] }));
  const refused = await publish(entireProduct.id);
  assert.ok(!refused.ok && refused.reason === "CONFLICT");
  assert.deepEqual(
    refused.conflicts?.map(({ id }) => id).sort(),
    [sizeM.id, sizeL.id].sort(),
    "a product target covers both variants",
  );
  await cleanup();
});

test("A06 legacy variant targets do not block a different sibling variant", async () => {
  await cleanup();
  const sameProduct = await product("legacy-variants");
  const secondVariant = await prisma.variantMirror.create({
    data: {
      id: `${PREFIX}-legacy-variant-l`,
      pancakeVariationId: `${PREFIX}-legacy-variant-l`,
      productId: sameProduct.productId,
      syncedAt: EARLY,
    },
  });
  await prisma.promotionCampaign.create({
    data: {
      kind: "PROMOTION",
      name: `${PREFIX}-legacy-variant-only`,
      discountType: "PERCENTAGE",
      percentageValue: 10,
      isEnabled: true,
      enabledAt: EARLY,
      targets: { create: [{ variantId: secondVariant.id }] },
    },
  });

  const otherVariant = await create(tierDraft("other-legacy-variant", { targets: [{ variantId: sameProduct.variantId }] }));
  assert.equal((await publish(otherVariant.id)).ok, true);
  await cleanup();
});

test("A06 publish fails closed above the 500-row enabled legacy conflict scan limit", async () => {
  await cleanup();
  const candidate = await create(tierDraft("scan-legacy-candidate"));
  await prisma.promotionCampaign.createMany({
    data: Array.from({ length: 501 }, (_unused, index) => ({
      kind: "PROMOTION",
      name: `${PREFIX}-scan-legacy-${index}`,
      discountType: "PERCENTAGE",
      percentageValue: 10,
      isEnabled: true,
      enabledAt: EARLY,
      startsAt: new Date("2027-01-01T00:00:00.000Z"),
    })),
  });
  assert.deepEqual(await publish(candidate.id), { ok: false, reason: "CONFLICT_SCAN_LIMIT" });
  assert.equal((await prisma.benefitCampaign.findUniqueOrThrow({ where: { id: candidate.id } })).isEnabled, false);
  await cleanup();
});

test("A06 publish fails closed above the 500-row enabled benefit conflict scan limit", async () => {
  await cleanup();
  const candidate = await create(tierDraft("scan-benefit-candidate"));
  await prisma.benefitCampaign.createMany({
    data: Array.from({ length: 501 }, (_unused, index) => ({
      kind: "QUANTITY_TIER",
      name: `${PREFIX}-scan-benefit-${index}`,
      isEnabled: true,
      enabledAt: EARLY,
      startsAt: new Date("2027-01-01T00:00:00.000Z"),
    })),
  });
  assert.deepEqual(await publish(candidate.id), { ok: false, reason: "CONFLICT_SCAN_LIMIT" });
  assert.equal((await prisma.benefitCampaign.findUniqueOrThrow({ where: { id: candidate.id } })).isEnabled, false);
  await cleanup();
});
