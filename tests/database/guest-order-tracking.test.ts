import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createGuestOrderTrackingService } from "../../src/commerce/guest-order-tracking.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";
import { deleteOrdersWithCapacity } from "../support/order-cleanup.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const key = `guest-order-tracking-${process.pid}`;
const userId = `${key}-user`;

async function cleanup() {
  await deleteOrdersWithCapacity(prisma, { where: { publicCode: { startsWith: `${key}-` } } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

function completeSnapshot(phone: string) {
  return {
    checkoutSnapshottedAt: new Date(),
    guestName: "Tracking Fixture",
    guestPhone: phone,
    provinceRef: "tracking-province",
    districtRef: "tracking-district",
    communeRef: "tracking-commune",
    addressDetail: "Tracking fixture address",
    merchandiseSubtotalVnd: BigInt(100_000),
    shippingFeeVnd: BigInt(30_000),
    totalVnd: BigInt(130_000),
  };
}

test.beforeEach(cleanup);

test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test("guest order tracking requires code + phone and returns an allowlisted summary only", async () => {
  const publicCode = `${key}-confirmed`;
  await prisma.orderMirror.create({
    data: {
      publicCode,
      state: "CONFIRMED",
      guestName: "Sensitive Name",
      guestPhone: "0901234567",
      provinceRef: "province-sensitive",
      districtRef: "district-sensitive",
      communeRef: "commune-sensitive",
      addressDetail: "12 Sensitive Street",
      note: "Sensitive note",
      pancakeShopId: 920_007,
      pancakeOrderId: "9988776655",
      pancakeSystemId: "123456",
      pancakeStatus: 6,
      pancakeStatusUpdatedAt: "2026-08-13T00:00:00Z",
      checkoutSnapshottedAt: new Date("2026-08-13T00:00:00Z"),
      merchandiseSubtotalVnd: BigInt(500_000),
      shippingFeeVnd: BigInt(30_000),
      totalVnd: BigInt(530_000),
    },
  });

  const service = createGuestOrderTrackingService(prisma);
  const result = await service.lookup({ orderCode: publicCode, phone: " 0901234567 " });

  assert.deepEqual(result, {
    ok: true,
    order: {
      orderCode: publicCode,
      status: "CONFIRMED",
      createdAt: result.ok ? result.order.createdAt : "unreachable",
      totalVnd: "530000",
    },
  });
  assert.match(result.ok ? result.order.createdAt : "", /^\d{4}-\d{2}-\d{2}T/);

  const serialized = JSON.stringify(result);
  for (const secret of [
    "Sensitive Name",
    "0901234567",
    "Sensitive Street",
    "Sensitive note",
    "9988776655",
    "123456",
    "pancakeStatus",
    "syncErrorCode",
    "province-sensitive",
  ]) {
    assert.equal(serialized.includes(secret), false, `public result leaked ${secret}`);
  }
});

test("guest order tracking collapses wrong phone and nonexistent order to the same result", async () => {
  const publicCode = `${key}-proof`;
  await prisma.orderMirror.create({
    data: {
      publicCode,
      state: "CONFIRMED",
      ...completeSnapshot("0909999999"),
    },
  });

  const service = createGuestOrderTrackingService(prisma);
  const wrongPhone = await service.lookup({ orderCode: publicCode, phone: "0900000000" });
  const missingOrder = await service.lookup({
    orderCode: `${key}-missing`,
    phone: "0909999999",
  });

  assert.deepEqual(wrongPhone, { ok: false, reason: "NOT_FOUND" });
  assert.deepEqual(missingOrder, { ok: false, reason: "NOT_FOUND" });
});

test("guest order tracking excludes account-linked orders from the public guest capability", async () => {
  await prisma.user.create({
    data: {
      id: userId,
      name: "Account User",
      email: `${key}@example.com`,
      emailVerified: true,
      role: "CUSTOMER",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  const publicCode = `${key}-account`;
  await prisma.orderMirror.create({
    data: {
      publicCode,
      userId,
      state: "CONFIRMED",
      ...completeSnapshot("0908888888"),
    },
  });

  const service = createGuestOrderTrackingService(prisma);
  assert.deepEqual(await service.lookup({ orderCode: publicCode, phone: "0908888888" }), {
    ok: false,
    reason: "NOT_FOUND",
  });
});
