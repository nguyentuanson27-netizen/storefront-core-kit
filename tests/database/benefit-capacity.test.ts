import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { aggregateBenefitCapacityDemand } from "../../src/commerce/benefit-capacity-demand.ts";
import {
  readAdvisorySellableUnits,
  reserveOrderCapacity,
} from "../../src/commerce/capacity-reservation-repository.ts";
import { SELLING_MODE_FLAGS_OFF } from "../../src/commerce/selling-policy.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";
import { deleteOrdersWithCapacity } from "../support/order-cleanup.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const SHOP_ID = 999_003;
const EARLY = new Date("2026-01-01T00:00:00.000Z");

test.after(async () => {
  await prisma.$disconnect();
});

/** One isolated catalog + order namespace per test. Mirrors capacity-reservation.test.ts. */
function fixture(key: string) {
  const prefix = `benefit-capacity-${key}`;

  async function cleanup() {
    await deleteOrdersWithCapacity(prisma, { where: { publicCode: { startsWith: prefix } } });
    await prisma.productMirror.deleteMany({ where: { pancakeProductId: { startsWith: prefix } } });
  }

  async function variant(name: string, stock: number) {
    const id = `${prefix}-${name}`;
    const product = await prisma.productMirror.create({
      data: { pancakeShopId: SHOP_ID, pancakeProductId: id, slug: id, name, syncedAt: EARLY },
    });
    await prisma.variantMirror.create({
      data: { id, pancakeVariationId: id, productId: product.id, isPresent: true, isActive: true, syncedAt: EARLY },
    });
    await prisma.warehouseStock.create({
      data: { variantId: id, pancakeWarehouseId: "w0", quantity: stock, syncedAt: EARLY },
    });
    return id;
  }

  async function order(name: string) {
    return (await prisma.orderMirror.create({ data: { publicCode: `${prefix}-${name}` } })).id;
  }

  function reserve(orderId: string, lines: Parameters<typeof aggregateBenefitCapacityDemand>[0]) {
    return prisma.$transaction((tx) =>
      reserveOrderCapacity(tx, {
        orderId,
        lines: aggregateBenefitCapacityDemand(lines),
        sellingModeFlags: SELLING_MODE_FLAGS_OFF,
      }),
    );
  }

  async function available(variantId: string) {
    return (await readAdvisorySellableUnits(prisma, [variantId], SELLING_MODE_FLAGS_OFF)).get(variantId);
  }

  return { cleanup, variant, order, reserve, available };
}

test("A03 PAID X x1 + GIFT X x1 holds quantity 2 in one order/variant reservation", async () => {
  const f = fixture("pair");
  await f.cleanup();
  const x = await f.variant("x", 2);
  const orderId = await f.order("pair");

  assert.deepEqual(
    await f.reserve(orderId, [
      { role: "PAID", variantId: x, quantity: 1 },
      { role: "GIFT", variantId: x, quantity: 1 },
    ]),
    { ok: true, created: true },
  );

  const rows = await prisma.capacityReservation.findMany({ where: { orderId } });
  assert.equal(rows.length, 1, "one row per order and variant");
  assert.equal(rows[0]!.quantity, 2, "the gift unit is held, not forgotten");
  const resources = await prisma.capacityReservationResource.findMany({ where: { reservationId: rows[0]!.id } });
  assert.equal(resources.reduce((sum, resource) => sum + resource.quantity, 0), 2);
  assert.equal(await f.available(x), 0);
  await f.cleanup();
});

test("A03 stock 1 refuses PAID X + GIFT X atomically, including the other lines", async () => {
  const f = fixture("short");
  await f.cleanup();
  const x = await f.variant("x", 1);
  const y = await f.variant("y", 5);
  const orderId = await f.order("short");

  const result = await f.reserve(orderId, [
    { role: "PAID", variantId: y, quantity: 1 },
    { role: "PAID", variantId: x, quantity: 1 },
    { role: "GIFT", variantId: x, quantity: 1 },
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "INSUFFICIENT_CAPACITY");
  assert.equal(await prisma.capacityReservation.count({ where: { orderId } }), 0, "all or none");
  assert.equal(await f.available(y), 5, "the unaffected line holds nothing either");
  await f.cleanup();
});

test("A03 a gift of a different variant is held on its own variant", async () => {
  const f = fixture("other-gift");
  await f.cleanup();
  const paid = await f.variant("paid", 1);
  const gift = await f.variant("gift", 1);
  const orderId = await f.order("other");

  assert.deepEqual(
    await f.reserve(orderId, [
      { role: "PAID", variantId: paid, quantity: 1 },
      { role: "GIFT", variantId: gift, quantity: 1 },
    ]),
    { ok: true, created: true },
  );
  assert.equal(await f.available(paid), 0);
  assert.equal(await f.available(gift), 0);
  await f.cleanup();
});

test("A03 two concurrent checkouts of PAID X + GIFT X on stock 2: exactly one wins", async () => {
  const f = fixture("race");
  await f.cleanup();
  const x = await f.variant("x", 2);
  const first = await f.order("a");
  const second = await f.order("b");
  const lines = [
    { role: "PAID" as const, variantId: x, quantity: 1 },
    { role: "GIFT" as const, variantId: x, quantity: 1 },
  ];

  const results = await Promise.all([f.reserve(first, lines), f.reserve(second, lines)]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(
    (await prisma.capacityReservation.findMany({ where: { variantId: x } })).reduce((sum, row) => sum + row.quantity, 0),
    2,
    "never more than the stock is held",
  );
  await f.cleanup();
});

test("A03 an idempotent retry of the same order does not double-hold", async () => {
  const f = fixture("retry");
  await f.cleanup();
  const x = await f.variant("x", 4);
  const orderId = await f.order("retry");
  const lines = [
    { role: "PAID" as const, variantId: x, quantity: 1 },
    { role: "GIFT" as const, variantId: x, quantity: 1 },
  ];

  assert.deepEqual(await f.reserve(orderId, lines), { ok: true, created: true });
  assert.deepEqual(await f.reserve(orderId, lines), { ok: true, created: false });
  const rows = await prisma.capacityReservation.findMany({ where: { orderId } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.quantity, 2);
  assert.equal(await f.available(x), 2);
  await f.cleanup();
});
