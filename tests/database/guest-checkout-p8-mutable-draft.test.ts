import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import {
  createGuestCheckoutSnapshotService,
  requiresFreshGuestCheckoutSnapshot,
} from "../../src/commerce/guest-checkout-snapshot.ts";
import { acceptAnyRenderedQuote } from "../fixtures/rendered-quote-authority.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";
import { deleteOrdersWithCapacity } from "../support/order-cleanup.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const shopId = 920_007;
const now = new Date("2026-09-03T05:00:00.000Z");
const prefix = "u20-p8-mutable";

async function cleanup() {
  await deleteOrdersWithCapacity(prisma, { where: { publicCode: { startsWith: prefix } } });
  await prisma.cart.deleteMany({
    where: { items: { some: { variant: { pancakeVariationId: { startsWith: prefix } } } } },
  });
  await prisma.productMirror.deleteMany({ where: { pancakeProductId: { startsWith: prefix } } });
}

const inputA = {
  name: "Nguyễn Văn A",
  phone: "0901234567",
  provinceRef: "province-a",
  districtRef: "district-a",
  communeRef: "commune-a",
  detail: "12 Đường A",
  note: null,
};

const inputB = {
  ...inputA,
  name: "Nguyễn Văn B",
  phone: "0987654321",
  detail: "34 Đường B",
};

test.before(cleanup);
test.afterEach(cleanup);
test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test("P8 an ordinary DRAFT is refreshable in place until guarded finalization", async () => {
  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: `${prefix}-product`,
      slug: `${prefix}-product`,
      name: "Mutable draft product",
      isPresent: true,
      isActive: true,
      syncedAt: now,
      variants: {
        create: {
          pancakeVariationId: `${prefix}-variation`,
          color: "Black",
          size: "M",
          isPresent: true,
          isActive: true,
          pancakeRetailPrice: 500_000,
          pancakeRetailPriceAfterDiscount: 500_000,
          syncedAt: now,
          warehouseStocks: {
            create: {
              pancakeWarehouseId: `${prefix}-warehouse`,
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
  const service = createGuestCheckoutSnapshotService(prisma, { checkoutInputValidated: true, verifyRenderedQuote: acceptAnyRenderedQuote });
  const publicCode = `${prefix}-order`;

  const first = await service.create({ cartId: cart.id, shopId, publicCode, checkoutInput: inputA, now });
  assert.equal(first.ok, true);
  const before = await prisma.orderMirror.findUniqueOrThrow({ where: { publicCode } });
  assert.equal(before.state, "DRAFT");
  assert.equal(before.syncErrorCode, null);
  assert.equal(await requiresFreshGuestCheckoutSnapshot(prisma, cart.id), true);

  await prisma.cartItem.update({
    where: { cartId_variantId: { cartId: cart.id, variantId: product.variants[0]!.id } },
    data: { quantity: 2 },
  });

  const second = await service.create({
    cartId: cart.id,
    shopId,
    publicCode: `${prefix}-ignored-second-code`,
    checkoutInput: inputB,
    now: new Date(now.getTime() + 1_000),
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.order.publicCode, publicCode);

  const after = await prisma.orderMirror.findUniqueOrThrow({
    where: { publicCode },
    include: { lines: true },
  });
  assert.equal(after.id, before.id);
  assert.equal(after.state, "DRAFT");
  assert.equal(after.guestName, "Nguyễn Văn B");
  assert.equal(after.guestPhone, "0987654321");
  assert.equal(after.addressDetail, "34 Đường B");
  assert.equal(after.lines.length, 1);
  assert.equal(after.lines[0]!.quantity, 2);
  assert.equal(after.merchandiseSubtotalVnd, BigInt(1_000_000));
  assert.equal(await prisma.orderMirror.count({ where: { sourceCartId: cart.id } }), 1);
});
