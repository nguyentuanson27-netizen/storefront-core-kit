import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { readMerchantIdentityRows } from "../../src/commerce/merchant-identity-audit-repository.ts";
import { createMerchantOfferRepository } from "../../src/commerce/merchant-offer-repository.ts";
import { SELLING_MODE_FLAGS_OFF, type SellingModeFlags } from "../../src/commerce/selling-policy.ts";
import { createStorefrontCatalogRepository } from "../../src/commerce/storefront-catalog.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

/**
 * Selling modes spec §9, M3b: the Merchant repository and the PDP catalog read, each through its
 * real query, under a stored policy — including the Merchant read's single joined query.
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const SHOP_ID = 920_051;
const PREFIX = "selling-publication";
const syncedAt = new Date("2026-09-01T00:00:00.000Z");
const ON: SellingModeFlags = { sellingModesEnabled: true, preorderEnabled: true };

async function cleanup() {
  await prisma.productMirror.deleteMany({ where: { pancakeShopId: SHOP_ID } });
}

test.before(cleanup);
test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

async function product(name: string, stock: number, sellingMode: "OVERSELL" | "PREORDER" | null) {
  const slug = `${PREFIX}-${name}`;
  await prisma.productMirror.create({
    data: {
      pancakeShopId: SHOP_ID,
      pancakeProductId: slug,
      slug,
      name,
      isPresent: true,
      isActive: true,
      syncedAt,
      ...(sellingMode === null ? {} : { sellingPolicy: { create: { sellingMode, negativeStockLimit: -20 } } }),
      variants: {
        create: {
          id: `${slug}-m`,
          pancakeVariationId: `${slug}-m`,
          pancakeDisplayId: `MPN-${slug}`,
          color: "Black",
          size: "M",
          isPresent: true,
          isActive: true,
          pancakeRetailPrice: 450_000,
          pancakeRetailPriceAfterDiscount: 450_000,
          syncedAt,
          warehouseStocks: { create: { pancakeWarehouseId: "w", quantity: stock, syncedAt } },
        },
      },
    },
  });
  return slug;
}

test("the Merchant read states OVERSELL stock as sellable units and marks a preorder sale pending", async () => {
  const over = await product("over", -3, "OVERSELL");
  const pre = await product("pre", 0, "PREORDER");
  const plain = await product("plain", -3, null);

  const read = async (flags: SellingModeFlags) => {
    const products = await createMerchantOfferRepository(prisma, { sellingModeFlags: flags }).readCandidateProducts({
      shopId: SHOP_ID,
    });
    return Object.fromEntries(
      products.flatMap((candidate) =>
        candidate.variations.map((variation) => [
          variation.variantId,
          [variation.stockQuantity, variation.preorderProjectionPending === true],
        ]),
      ),
    );
  };

  const on = await read(ON);
  assert.deepEqual(on[`${over}-m`], [17, false]);
  assert.deepEqual(on[`${pre}-m`], [20, true]);
  assert.ok(Number.isNaN((on[`${plain}-m`] as [number, boolean])[0]), "no row: a negative row stays a defect");

  const off = await read(SELLING_MODE_FLAGS_OFF);
  for (const slug of [over, pre, plain]) {
    const [stock, pending] = off[`${slug}-m`] as [number, boolean];
    assert.equal(pending, false, slug);
    assert.ok(slug === pre ? stock === 0 : Number.isNaN(stock), `${slug} is exactly STANDARD with the flag off`);
  }
});

test("the PDP read lets JSON-LD state an OVERSELL variant's availability only while the mode is effective", async () => {
  const over = await product("pdp-over", -3, "OVERSELL");
  const resolved = async (flags: SellingModeFlags) => {
    const read = await createStorefrontCatalogRepository(prisma, { sellingModeFlags: flags }).getProductBySlug({
      shopId: SHOP_ID,
      slug: over,
    });
    assert.ok(read);
    return [read.variantAvailabilityResolvedById[`${over}-m`], read.variants[0]!.sellableStock];
  };
  assert.deepEqual(await resolved(ON), [true, 17]);
  assert.deepEqual(await resolved(SELLING_MODE_FLAGS_OFF), [false, 0]);
});

test("the Merchant identity audit uses the same stock rule as the feed", async () => {
  const over = await product("audit-over", -3, "OVERSELL");
  const stock = async (flags: SellingModeFlags) =>
    (await readMerchantIdentityRows(SHOP_ID, { sellingModeFlags: flags })).find(
      (row) => row.pancakeVariationId === `${over}-m`,
    )?.stockQuantity;
  assert.equal(await stock(ON), 17);
  assert.ok(Number.isNaN(await stock(SELLING_MODE_FLAGS_OFF)));
});
