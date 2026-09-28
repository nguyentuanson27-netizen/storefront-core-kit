/**
 * U16 / P7a — SQL ↔ TypeScript pricing parity.
 *
 * `/shop` must filter and order by effective price *before* it paginates, which a TypeScript pass
 * over one page cannot do. #151 therefore sanctions exactly one SQL mirror of the pricing contract
 * — and a mirror is only safe while something proves it still reflects the original.
 *
 * This runs the **shipped** projection (`buildVariantStockCte`, the same builder the discovery
 * query uses) against real PostgreSQL, and compares its answer with `resolvePromotionPricing` on
 * the identical facts. A divergence here is two different prices for one variant depending on which
 * page a shopper looked at.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";
import { SELLING_MODE_FLAGS_OFF } from "../../src/commerce/selling-policy.ts";
import { Prisma } from "../../src/generated/prisma/client.ts";

import { PrismaClient } from "../../src/generated/prisma/client.ts";
import { buildVariantStockCte } from "../../src/commerce/storefront-catalog.ts";
import {
  resolvePromotionPricing,
  type ApplicablePromotionCampaign,
} from "../../src/commerce/promotion-pricing.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const P = "u16-parity";
const SHOP = 920_951;
const NOW = new Date("2026-09-15T00:00:00.000Z");

type Fixture = Readonly<{
  key: string;
  basePriceVnd: number | null;
  campaigns: readonly ApplicablePromotionCampaign[];
}>;

function percentage(id: string, percentageValue: number, overrides: Partial<ApplicablePromotionCampaign> = {}): ApplicablePromotionCampaign {
  return {
    id, name: id, kind: "PROMOTION", discountType: "PERCENTAGE",
    percentageValue, fixedPriceVnd: null, startsAt: null, endsAt: null, ...overrides,
  };
}

function fixed(id: string, fixedPriceVnd: bigint, overrides: Partial<ApplicablePromotionCampaign> = {}): ApplicablePromotionCampaign {
  return {
    id, name: id, kind: "FLASH_SALE", discountType: "FIXED_PRICE",
    percentageValue: null, fixedPriceVnd, startsAt: null, endsAt: null, ...overrides,
  };
}

const OPEN = { startsAt: new Date("2026-09-01T00:00:00.000Z"), endsAt: new Date("2026-09-30T00:00:00.000Z") };
const CLOSED = { startsAt: new Date("2026-10-01T00:00:00.000Z"), endsAt: new Date("2026-10-30T00:00:00.000Z") };
const ENDED = { startsAt: new Date("2026-08-01T00:00:00.000Z"), endsAt: new Date("2026-09-15T00:00:00.000Z") };

const FIXTURES: readonly Fixture[] = [
  // The four mandated percentage fixtures.
  { key: "mandated-150-1", basePriceVnd: 150, campaigns: [percentage("c-150", 1)] },
  { key: "mandated-350-1", basePriceVnd: 350, campaigns: [percentage("c-350", 1)] },
  { key: "mandated-110-5", basePriceVnd: 110, campaigns: [percentage("c-110", 5)] },
  { key: "mandated-upper", basePriceVnd: 9_007_199_254_740_989, campaigns: [percentage("c-upper", 1)] },

  { key: "no-campaign", basePriceVnd: 500_000, campaigns: [] },
  { key: "percentage-10", basePriceVnd: 500_000, campaigns: [percentage("c-p10", 10)] },
  { key: "percentage-99", basePriceVnd: 500_000, campaigns: [percentage("c-p99", 99)] },
  { key: "percentage-1", basePriceVnd: 500_001, campaigns: [percentage("c-p1", 1)] },
  { key: "fixed-valid", basePriceVnd: 500_000, campaigns: [fixed("c-f1", BigInt(399_000))] },
  // A fixed price at or above base cannot discount: affected variant falls back to base.
  { key: "fixed-equal", basePriceVnd: 500_000, campaigns: [fixed("c-f2", BigInt(500_000))] },
  { key: "fixed-above", basePriceVnd: 500_000, campaigns: [fixed("c-f3", BigInt(600_000))] },
  // Low-price rounding that lands back on base is not a discount.
  { key: "low-price-invalid", basePriceVnd: 50, campaigns: [percentage("c-low", 1)] },
  // Conflict: two candidates, so neither applies.
  { key: "conflict", basePriceVnd: 500_000, campaigns: [percentage("c-x", 10), percentage("c-y", 20)] },
  // Window boundaries against the shared `now`.
  { key: "window-open", basePriceVnd: 500_000, campaigns: [percentage("c-open", 10, OPEN)] },
  { key: "window-scheduled", basePriceVnd: 500_000, campaigns: [percentage("c-sched", 10, CLOSED)] },
  // endsAt is exclusive and equals `now`, so this campaign is over.
  { key: "window-ended-exactly", basePriceVnd: 500_000, campaigns: [percentage("c-ended", 10, ENDED)] },
  // Unusable bases must project no price at all.
  { key: "base-null", basePriceVnd: null, campaigns: [percentage("c-null", 10)] },
  { key: "base-zero", basePriceVnd: 0, campaigns: [percentage("c-zero", 10)] },
  { key: "base-negative", basePriceVnd: -1, campaigns: [percentage("c-neg", 10)] },
  { key: "base-fractional", basePriceVnd: 1.5, campaigns: [percentage("c-frac", 10)] },
];

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM "PromotionTarget" WHERE "id" LIKE ${`${P}-%`}`;
  await prisma.$executeRaw`DELETE FROM "PromotionCampaign" WHERE "id" LIKE ${`${P}-%`}`;
  await prisma.$executeRaw`DELETE FROM "ProductMirror" WHERE "pancakeProductId" LIKE ${`${P}-%`}`;
}

/** Every fixture gets its own product so a PRODUCT target cannot leak across fixtures. */
async function seed(): Promise<Map<string, string>> {
  const variantIdByKey = new Map<string, string>();

  for (const fixture of FIXTURES) {
    const product = await prisma.productMirror.create({
      data: {
        pancakeShopId: SHOP,
        pancakeProductId: `${P}-${fixture.key}`,
        slug: `${P}-${fixture.key}`,
        name: `U16 ${fixture.key}`,
        isPresent: true, isActive: true, syncedAt: NOW,
      },
    });

    const variant = await prisma.variantMirror.create({
      data: {
        pancakeVariationId: `${P}-pv-${fixture.key}`,
        productId: product.id,
        color: "Đen", size: "M",
        pancakeRetailPrice: fixture.basePriceVnd,
        // Deliberately different so any surviving equality gate would zero these out.
        pancakeRetailPriceAfterDiscount:
          fixture.basePriceVnd === null ? null : fixture.basePriceVnd - 1,
        isPresent: true, isActive: true, syncedAt: NOW,
      },
    });
    await prisma.warehouseStock.create({
      data: { variantId: variant.id, pancakeWarehouseId: `${P}-wh`, quantity: 10, syncedAt: NOW },
    });
    variantIdByKey.set(fixture.key, variant.id);

    for (const campaign of fixture.campaigns) {
      const campaignId = `${P}-${fixture.key}-${campaign.id}`;
      await prisma.$executeRawUnsafe(
        `INSERT INTO "PromotionCampaign"
           ("id","kind","name","discountType","percentageValue","fixedPriceVnd","startsAt","endsAt",
            "isEnabled","enabledAt","createdAt","updatedAt")
         VALUES ($1,$2::"PromotionCampaignKind",$3,$4::"PromotionDiscountType",$5,$6,$7,$8,true,$9,$9,$9)`,
        campaignId, campaign.kind, campaign.name, campaign.discountType,
        campaign.percentageValue, campaign.fixedPriceVnd, campaign.startsAt, campaign.endsAt, NOW,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "PromotionTarget" ("id","campaignId","variantId","createdAt") VALUES ($1,$2,$3,$4)`,
        `${P}-t-${fixture.key}-${campaign.id}`, campaignId, variant.id, NOW,
      );
    }
  }

  return variantIdByKey;
}

test("U16 the shipped SQL projection agrees with the TypeScript resolver on every fixture", async () => {
  await cleanup();
  const variantIdByKey = await seed();

  try {
    const ids = [...variantIdByKey.values()];
    const rows = await prisma.$queryRaw<Array<{ id: string; resolvedPrice: number | null }>>(
      Prisma.sql`
        ${buildVariantStockCte(NOW, SELLING_MODE_FLAGS_OFF)}
        SELECT "id", "resolvedPrice" FROM "variant_stock" WHERE "id" = ANY(${ids}::text[])
      `,
    );
    const sqlPriceByVariantId = new Map(rows.map((row) => [row.id, row.resolvedPrice]));

    assert.equal(rows.length, FIXTURES.length, "every seeded variant must appear in the projection");

    for (const fixture of FIXTURES) {
      const variantId = variantIdByKey.get(fixture.key)!;
      const sqlPrice = sqlPriceByVariantId.get(variantId) ?? null;

      const typescript = resolvePromotionPricing({
        basePriceVnd: fixture.basePriceVnd,
        campaigns: fixture.campaigns,
        now: NOW,
      });

      assert.equal(
        sqlPrice,
        typescript.effectivePriceVnd,
        `${fixture.key}: SQL projected ${sqlPrice} but the resolver said ${typescript.effectivePriceVnd}`,
      );
    }
  } finally {
    await cleanup();
  }
});

test("U16 the mandated rounding fixtures survive the SQL round trip exactly", async () => {
  await cleanup();
  const variantIdByKey = await seed();

  try {
    const expected = new Map<string, number>([
      ["mandated-150-1", 149],
      ["mandated-350-1", 347],
      ["mandated-110-5", 105],
      ["mandated-upper", 8_917_127_262_193_579],
    ]);

    const ids = [...expected.keys()].map((key) => variantIdByKey.get(key)!);
    const rows = await prisma.$queryRaw<Array<{ id: string; resolvedPrice: number | null }>>(
      Prisma.sql`
        ${buildVariantStockCte(NOW, SELLING_MODE_FLAGS_OFF)}
        SELECT "id", "resolvedPrice" FROM "variant_stock" WHERE "id" = ANY(${ids}::text[])
      `,
    );
    const byId = new Map(rows.map((row) => [row.id, row.resolvedPrice]));

    for (const [key, value] of expected) {
      assert.equal(
        byId.get(variantIdByKey.get(key)!),
        value,
        `${key} must project exactly ${value} through PostgreSQL numeric arithmetic`,
      );
    }
  } finally {
    await cleanup();
  }
});

test("U16 a PRODUCT target reaches the variant through its real owner", async () => {
  await cleanup();
  try {
    const product = await prisma.productMirror.create({
      data: {
        pancakeShopId: SHOP, pancakeProductId: `${P}-owner`, slug: `${P}-owner`,
        name: "U16 Owner", isPresent: true, isActive: true, syncedAt: NOW,
      },
    });
    const variant = await prisma.variantMirror.create({
      data: {
        pancakeVariationId: `${P}-pv-owner`, productId: product.id, color: "Đen", size: "M",
        pancakeRetailPrice: 500_000, pancakeRetailPriceAfterDiscount: 499_999,
        isPresent: true, isActive: true, syncedAt: NOW,
      },
    });
    await prisma.warehouseStock.create({
      data: { variantId: variant.id, pancakeWarehouseId: `${P}-wh`, quantity: 5, syncedAt: NOW },
    });
    await prisma.$executeRawUnsafe(
      `INSERT INTO "PromotionCampaign"
         ("id","kind","name","discountType","percentageValue","isEnabled","enabledAt","createdAt","updatedAt")
       VALUES ($1,'PROMOTION'::"PromotionCampaignKind",'U16 product campaign','PERCENTAGE'::"PromotionDiscountType",20,true,$2,$2,$2)`,
      `${P}-prod-campaign`, NOW,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "PromotionTarget" ("id","campaignId","productId","createdAt") VALUES ($1,$2,$3,$4)`,
      `${P}-t-prod`, `${P}-prod-campaign`, product.id, NOW,
    );

    const rows = await prisma.$queryRaw<Array<{ resolvedPrice: number | null }>>(
      Prisma.sql`
        ${buildVariantStockCte(NOW, SELLING_MODE_FLAGS_OFF)}
        SELECT "resolvedPrice" FROM "variant_stock" WHERE "id" = ${variant.id}
      `,
    );

    assert.equal(rows[0]?.resolvedPrice, 400_000, "a PRODUCT target must price its own variants");
  } finally {
    await cleanup();
  }
});

test("U16 one campaign covering a variant both directly and by product is one candidate, not a conflict", async () => {
  await cleanup();
  try {
    const product = await prisma.productMirror.create({
      data: {
        pancakeShopId: SHOP, pancakeProductId: `${P}-dual`, slug: `${P}-dual`,
        name: "U16 Dual", isPresent: true, isActive: true, syncedAt: NOW,
      },
    });
    const variant = await prisma.variantMirror.create({
      data: {
        pancakeVariationId: `${P}-pv-dual`, productId: product.id, color: "Đen", size: "M",
        pancakeRetailPrice: 500_000, pancakeRetailPriceAfterDiscount: 499_999,
        isPresent: true, isActive: true, syncedAt: NOW,
      },
    });
    await prisma.warehouseStock.create({
      data: { variantId: variant.id, pancakeWarehouseId: `${P}-wh`, quantity: 5, syncedAt: NOW },
    });
    await prisma.$executeRawUnsafe(
      `INSERT INTO "PromotionCampaign"
         ("id","kind","name","discountType","percentageValue","isEnabled","enabledAt","createdAt","updatedAt")
       VALUES ($1,'PROMOTION'::"PromotionCampaignKind",'U16 dual','PERCENTAGE'::"PromotionDiscountType",10,true,$2,$2,$2)`,
      `${P}-dual-campaign`, NOW,
    );
    // The same campaign, reaching the variant twice.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "PromotionTarget" ("id","campaignId","productId","createdAt") VALUES ($1,$2,$3,$4)`,
      `${P}-t-dual-p`, `${P}-dual-campaign`, product.id, NOW,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "PromotionTarget" ("id","campaignId","variantId","createdAt") VALUES ($1,$2,$3,$4)`,
      `${P}-t-dual-v`, `${P}-dual-campaign`, variant.id, NOW,
    );

    const rows = await prisma.$queryRaw<Array<{ resolvedPrice: number | null }>>(
      Prisma.sql`
        ${buildVariantStockCte(NOW, SELLING_MODE_FLAGS_OFF)}
        SELECT "resolvedPrice" FROM "variant_stock" WHERE "id" = ${variant.id}
      `,
    );

    // Counting target rows instead of distinct campaigns would read 2 here and wrongly conflict.
    assert.equal(rows[0]?.resolvedPrice, 450_000, "one campaign reaching twice is still one candidate");
  } finally {
    await cleanup();
  }
});

test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});
