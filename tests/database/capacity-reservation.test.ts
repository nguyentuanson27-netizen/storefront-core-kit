import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import {
  handOffMirroredCapacity,
  markOrderCapacityAccepted,
  readAdvisorySellableUnits,
  reserveOrderCapacity,
} from "../../src/commerce/capacity-reservation-repository.ts";
import { SELLING_MODE_FLAGS_OFF } from "../../src/commerce/selling-policy.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";
import { deleteOrdersWithCapacity } from "../support/order-cleanup.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const SHOP_ID = 999_002;
const EARLY = new Date("2026-01-01T00:00:00.000Z");

test.after(async () => {
  await prisma.$disconnect();
});

/** One isolated catalog + order namespace per test, torn down in dependency order. */
function fixture(key: string) {
  const prefix = `capacity-${key}`;

  async function cleanup() {
    await deleteOrdersWithCapacity(prisma, { where: { publicCode: { startsWith: prefix } } });
    await prisma.productMirror.deleteMany({ where: { pancakeProductId: { startsWith: prefix } } });
  }

  async function variant(name: string, stock: number | number[], { syncedAt = EARLY } = {}) {
    const id = `${prefix}-${name}`;
    const product = await prisma.productMirror.create({
      data: {
        pancakeShopId: SHOP_ID,
        pancakeProductId: id,
        slug: id,
        name,
        syncedAt,
      },
    });
    await prisma.variantMirror.create({
      data: { id, pancakeVariationId: id, productId: product.id, isPresent: true, isActive: true, syncedAt },
    });
    const stocks = Array.isArray(stock) ? stock : [stock];
    await prisma.warehouseStock.createMany({
      data: stocks.map((quantity, index) => ({
        variantId: id,
        pancakeWarehouseId: `w${index}`,
        quantity,
        syncedAt,
      })),
    });
    return id;
  }

  async function edge(parentVariantId: string, componentVariantId: string, quantity: number) {
    await prisma.compositeComponentMirror.create({
      data: { parentVariantId, componentVariantId, quantity, syncedAt: EARLY },
    });
  }

  async function order(name: string) {
    const created = await prisma.orderMirror.create({ data: { publicCode: `${prefix}-${name}` } });
    return created.id;
  }

  function reserve(orderId: string, lines: Array<{ variantId: string; quantity: number }>) {
    return prisma.$transaction((tx) => reserveOrderCapacity(tx, { orderId, lines, sellingModeFlags: SELLING_MODE_FLAGS_OFF }));
  }

  /** A catalog sync's stock observation: new quantity, stamped with the instant its read started. */
  async function observe(variantId: string, quantity: number, observationStartedAt: Date) {
    await prisma.$transaction(async (tx) => {
      await tx.variantMirror.update({ where: { id: variantId }, data: { syncedAt: observationStartedAt } });
      await tx.warehouseStock.updateMany({ where: { variantId }, data: { quantity, syncedAt: observationStartedAt } });
      await handOffMirroredCapacity(tx, new Date());
    });
  }

  async function accept(orderId: string, acceptedAt: Date) {
    await prisma.$transaction((tx) => markOrderCapacityAccepted(tx, orderId, acceptedAt));
  }

  async function available(variantId: string) {
    return (await readAdvisorySellableUnits(prisma, [variantId])).get(variantId);
  }

  return { cleanup, variant, edge, order, reserve, observe, accept, available };
}

test("last unit: two concurrent buyers cannot both spend the same standalone unit", async () => {
  const f = fixture("last-unit");
  await f.cleanup();
  const tee = await f.variant("tee", 1);
  const first = await f.order("first");
  const second = await f.order("second");

  let releaseFirst!: () => void;
  const firstMayCommit = new Promise<void>((resolve) => (releaseFirst = resolve));
  let signalFirstReserved!: () => void;
  const firstReserved = new Promise<void>((resolve) => (signalFirstReserved = resolve));

  const firstTx = prisma.$transaction(
    async (tx) => {
      const result = await reserveOrderCapacity(tx, { orderId: first, lines: [{ variantId: tee, quantity: 1 }], sellingModeFlags: SELLING_MODE_FLAGS_OFF });
      signalFirstReserved();
      await firstMayCommit;
      return result;
    },
    { timeout: 20_000 },
  );
  await firstReserved;

  let secondSettled = false;
  const secondTx = prisma
    .$transaction((tx) => reserveOrderCapacity(tx, { orderId: second, lines: [{ variantId: tee, quantity: 1 }], sellingModeFlags: SELLING_MODE_FLAGS_OFF }), {
      timeout: 20_000,
    })
    .finally(() => (secondSettled = true));

  // The second buyer is blocked on the variant row lock even though the ledger was empty.
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(secondSettled, false);

  releaseFirst();
  assert.deepEqual(await firstTx, { ok: true, created: true });
  assert.deepEqual(await secondTx, { ok: false, reason: "INSUFFICIENT_CAPACITY", variantId: tee });
  assert.equal(await prisma.capacityReservation.count({ where: { orderId: second } }), 0);
  await f.cleanup();
});

test("shared child: two different sets and a direct sale all contend on one resource", async () => {
  const f = fixture("shared-child");
  await f.cleanup();
  const child = await f.variant("child", 2);
  const setA = await f.variant("set-a", 50);
  const setB = await f.variant("set-b", 50);
  await f.edge(setA, child, 1);
  await f.edge(setB, child, 1);

  const results = await Promise.all([
    f.reserve(await f.order("a"), [{ variantId: setA, quantity: 1 }]),
    f.reserve(await f.order("b"), [{ variantId: setB, quantity: 1 }]),
    f.reserve(await f.order("direct"), [{ variantId: child, quantity: 1 }]),
  ]);
  // Two units of the child exist; the sets' own 50-unit mirrors are never spent.
  assert.equal(results.filter((result) => result.ok).length, 2);
  assert.equal(results.filter((result) => !result.ok).length, 1);
  assert.equal(
    await prisma.capacityReservationResource.aggregate({ where: { variantId: child }, _sum: { quantity: true } }).then(
      ({ _sum }) => _sum.quantity,
    ),
    2,
  );
  assert.equal(await prisma.capacityReservationResource.count({ where: { variantId: { in: [setA, setB] } } }), 0);
  assert.equal(await f.available(setA), 0);
  await f.cleanup();
});

test("edge quantity above 1 multiplies the consumed resource", async () => {
  const f = fixture("multiplier");
  await f.cleanup();
  const sock = await f.variant("sock", 5);
  const pack = await f.variant("pack", 99);
  await f.edge(pack, sock, 2);

  assert.equal(await f.available(pack), 2);
  assert.deepEqual(await f.reserve(await f.order("one"), [{ variantId: pack, quantity: 2 }]), { ok: true, created: true });
  const resource = await prisma.capacityReservationResource.findFirstOrThrow({ where: { variantId: sock } });
  assert.deepEqual(
    { kind: resource.kind, unitsPerLine: resource.unitsPerLine, quantity: resource.quantity },
    { kind: "COMPONENT", unitsPerLine: 2, quantity: 4 },
  );
  // One sock left: not enough for another pair.
  assert.equal(await f.available(pack), 0);
  assert.equal((await f.reserve(await f.order("two"), [{ variantId: pack, quantity: 1 }])).ok, false);
  assert.equal(await f.available(sock), 1);
  await f.cleanup();
});

test("a multi-component refusal is all-or-none", async () => {
  const f = fixture("all-or-none");
  await f.cleanup();
  const top = await f.variant("top", 5);
  const skirt = await f.variant("skirt", 0);
  const set = await f.variant("set", 5);
  const extra = await f.variant("extra", 5);
  await f.edge(set, top, 1);
  await f.edge(set, skirt, 1);
  const orderId = await f.order("refused");

  assert.deepEqual(
    await f.reserve(orderId, [
      { variantId: extra, quantity: 1 },
      { variantId: set, quantity: 1 },
    ]),
    { ok: false, reason: "INSUFFICIENT_CAPACITY", variantId: skirt },
  );
  assert.equal(await prisma.capacityReservation.count({ where: { orderId } }), 0);
  assert.equal(await prisma.capacityReservationResource.count({ where: { variantId: { in: [top, skirt, extra] } } }), 0);
  await f.cleanup();
});

test("duplicate purchased lines merge into one reservation before evaluation", async () => {
  const f = fixture("duplicates");
  await f.cleanup();
  const tee = await f.variant("tee", 3);
  const orderId = await f.order("dup");
  assert.equal(
    (await f.reserve(orderId, [
      { variantId: tee, quantity: 2 },
      { variantId: tee, quantity: 2 },
    ])).ok,
    false,
  );
  assert.deepEqual(
    await f.reserve(orderId, [
      { variantId: tee, quantity: 1 },
      { variantId: tee, quantity: 2 },
    ]),
    { ok: true, created: true },
  );
  const reservations = await prisma.capacityReservation.findMany({ where: { orderId } });
  assert.equal(reservations.length, 1);
  assert.equal(reservations[0].quantity, 3);
  await f.cleanup();
});

test("invalid or untrusted topology and stock fail closed", async () => {
  const f = fixture("fail-closed");
  await f.cleanup();
  const leaf = await f.variant("leaf", 9);
  const inner = await f.variant("inner", 9);
  const outer = await f.variant("outer", 9);
  await f.edge(inner, leaf, 1);
  await f.edge(outer, inner, 1);
  assert.deepEqual(await f.reserve(await f.order("nested"), [{ variantId: outer, quantity: 1 }]), {
    ok: false,
    reason: "TOPOLOGY_UNPROVEN",
    variantId: outer,
  });
  assert.equal(await f.available(outer), 0);

  assert.deepEqual(await f.reserve(await f.order("missing"), [{ variantId: `${leaf}-nope`, quantity: 1 }]), {
    ok: false,
    reason: "VARIANT_MISSING",
    variantId: `${leaf}-nope`,
  });

  const gone = await f.variant("gone", 9);
  const set = await f.variant("set", 9);
  await f.edge(set, gone, 1);
  await prisma.variantMirror.update({ where: { id: gone }, data: { isPresent: false } });
  assert.equal((await f.reserve(await f.order("absent-component"), [{ variantId: set, quantity: 1 }])).ok, false);

  const nan = await f.variant("nan", 9);
  await prisma.$executeRaw`UPDATE "WarehouseStock" SET "quantity" = 'NaN'::float8 WHERE "variantId" = ${nan}`;
  assert.equal((await f.reserve(await f.order("nan"), [{ variantId: nan, quantity: 1 }])).ok, false);
  assert.equal(await f.available(nan), 0);

  const fractional = await f.variant("fractional", [0.6, 0.6]);
  assert.equal(await f.available(fractional), 1);
  assert.equal((await f.reserve(await f.order("frac-2"), [{ variantId: fractional, quantity: 2 }])).ok, false);
  assert.equal((await f.reserve(await f.order("frac-1"), [{ variantId: fractional, quantity: 1 }])).ok, true);
  await f.cleanup();
});

test("an idempotent retry does not double-reserve, and later topology changes do not move a hold", async () => {
  const f = fixture("idempotent");
  await f.cleanup();
  const top = await f.variant("top", 4);
  const alt = await f.variant("alt", 4);
  const set = await f.variant("set", 4);
  await f.edge(set, top, 1);
  const orderId = await f.order("retry");

  assert.deepEqual(await f.reserve(orderId, [{ variantId: set, quantity: 1 }]), { ok: true, created: true });
  // A sync replaces the set's component: the existing hold stays on what the sale consumed.
  await prisma.compositeComponentMirror.deleteMany({ where: { parentVariantId: set } });
  await f.edge(set, alt, 1);
  assert.deepEqual(await f.reserve(orderId, [{ variantId: set, quantity: 1 }]), { ok: true, created: false });

  const resources = await prisma.capacityReservationResource.findMany({
    where: { reservation: { orderId } },
    select: { variantId: true, quantity: true },
  });
  assert.deepEqual(resources, [{ variantId: top, quantity: 1 }]);
  assert.equal(await f.available(top), 3);
  assert.equal(await f.available(alt), 4);
  await f.cleanup();
});

test("confirmed before stock sync: CONFIRMED keeps the hold until a later observation reflects it", async () => {
  const f = fixture("confirmed-first");
  await f.cleanup();
  const tee = await f.variant("tee", 10);
  const orderId = await f.order("sale");
  assert.ok((await f.reserve(orderId, [{ variantId: tee, quantity: 2 }])).ok);
  assert.equal(await f.available(tee), 8);

  const acceptedAt = new Date("2026-03-01T10:00:00.000Z");
  await f.accept(orderId, acceptedAt);
  // Confirmation alone releases nothing: no intermediate capacity of 10.
  await prisma.$transaction((tx) => handOffMirroredCapacity(tx, new Date()));
  assert.equal(await f.available(tee), 8);

  await f.observe(tee, 8, new Date("2026-03-01T10:00:05.000Z"));
  assert.equal(await f.available(tee), 8);
  const resource = await prisma.capacityReservationResource.findFirstOrThrow({ where: { variantId: tee } });
  assert.deepEqual(resource.mirrorObservationStartedAt, new Date("2026-03-01T10:00:05.000Z"));
  assert.ok(resource.mirroredAt);
  // History stays: the row is kept after it stops counting.
  assert.equal(await prisma.capacityReservation.count({ where: { orderId } }), 1);
  await f.cleanup();
});

test("stock reflected before hold retirement: a read that started before acceptance is not proof", async () => {
  const f = fixture("reflected-first");
  await f.cleanup();
  const tee = await f.variant("tee", 10);
  const orderId = await f.order("sale");
  assert.ok((await f.reserve(orderId, [{ variantId: tee, quantity: 2 }])).ok);
  const acceptedAt = new Date("2026-03-02T10:00:00.000Z");

  // Pancake had already decremented, and a sync stored 8, but its read started before we knew the
  // order existed. Until a causally later read, the hold stays: conservative under-capacity.
  await f.observe(tee, 8, new Date("2026-03-02T09:59:59.000Z"));
  await f.accept(orderId, acceptedAt);
  await prisma.$transaction((tx) => handOffMirroredCapacity(tx, new Date()));
  assert.equal(await f.available(tee), 6);

  await f.observe(tee, 8, new Date("2026-03-02T10:01:00.000Z"));
  assert.equal(await f.available(tee), 8);
  await f.cleanup();
});

test("repeated handoff of the same evidence is idempotent", async () => {
  const f = fixture("idempotent-handoff");
  await f.cleanup();
  const tee = await f.variant("tee", 5);
  const orderId = await f.order("sale");
  assert.ok((await f.reserve(orderId, [{ variantId: tee, quantity: 1 }])).ok);
  await f.accept(orderId, new Date("2026-03-03T10:00:00.000Z"));
  await f.observe(tee, 4, new Date("2026-03-03T10:00:01.000Z"));
  const first = await prisma.capacityReservationResource.findFirstOrThrow({ where: { variantId: tee } });

  assert.equal(await prisma.$transaction((tx) => handOffMirroredCapacity(tx, new Date())), 0);
  await f.observe(tee, 4, new Date("2026-03-03T10:05:00.000Z"));
  const again = await prisma.capacityReservationResource.findFirstOrThrow({ where: { variantId: tee } });
  assert.deepEqual(again, first);
  assert.equal(await f.available(tee), 4);
  // Accepting twice does not move the causal bound either.
  await f.accept(orderId, new Date("2026-03-04T00:00:00.000Z"));
  assert.deepEqual(
    (await prisma.capacityReservation.findFirstOrThrow({ where: { orderId } })).acceptedAt,
    new Date("2026-03-03T10:00:00.000Z"),
  );
  await f.cleanup();
});

test("unknown outcome and delta-only evidence never retire a hold", async () => {
  const f = fixture("no-evidence");
  await f.cleanup();
  const tee = await f.variant("tee", 10);
  const unknown = await f.order("unknown");
  assert.ok((await f.reserve(unknown, [{ variantId: tee, quantity: 2 }])).ok);

  // No acceptance was ever proven: a later read, even one whose drop matches the hold exactly, is
  // just a stock delta and says nothing about which order caused it.
  await f.observe(tee, 8, new Date("2026-03-05T10:00:00.000Z"));
  await f.observe(tee, 8, new Date("2026-03-06T10:00:00.000Z"));
  assert.equal(await f.available(tee), 6);
  assert.equal(await prisma.capacityReservationResource.count({ where: { variantId: tee, mirroredAt: { not: null } } }), 0);
  await f.cleanup();
});

test("a component consumed more than once per set keeps its hold until that evidence exists", async () => {
  const f = fixture("unevidenced-multiplier");
  await f.cleanup();
  const sock = await f.variant("sock", 10);
  const single = await f.variant("single", 10);
  const pack = await f.variant("pack", 99);
  await f.edge(pack, sock, 2);
  await f.edge(pack, single, 1);
  const orderId = await f.order("sale");
  assert.ok((await f.reserve(orderId, [{ variantId: pack, quantity: 1 }])).ok);
  await f.accept(orderId, new Date("2026-03-07T10:00:00.000Z"));
  await f.observe(sock, 8, new Date("2026-03-07T10:00:01.000Z"));
  await f.observe(single, 9, new Date("2026-03-07T10:00:01.000Z"));

  assert.equal(await f.available(single), 9);
  assert.equal(await f.available(sock), 6);
  await f.cleanup();
});

test("ledger rows cannot be deleted out from under a live hold", async () => {
  const f = fixture("restrict");
  await f.cleanup();
  const tee = await f.variant("tee", 3);
  const orderId = await f.order("sale");
  assert.ok((await f.reserve(orderId, [{ variantId: tee, quantity: 1 }])).ok);
  await assert.rejects(() => prisma.orderMirror.delete({ where: { id: orderId } }));
  await assert.rejects(() => prisma.variantMirror.delete({ where: { id: tee } }));
  await assert.rejects(
    () => prisma.$executeRaw`UPDATE "CapacityReservationResource" SET "mirroredAt" = now() WHERE "variantId" = ${tee}`,
  );
  await f.cleanup();
});
