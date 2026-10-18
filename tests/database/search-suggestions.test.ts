/**
 * B07 — search suggestions are the canonical `/shop` discovery read, bounded.
 *
 * What these prove against a real database: a suggestion shows only what the listing would show
 * (hidden, inactive and other-shop products never appear), its price is the effective promotional
 * price rather than the mirrored base, the response is capped however many products match, and the
 * number of statements issued does not grow with the number of rows returned.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../src/generated/prisma/client.ts";
import { createStorefrontCatalogRepository } from "../../src/commerce/storefront-catalog.ts";
import {
  loadStorefrontSearchSuggestionCandidates,
  STOREFRONT_SEARCH_SUGGESTION_LIMITS,
} from "../../src/commerce/storefront-search-suggestions.ts";
import { buildSearchSuggestionsModel } from "../../src/routes/search-suggestions-model.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
  log: [{ emit: "event", level: "query" }],
});
let statements = 0;
prisma.$on("query", () => {
  statements += 1;
});
const repository = createStorefrontCatalogRepository(prisma);

const P = "b07-sg";
const SHOP = 920_970;
const OTHER_SHOP = 920_971;
const NOW = new Date("2026-10-18T00:00:00.000Z");
const WORD = "b07zeta";

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM "PromotionTarget" WHERE "id" LIKE ${`${P}-%`}`;
  await prisma.$executeRaw`DELETE FROM "PromotionCampaign" WHERE "id" LIKE ${`${P}-%`}`;
  await prisma.$executeRaw`DELETE FROM "ProductMirror" WHERE "pancakeProductId" LIKE ${`${P}-%`}`;
}

async function seedProduct(
  key: string,
  name: string,
  price: number,
  options: { shop?: number; isActive?: boolean; isPresent?: boolean } = {},
) {
  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: options.shop ?? SHOP,
      pancakeProductId: `${P}-${key}`,
      slug: `${P}-${key}`,
      name,
      isPresent: options.isPresent ?? true,
      isActive: options.isActive ?? true,
      syncedAt: NOW,
    },
  });
  const variant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: `${P}-pv-${key}`,
      productId: product.id,
      color: "Đen",
      size: "M",
      pancakeRetailPrice: price,
      pancakeRetailPriceAfterDiscount: price,
      isPresent: true,
      isActive: true,
      syncedAt: NOW,
    },
  });
  await prisma.warehouseStock.create({
    data: { variantId: variant.id, pancakeWarehouseId: `${P}-wh`, quantity: 9, syncedAt: NOW },
  });
  return product;
}

async function discount(key: string, productId: string, percentageValue: number) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionCampaign"
       ("id","kind","name","discountType","percentageValue","isEnabled","enabledAt","createdAt","updatedAt")
     VALUES ($1,'PROMOTION'::"PromotionCampaignKind",$2,'PERCENTAGE'::"PromotionDiscountType",$3,true,$4,$4,$4)`,
    `${P}-${key}`,
    `B07 ${key}`,
    percentageValue,
    NOW,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionTarget" ("id","campaignId","productId","createdAt") VALUES ($1,$2,$3,$4)`,
    `${P}-t-${key}`,
    `${P}-${key}`,
    productId,
    NOW,
  );
}

async function suggest(rawQuery: unknown, enabled = true) {
  let pricingRule: Parameters<typeof buildSearchSuggestionsModel>[1];
  const candidates = await loadStorefrontSearchSuggestionCandidates(
    {
      enabled,
      now: () => NOW,
      async listDiscoveryPage({ discovery, pageSize, now }) {
        const page = await repository.listDiscoveryPage({ shopId: SHOP, discovery, pageSize, now });
        pricingRule = page.pricingRule;
        return page;
      },
    },
    rawQuery,
  );
  return buildSearchSuggestionsModel(candidates, pricingRule);
}

test("B07 hidden, inactive and other-shop products never appear in suggestions", async () => {
  await cleanup();
  try {
    await seedProduct("visible", `${WORD} Visible`, 300_000);
    await seedProduct("inactive", `${WORD} Inactive`, 300_000, { isActive: false });
    await seedProduct("absent", `${WORD} Absent`, 300_000, { isPresent: false });
    await seedProduct("foreign", `${WORD} Foreign`, 300_000, { shop: OTHER_SHOP });

    const model = await suggest(WORD);
    assert.equal(model.ok, true);
    if (!model.ok) return;
    assert.deepEqual(
      model.items.map((item) => item.key),
      [`${P}-visible`],
    );
    assert.equal(model.totalCount, 1);
    assert.equal(model.items[0]?.href, `/shop/${P}-visible`);
  } finally {
    await cleanup();
  }
});

test("B07 a suggestion's price is the effective promotional price", async () => {
  await cleanup();
  try {
    const product = await seedProduct("sale", `${WORD} Sale`, 800_000);
    await discount("sale", product.id, 50);

    const model = await suggest(WORD);
    assert.equal(model.ok, true);
    if (!model.ok) return;
    const [item] = model.items;
    assert.ok(item);
    // 800,000 at 50% is 400,000; the mirrored base must not be what the shopper is shown.
    assert.ok(item.priceText.includes("400.000"), item.priceText);
    assert.equal(item.priceText.includes("800.000"), false);
    assert.ok(item.compareAtText?.includes("800.000"), String(item.compareAtText));
  } finally {
    await cleanup();
  }
});

test("B07 the response is capped however many products match", async () => {
  await cleanup();
  try {
    const total = STOREFRONT_SEARCH_SUGGESTION_LIMITS.maxSuggestions + 5;
    for (let index = 0; index < total; index += 1) {
      await seedProduct(`many-${String(index).padStart(2, "0")}`, `${WORD} Item ${String(index).padStart(2, "0")}`, 200_000);
    }

    const model = await suggest(WORD);
    assert.equal(model.ok, true);
    if (!model.ok) return;
    assert.equal(model.items.length, STOREFRONT_SEARCH_SUGGESTION_LIMITS.maxSuggestions);
    assert.equal(model.totalCount, total);
    assert.equal(model.remainingCount, total - STOREFRONT_SEARCH_SUGGESTION_LIMITS.maxSuggestions);
    // Name order of the canonical listing, with no suggestion-specific ranking.
    assert.deepEqual(
      model.items.map((item) => item.name),
      Array.from({ length: STOREFRONT_SEARCH_SUGGESTION_LIMITS.maxSuggestions }, (_, i) => `${WORD} Item ${String(i).padStart(2, "0")}`),
    );
    assert.equal(model.seeAllHref, `/shop?q=${WORD}`);
  } finally {
    await cleanup();
  }
});

test("B07 statement count is bounded and does not grow with the rows returned", async () => {
  await cleanup();
  try {
    await seedProduct("one", `${WORD} Only`, 200_000);
    statements = 0;
    await suggest(WORD);
    const withOne = statements;

    for (let index = 0; index < STOREFRONT_SEARCH_SUGGESTION_LIMITS.maxSuggestions; index += 1) {
      await seedProduct(`n-${index}`, `${WORD} Extra ${index}`, 200_000);
    }
    statements = 0;
    await suggest(WORD);
    const withMany = statements;

    assert.ok(withOne > 0);
    assert.equal(withMany, withOne, "no per-row statements");
    // 13 today: the canonical discovery read's fixed cost. The ceiling leaves headroom for that read
    // to change, but not for a per-row or per-suggestion statement to creep in.
    assert.ok(withMany <= 16, `bounded statement count, saw ${withMany}`);
  } finally {
    await cleanup();
  }
});

test("B07 a query containing SQL pattern characters matches them literally", async () => {
  await cleanup();
  try {
    await seedProduct("pct", `${WORD} 100% cotton`, 200_000);
    await seedProduct("plain", `${WORD} plain`, 200_000);

    const wildcard = await suggest("%");
    assert.deepEqual(wildcard, { ok: false, reason: "QUERY_TOO_SHORT" });

    const literal = await suggest("100%");
    assert.equal(literal.ok, true);
    if (!literal.ok) return;
    assert.deepEqual(
      literal.items.map((item) => item.key),
      [`${P}-pct`],
    );
  } finally {
    await cleanup();
  }
});

test("B07 OFF issues no catalog statement at all", async () => {
  await cleanup();
  try {
    await seedProduct("off", `${WORD} Off`, 200_000);
    statements = 0;
    assert.deepEqual(await suggest(WORD, false), { ok: false, reason: "DISABLED" });
    assert.equal(statements, 0);
  } finally {
    await cleanup();
  }
});

test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});
