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
const now = new Date("2026-08-12T05:00:00.000Z");
const key = "checkout-concurrent-source-cart";
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
  await deleteOrdersWithCapacity(prisma, {
    where: { publicCode: { startsWith: `${key}-` } },
  });
  await prisma.cart.deleteMany({
    where: {
      items: {
        some: {
          variant: { pancakeVariationId: `${key}-variation` },
        },
      },
    },
  });
  await prisma.productMirror.deleteMany({
    where: { pancakeProductId: `${key}-product` },
  });
}

async function createCart() {
  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: `${key}-product`,
      slug: key,
      name: "Concurrent Checkout Product",
      isPresent: true,
      isActive: true,
      syncedAt: now,
      variants: {
        create: {
          pancakeVariationId: `${key}-variation`,
          color: "Black",
          size: "M",
          isPresent: true,
          isActive: true,
          pancakeRetailPrice: 500_000,
          pancakeRetailPriceAfterDiscount: 500_000,
          syncedAt: now,
          warehouseStocks: {
            create: {
              pancakeWarehouseId: `${key}-warehouse`,
              quantity: 2,
              syncedAt: now,
            },
          },
        },
      },
    },
    include: { variants: true },
  });

  return prisma.cart.create({
    data: {
      expiresAt: new Date(now.getTime() + 60_000),
      items: {
        create: {
          variantId: product.variants[0]!.id,
          quantity: 1,
        },
      },
    },
  });
}

test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test("concurrent checkout snapshots reuse one active order per cart and allow a new attempt after rejection", async () => {
  await cleanup();
  const cart = await createCart();
  const service = createGuestCheckoutSnapshotService(prisma, {
    checkoutInputValidated: true,
    verifyRenderedQuote: acceptAnyRenderedQuote,
  });
  const publicCodes = [`${key}-a`, `${key}-b`];

  const results = await Promise.all(
    publicCodes.map((publicCode) =>
      service.create({
        cartId: cart.id,
        shopId,
        publicCode,
        checkoutInput,
        now,
      }),
    ),
  );

  assert.equal(results.every((result) => result.ok), true);
  const returnedCodes = results.flatMap((result) => (result.ok ? [result.order.publicCode] : []));
  assert.equal(new Set(returnedCodes).size, 1);
  assert.equal(
    await prisma.orderMirror.count({ where: { publicCode: { in: publicCodes } } }),
    1,
  );

  const activePublicCode = returnedCodes[0]!;
  await prisma.orderMirror.update({
    where: { publicCode: activePublicCode },
    data: { state: "REJECTED", syncErrorCode: "PRICE_CHANGED" },
  });

  const retry = await service.create({
    cartId: cart.id,
    shopId,
    publicCode: `${key}-retry`,
    checkoutInput,
    now: new Date(now.getTime() + 1_000),
  });

  assert.equal(retry.ok, true);
  if (retry.ok) assert.equal(retry.order.publicCode, `${key}-retry`);
  assert.equal(
    await prisma.orderMirror.count({
      where: { publicCode: { startsWith: `${key}-` } },
    }),
    2,
  );
});
