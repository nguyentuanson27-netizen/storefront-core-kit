import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { readAdvisorySellableUnits } from "../../src/commerce/capacity-reservation-repository.ts";
import { createPancakeOrderSubmissionService } from "../../src/commerce/pancake-order-submit.ts";
import { SELLING_MODE_FLAGS_OFF } from "../../src/commerce/selling-policy.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";
import type { PancakeCatalogVariation } from "../../src/integrations/pancake/catalog-contract.ts";
import { deleteOrdersWithCapacity } from "../support/order-cleanup.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const shopId = 920_007;
const PREFIX = "order-capacity";
const syncedAt = new Date("2026-01-01T00:00:00.000Z");

test.after(async () => {
  await prisma.$disconnect();
});

async function cleanup() {
  await deleteOrdersWithCapacity(prisma, { where: { publicCode: { startsWith: PREFIX } } });
  await prisma.productMirror.deleteMany({ where: { pancakeProductId: { startsWith: PREFIX } } });
}

async function mirroredVariant(name: string, stock: number) {
  const id = `${PREFIX}-${name}`;
  const product = await prisma.productMirror.create({
    data: { pancakeShopId: 999_003, pancakeProductId: id, slug: id, name, syncedAt },
  });
  await prisma.variantMirror.create({
    data: { id, pancakeVariationId: id, productId: product.id, isPresent: true, isActive: true, syncedAt },
  });
  await prisma.warehouseStock.create({
    data: { variantId: id, pancakeWarehouseId: "w", quantity: stock, syncedAt },
  });
  return id;
}

function live(id: string, stock: number, price = 100_000): PancakeCatalogVariation {
  return {
    id,
    productId: `${id}-product`,
    displayId: `${id}-display`,
    barcode: `${id}-barcode`,
    fields: [],
    imageUrls: [],
    isHidden: false,
    isLocked: false,
    retailPrice: price,
    retailPriceAfterDiscount: price,
    product: { id: `${id}-product`, name: id },
    warehouseStocks: [{ warehouseId: "w", remainQuantity: stock }],
    sellableStock: stock,
  };
}

async function draft(name: string, variantId: string, quantity: number, price = 100_000) {
  const subtotal = price * quantity;
  const shippingFee = 30_000;
  return prisma.orderMirror.create({
    data: {
      publicCode: `${PREFIX}-${name}`,
      pancakeShopId: shopId,
      state: "DRAFT",
      checkoutSnapshottedAt: syncedAt,
      guestName: "Nguyễn Văn A",
      guestPhone: "0901234567",
      provinceRef: "province-01",
      districtRef: "district-001",
      communeRef: "commune-0001",
      addressDetail: "12 Đường A",
      merchandiseSubtotalVnd: BigInt(subtotal),
      shippingFeeVnd: BigInt(shippingFee),
      totalVnd: BigInt(subtotal + shippingFee),
      lines: {
        create: {
          variantId,
          pancakeVariationId: variantId,
          productName: variantId,
          size: "M",
          quantity,
          unitPriceVnd: BigInt(price),
          lineTotalVnd: BigInt(subtotal),
        },
      },
    },
  });
}

test("the hold is taken with the POS_SUBMITTING claim and accepted with CONFIRMED", async () => {
  await cleanup();
  const tee = await mirroredVariant("tee", 3);
  const order = await draft("confirmed", tee, 2);
  let reservationsAtPost = -1;
  const service = createPancakeOrderSubmissionService(prisma, {
    async fetchCompleteCatalog() {
      return [live(tee, 3)];
    },
    async createOrder() {
      reservationsAtPost = await prisma.capacityReservation.count({ where: { orderId: order.id } });
      return { id: 910_001 };
    },
  });

  const before = new Date();
  assert.deepEqual(await service.submit({ publicCode: order.publicCode, shopId }), {
    ok: true,
    state: "CONFIRMED",
    pancakeOrderId: "910001",
  });
  assert.equal(reservationsAtPost, 1, "no request leaves before its hold is committed");
  const reservation = await prisma.capacityReservation.findFirstOrThrow({ where: { orderId: order.id } });
  assert.ok(reservation.acceptedAt && reservation.acceptedAt >= before);
  // Confirmed but not yet reflected in the mirror: still held.
  assert.equal((await readAdvisorySellableUnits(prisma, [tee], SELLING_MODE_FLAGS_OFF)).get(tee), 1);
  await cleanup();
});

test("a second order the local ledger cannot cover is refused before any Pancake POST", async () => {
  await cleanup();
  const tee = await mirroredVariant("tee", 1);
  const first = await draft("first", tee, 1);
  const second = await draft("second", tee, 1);
  let posts = 0;
  const service = createPancakeOrderSubmissionService(prisma, {
    async fetchCompleteCatalog() {
      // Pancake still reports the unit: it is not a concurrency authority, the ledger is.
      return [live(tee, 1)];
    },
    async createOrder() {
      posts += 1;
      return { id: 910_100 + posts };
    },
  });

  assert.equal((await service.submit({ publicCode: first.publicCode, shopId })).ok, true);
  assert.deepEqual(await service.submit({ publicCode: second.publicCode, shopId }), {
    ok: false,
    state: "REJECTED",
    reason: "STOCK_UNAVAILABLE",
  });
  assert.equal(posts, 1);
  assert.equal(await prisma.capacityReservation.count({ where: { orderId: second.id } }), 0);
  await cleanup();
});

test("an ambiguous create keeps its hold and never records acceptance", async () => {
  await cleanup();
  const tee = await mirroredVariant("tee", 2);
  const order = await draft("unknown", tee, 1);
  const service = createPancakeOrderSubmissionService(prisma, {
    async fetchCompleteCatalog() {
      return [live(tee, 2)];
    },
    async createOrder() {
      throw new Error("socket hang up");
    },
  });

  assert.equal((await service.submit({ publicCode: order.publicCode, shopId })).state, "SYNC_UNKNOWN");
  const reservation = await prisma.capacityReservation.findFirstOrThrow({ where: { orderId: order.id } });
  assert.equal(reservation.acceptedAt, null);
  assert.equal((await readAdvisorySellableUnits(prisma, [tee], SELLING_MODE_FLAGS_OFF)).get(tee), 1);
  await cleanup();
});

test("an order that returns to DRAFT or is rejected before the POST holds nothing", async () => {
  await cleanup();
  const tee = await mirroredVariant("tee", 5);
  const repriced = await draft("repriced", tee, 1);
  const rejected = await draft("rejected", tee, 1);
  const service = (stock: number, price: number) =>
    createPancakeOrderSubmissionService(prisma, {
      async fetchCompleteCatalog() {
        return [live(tee, stock, price)];
      },
      async createOrder() {
        throw new Error("must not be called");
      },
    });

  assert.equal((await service(5, 120_000).submit({ publicCode: repriced.publicCode, shopId })).state, "DRAFT");
  assert.equal((await service(0, 100_000).submit({ publicCode: rejected.publicCode, shopId })).state, "REJECTED");
  assert.equal(
    await prisma.capacityReservation.count({ where: { orderId: { in: [repriced.id, rejected.id] } } }),
    0,
  );
  assert.equal((await readAdvisorySellableUnits(prisma, [tee], SELLING_MODE_FLAGS_OFF)).get(tee), 5);
  await cleanup();
});

test("a set line checks and reserves its components, not the parent's own Pancake stock", async () => {
  await cleanup();
  const top = await mirroredVariant("top", 1);
  const skirt = await mirroredVariant("skirt", 1);
  const set = await mirroredVariant("set", 0);
  await prisma.compositeComponentMirror.createMany({
    data: [
      { parentVariantId: set, componentVariantId: top, quantity: 1, syncedAt },
      { parentVariantId: set, componentVariantId: skirt, quantity: 1, syncedAt },
    ],
  });
  const first = await draft("set-first", set, 1);
  const second = await draft("set-second", set, 1);
  const service = createPancakeOrderSubmissionService(prisma, {
    async fetchCompleteCatalog() {
      // The parent itself reports zero; its components are what a set sale spends.
      return [live(set, 0), live(top, 1), live(skirt, 1)];
    },
    async createOrder() {
      return { id: 910_201 };
    },
  });

  assert.equal((await readAdvisorySellableUnits(prisma, [set], SELLING_MODE_FLAGS_OFF)).get(set), 1);
  assert.equal((await service.submit({ publicCode: first.publicCode, shopId })).ok, true);
  const resources = await prisma.capacityReservationResource.findMany({
    where: { reservation: { orderId: first.id } },
    orderBy: { variantId: "asc" },
    select: { variantId: true, quantity: true },
  });
  assert.deepEqual(resources, [
    { variantId: skirt, quantity: 1 },
    { variantId: top, quantity: 1 },
  ]);
  assert.equal((await readAdvisorySellableUnits(prisma, [set], SELLING_MODE_FLAGS_OFF)).get(set), 0);
  assert.equal((await service.submit({ publicCode: second.publicCode, shopId })).state, "REJECTED");
  await cleanup();
});

test("a checkout that lands during a catalog sync waits for it instead of failing", async () => {
  await cleanup();
  const tee = await mirroredVariant("tee", 3);
  const order = await draft("during-sync", tee, 1);
  const service = createPancakeOrderSubmissionService(prisma, {
    async fetchCompleteCatalog() {
      return [live(tee, 3)];
    },
    async createOrder() {
      return { id: 910_301 };
    },
  });

  // Stand-in for a sync transaction: it has written this variant and holds the row until it commits,
  // for longer than Prisma's default 5s interactive-transaction budget. The draft carries no base
  // price, so submission also writes the fresher Pancake price back to this row before reserving:
  // both mirror-writing transactions have to wait the sync out.
  let signalLocked!: () => void;
  const locked = new Promise<void>((resolve) => (signalLocked = resolve));
  const sync = prisma.$transaction(
    async (tx) => {
      await tx.variantMirror.update({ where: { id: tee }, data: { syncedAt: new Date() } });
      signalLocked();
      await new Promise((resolve) => setTimeout(resolve, 7_000));
    },
    { timeout: 20_000 },
  );
  await locked;

  assert.deepEqual(await service.submit({ publicCode: order.publicCode, shopId }), {
    ok: true,
    state: "CONFIRMED",
    pancakeOrderId: "910301",
  });
  await sync;
  assert.equal(await prisma.capacityReservation.count({ where: { orderId: order.id } }), 1);
  await cleanup();
});
