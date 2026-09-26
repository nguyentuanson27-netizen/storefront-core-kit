import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createGuestCheckoutSnapshotService } from "../../src/commerce/guest-checkout-snapshot.ts";
import { acceptAnyRenderedQuote } from "../fixtures/rendered-quote-authority.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";
import { deleteOrdersWithCapacity } from "../support/order-cleanup.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const shopId = 920_007;
const now = new Date("2026-09-03T04:00:00.000Z");
const prefix = "u20-p8-boundary";

const checkoutInput = {
  name: "Nguyễn Văn A",
  phone: "0901234567",
  provinceRef: "province-01",
  districtRef: "district-001",
  communeRef: "commune-0001",
  detail: "12 Đường A",
  note: null,
};

async function cleanup() {
  await deleteOrdersWithCapacity(prisma, { where: { publicCode: { startsWith: prefix } } });
  await prisma.cart.deleteMany({
    where: { items: { some: { variant: { pancakeVariationId: { startsWith: prefix } } } } },
  });
  await prisma.productMirror.deleteMany({ where: { pancakeProductId: { startsWith: prefix } } });
}

async function snapshot(cartId: string, publicCode: string, input: unknown = checkoutInput) {
  return createGuestCheckoutSnapshotService(prisma, { checkoutInputValidated: true, verifyRenderedQuote: acceptAnyRenderedQuote }).create({
    cartId,
    shopId,
    publicCode,
    checkoutInput: input,
    now,
  });
}

test.before(cleanup);
test.afterEach(cleanup);
test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test("P8 invalid base price fails closed without creating a partial DRAFT", async () => {
  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: `${prefix}-invalid-product`,
      slug: `${prefix}-invalid-product`,
      name: "Invalid base product",
      isPresent: true,
      isActive: true,
      syncedAt: now,
      variants: {
        create: {
          pancakeVariationId: `${prefix}-invalid-variation`,
          color: "Black",
          size: "M",
          isPresent: true,
          isActive: true,
          pancakeRetailPrice: 0,
          pancakeRetailPriceAfterDiscount: 0,
          syncedAt: now,
          warehouseStocks: {
            create: {
              pancakeWarehouseId: `${prefix}-invalid-warehouse`,
              quantity: 5,
              syncedAt: now,
            },
          },
        },
      },
    },
    include: { variants: true },
  });
  const cart = await prisma.cart.create({
    data: {
      expiresAt: new Date(now.getTime() + 60_000),
      items: { create: { variantId: product.variants[0]!.id, quantity: 1 } },
    },
  });
  const publicCode = `${prefix}-invalid-order`;

  assert.deepEqual(await snapshot(cart.id, publicCode), {
    ok: false,
    reason: "CART_LINE_UNAVAILABLE",
  });
  assert.equal(await prisma.orderMirror.count({ where: { publicCode } }), 0);
});

test("P8 composite DRAFT preserves the actual purchased component pancakeVariationId", async () => {
  const parent = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: `${prefix}-parent-product`,
      slug: `${prefix}-parent-product`,
      name: "Public composite parent",
      isPresent: true,
      isActive: true,
      syncedAt: now,
      variants: {
        create: {
          pancakeVariationId: `${prefix}-parent-variation`,
          color: "Set",
          size: "M",
          isPresent: true,
          isActive: true,
          pancakeRetailPrice: 900_000,
          pancakeRetailPriceAfterDiscount: 900_000,
          syncedAt: now,
        },
      },
    },
    include: { variants: true },
  });
  const component = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: `${prefix}-component-product`,
      slug: `${prefix}-component-product`,
      name: "Private component",
      isPresent: false,
      isActive: false,
      syncedAt: now,
      variants: {
        create: {
          pancakeVariationId: `${prefix}-component-variation`,
          color: "Black",
          size: "M",
          isPresent: true,
          isActive: true,
          pancakeRetailPrice: 420_000,
          pancakeRetailPriceAfterDiscount: 420_000,
          syncedAt: now,
          warehouseStocks: {
            create: {
              pancakeWarehouseId: `${prefix}-component-warehouse`,
              quantity: 5,
              syncedAt: now,
            },
          },
        },
      },
    },
    include: { variants: true },
  });
  await prisma.compositeComponentMirror.create({
    data: {
      parentVariantId: parent.variants[0]!.id,
      componentVariantId: component.variants[0]!.id,
      quantity: 1,
      syncedAt: now,
    },
  });
  const cart = await prisma.cart.create({
    data: {
      expiresAt: new Date(now.getTime() + 60_000),
      items: { create: { variantId: component.variants[0]!.id, quantity: 1 } },
    },
  });
  const publicCode = `${prefix}-composite-order`;

  const result = await snapshot(cart.id, publicCode);
  assert.equal(result.ok, true);
  const persisted = await prisma.orderMirror.findUniqueOrThrow({
    where: { publicCode },
    include: { lines: true },
  });
  assert.equal(persisted.lines.length, 1);
  assert.equal(persisted.lines[0]!.variantId, component.variants[0]!.id);
  assert.equal(
    persisted.lines[0]!.pancakeVariationId,
    component.variants[0]!.pancakeVariationId,
  );
  assert.notEqual(persisted.lines[0]!.pancakeVariationId, parent.variants[0]!.pancakeVariationId);
  assert.equal(persisted.lines[0]!.baseUnitPriceVnd, BigInt(420_000));
  assert.equal(persisted.lines[0]!.unitPriceVnd, BigInt(420_000));
});

test("P8 unsigned browser quote facts alone cannot create a DRAFT or become price authority", async () => {
  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: `${prefix}-browser-product`,
      slug: `${prefix}-browser-product`,
      name: "Browser authority product",
      isPresent: true,
      isActive: true,
      syncedAt: now,
      variants: {
        create: {
          pancakeVariationId: `${prefix}-browser-variation`,
          color: "Black",
          size: "M",
          isPresent: true,
          isActive: true,
          pancakeRetailPrice: 500_000,
          pancakeRetailPriceAfterDiscount: 500_000,
          syncedAt: now,
          warehouseStocks: {
            create: {
              pancakeWarehouseId: `${prefix}-browser-warehouse`,
              quantity: 5,
              syncedAt: now,
            },
          },
        },
      },
    },
    include: { variants: true },
  });
  const cart = await prisma.cart.create({
    data: {
      expiresAt: new Date(now.getTime() + 60_000),
      items: { create: { variantId: product.variants[0]!.id, quantity: 1 } },
    },
  });
  const publicCode = `${prefix}-browser-only-order`;

  // Quote-shaped fields with no valid checkout input behind them cannot open a DRAFT at all.
  assert.deepEqual(
    await snapshot(cart.id, `${publicCode}-alone`, {
      items: [{ variantExternalId: product.variants[0]!.pancakeVariationId, quantity: 1, unitPriceVnd: 1 }],
      merchandiseSubtotalVnd: 1,
      shippingFeeVnd: 0,
      totalVnd: 1,
      promotionCampaignId: "forged",
    }),
    { ok: false, reason: "INVALID_INPUT" },
  );
  assert.equal(await prisma.orderMirror.count({ where: { publicCode: `${publicCode}-alone` } }), 0);

  // The load-bearing half: the same forged quote riding a *valid* checkout input is accepted as a
  // checkout, and still contributes nothing to money. A DRAFT that quoted the browser's 1 VND
  // instead of the server's 500,000 would pass the assertion above and fail this one.
  const result = await snapshot(cart.id, publicCode, {
    ...checkoutInput,
    items: [{ variantExternalId: product.variants[0]!.pancakeVariationId, quantity: 1, unitPriceVnd: 1 }],
    merchandiseSubtotalVnd: 1,
    shippingFeeVnd: 0,
    totalVnd: 1,
    unitPriceVnd: 1,
    promotionCampaignId: "forged",
    promotionName: "forged campaign",
    promotionPercentageValue: 99,
  });
  assert.equal(result.ok, true);

  const persisted = await prisma.orderMirror.findUniqueOrThrow({
    where: { publicCode },
    include: { lines: true },
  });
  assert.equal(persisted.merchandiseSubtotalVnd, BigInt(500_000));
  assert.equal(persisted.lines.length, 1);
  assert.equal(persisted.lines[0]!.unitPriceVnd, BigInt(500_000));
  assert.equal(persisted.lines[0]!.baseUnitPriceVnd, BigInt(500_000));
  assert.equal(persisted.lines[0]!.lineTotalVnd, BigInt(500_000));
  assert.equal(persisted.lines[0]!.promotionCampaignId, null);
  assert.equal(persisted.lines[0]!.promotionName, null);
  assert.equal(persisted.lines[0]!.promotionPercentageValue, null);
});

test("P8 a DRAFT whose shop scope no longer matches is rejected rather than stranding the cart", async () => {
  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: `${prefix}-scope-product`,
      slug: `${prefix}-scope-product`,
      name: "Shop scope product",
      isPresent: true,
      isActive: true,
      syncedAt: now,
      variants: {
        create: {
          pancakeVariationId: `${prefix}-scope-variation`,
          color: "Black",
          size: "M",
          isPresent: true,
          isActive: true,
          pancakeRetailPrice: 500_000,
          pancakeRetailPriceAfterDiscount: 500_000,
          syncedAt: now,
          warehouseStocks: {
            create: {
              pancakeWarehouseId: `${prefix}-scope-warehouse`,
              quantity: 5,
              syncedAt: now,
            },
          },
        },
      },
    },
    include: { variants: true },
  });
  const cart = await prisma.cart.create({
    data: {
      expiresAt: new Date(now.getTime() + 60_000),
      items: { create: { variantId: product.variants[0]!.id, quantity: 1 } },
    },
  });

  const stalePublicCode = `${prefix}-scope-stale-order`;
  assert.equal((await snapshot(cart.id, stalePublicCode)).ok, true);
  const stale = await prisma.orderMirror.findUniqueOrThrow({ where: { publicCode: stalePublicCode } });

  // The configured shop moves after the DRAFT was written. Stranded-checkout recovery never sweeps
  // DRAFT, so if this refresh merely failed, the cart could never check out again.
  await prisma.orderMirror.update({
    where: { id: stale.id },
    data: { pancakeShopId: shopId + 1 },
  });

  const freshPublicCode = `${prefix}-scope-fresh-order`;
  const retry = await snapshot(cart.id, freshPublicCode);
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.order.publicCode, freshPublicCode);
  assert.equal(retry.order.state, "DRAFT");

  const rejected = await prisma.orderMirror.findUniqueOrThrow({ where: { id: stale.id } });
  assert.equal(rejected.state, "REJECTED");
  assert.equal(rejected.syncErrorCode, "SHOP_SCOPE_UNVERIFIED");

  const fresh = await prisma.orderMirror.findUniqueOrThrow({
    where: { publicCode: freshPublicCode },
    include: { lines: true },
  });
  assert.notEqual(fresh.id, stale.id);
  assert.equal(fresh.pancakeShopId, shopId);
  assert.equal(fresh.lines.length, 1);
  assert.equal(fresh.lines[0]!.pancakeVariationId, product.variants[0]!.pancakeVariationId);
  assert.equal(
    await prisma.orderMirror.count({ where: { sourceCartId: cart.id, state: "DRAFT" } }),
    1,
    "exactly one active DRAFT must remain after the scope recovery",
  );
});
