import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createStorefrontCatalogRepository } from "../../src/commerce/storefront-catalog.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const SHOP_ID = 999_006;
const EARLY = new Date("2026-01-01T00:00:00.000Z");
const PREFIX = "new-arrivals-listing";

test.after(async () => {
  await prisma.$disconnect();
});

async function cleanup() {
  await prisma.promotionCampaign.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.productMirror.deleteMany({ where: { pancakeProductId: { startsWith: PREFIX } } });
}

async function product(name: string, { stock = 5, price = 200_000, isActive = true, isPresent = true } = {}) {
  const key = `${PREFIX}-${name}`;
  const created = await prisma.productMirror.create({
    data: {
      pancakeShopId: SHOP_ID,
      pancakeProductId: key,
      slug: key,
      name: key,
      isActive,
      isPresent,
      syncedAt: EARLY,
    },
  });
  await prisma.variantMirror.create({
    data: {
      id: key,
      pancakeVariationId: key,
      productId: created.id,
      isPresent: true,
      isActive: true,
      pancakeRetailPrice: price,
      pancakeRetailPriceAfterDiscount: price,
      size: "M",
      syncedAt: EARLY,
    },
  });
  await prisma.warehouseStock.create({
    data: { variantId: key, pancakeWarehouseId: "w0", quantity: stock, syncedAt: EARLY },
  });
  return created.id;
}

const repository = () => createStorefrontCatalogRepository(prisma);

test("B03 products come back in the order given", async () => {
  await cleanup();
  const a = await product("a");
  const b = await product("b");
  const c = await product("c");

  const result = await repository().listProductsByIds({ shopId: SHOP_ID, productIds: [c, a, b] });
  assert.deepEqual(result.products.map((p) => p.id), [c, a, b], "stored order, not name order");
  await cleanup();
});

test("B03 hidden, inactive and unknown products are dropped in place and never replaced", async () => {
  await cleanup();
  const a = await product("a");
  const hidden = await product("hidden", { isActive: false });
  const gone = await product("gone", { isPresent: false });
  const b = await product("b");
  const outside = await product("outside"); // visible, but not selected

  const result = await repository().listProductsByIds({
    shopId: SHOP_ID,
    productIds: [a, hidden, "no-such-product", gone, b],
  });
  assert.deepEqual(result.products.map((p) => p.id), [a, b]);
  assert.ok(!result.products.some((p) => p.id === outside), "no backfill from other products");
  await cleanup();
});

test("B03 a product of another shop is not visible here", async () => {
  await cleanup();
  const id = await product("foreign");
  await prisma.productMirror.update({ where: { id }, data: { pancakeShopId: SHOP_ID + 1 } });
  const result = await repository().listProductsByIds({ shopId: SHOP_ID, productIds: [id] });
  assert.deepEqual(result.products, []);
  await cleanup();
});

test("B03 stock comes from the shared capacity projection", async () => {
  await cleanup();
  const inStock = await product("in", { stock: 4 });
  const soldOut = await product("out", { stock: 0 });
  const result = await repository().listProductsByIds({ shopId: SHOP_ID, productIds: [inStock, soldOut] });
  assert.deepEqual(result.products.map((p) => p.variants[0]!.sellableStock), [4, 0]);
  await cleanup();
});

test("B03 prices follow the promotion rule exactly as /shop prices them", async () => {
  await cleanup();
  const promoted = await product("promoted", { price: 200_000 });
  const plain = await product("plain", { price: 200_000 });
  await prisma.promotionCampaign.create({
    data: {
      kind: "PROMOTION",
      name: `${PREFIX}-ten-percent`,
      discountType: "PERCENTAGE",
      percentageValue: 10,
      isEnabled: true,
      enabledAt: EARLY,
      targets: { create: [{ productId: promoted }] },
    },
  });

  const result = await repository().listProductsByIds({ shopId: SHOP_ID, productIds: [promoted, plain] });
  const [first, second] = result.products;
  assert.deepEqual(result.pricingRule(first!.variants[0]!), { price: 180_000, basePriceVnd: 200_000, isDiscounted: true });
  assert.deepEqual(result.pricingRule(second!.variants[0]!), { price: 200_000, basePriceVnd: 200_000, isDiscounted: false });
  assert.ok(result.refreshAfterMs > 0);
  await cleanup();
});

test("B03 empty input is an empty, cheap answer and an oversized request is refused", async () => {
  const empty = await repository().listProductsByIds({ shopId: SHOP_ID, productIds: [] });
  assert.deepEqual(empty.products, []);
  assert.ok(empty.refreshAfterMs > 0);

  const tooMany = Array.from({ length: 101 }, (_unused, index) => `id-${index}`);
  await assert.rejects(
    repository().listProductsByIds({ shopId: SHOP_ID, productIds: tooMany }),
    RangeError,
  );
});
