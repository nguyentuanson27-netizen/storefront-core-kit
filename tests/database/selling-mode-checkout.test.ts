import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import {
  handOffMirroredCapacity,
  markOrderCapacityAccepted,
  reserveOrderCapacity,
} from "../../src/commerce/capacity-reservation-repository.ts";
import { SELLING_MODE_FLAGS_OFF, type SellingModeFlags } from "../../src/commerce/selling-policy.ts";
import { createSellingPolicyRepository } from "../../src/commerce/selling-policy-repository.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";
import { deleteOrdersWithCapacity } from "../support/order-cleanup.ts";

/** Selling modes spec §7.1–§7.4 and §12 "Database": the locked checkout decision under a floor. */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const repository = createSellingPolicyRepository(prisma);
const SHOP_ID = 999_041;
const EARLY = new Date("2026-01-01T00:00:00.000Z");
const ON: SellingModeFlags = { sellingModesEnabled: true, preorderEnabled: true };

test.after(async () => {
  await prisma.$disconnect();
});

function fixture(key: string) {
  const prefix = `selling-checkout-${key}`;

  async function cleanup() {
    await deleteOrdersWithCapacity(prisma, { where: { publicCode: { startsWith: prefix } } });
    await prisma.productMirror.deleteMany({ where: { pancakeProductId: { startsWith: prefix } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
  }

  /** One product per call; returns its product id and the ids of its variants, in the given stock order. */
  async function product(name: string, stocks: number[]) {
    const productKey = `${prefix}-${name}`;
    const created = await prisma.productMirror.create({
      data: { pancakeShopId: SHOP_ID, pancakeProductId: productKey, slug: productKey, name, syncedAt: EARLY },
    });
    const variantIds: string[] = [];
    for (const [index, quantity] of stocks.entries()) {
      const id = `${productKey}-v${index}`;
      await prisma.variantMirror.create({
        data: { id, pancakeVariationId: id, productId: created.id, isPresent: true, isActive: true, syncedAt: EARLY },
      });
      await prisma.warehouseStock.create({ data: { variantId: id, pancakeWarehouseId: "w", quantity, syncedAt: EARLY } });
      variantIds.push(id);
    }
    return { productId: created.id, variantIds };
  }

  async function actor() {
    const id = `${prefix}-owner`;
    const now = new Date();
    await prisma.user.upsert({
      where: { id },
      create: { id, name: "owner", email: `${id}@example.test`, emailVerified: true, role: "ADMIN", createdAt: now, updatedAt: now },
      update: {},
    });
    return id;
  }

  async function policy(productId: string, sellingMode: "STANDARD" | "OVERSELL" | "PREORDER", negativeStockLimit = -20) {
    await repository.saveSellingPolicy(productId, { kind: "SET", sellingMode, negativeStockLimit }, await actor());
  }

  async function order(name: string) {
    return (await prisma.orderMirror.create({ data: { publicCode: `${prefix}-${name}` } })).id;
  }

  function reserve(orderId: string, lines: { variantId: string; quantity: number }[], sellingModeFlags = ON) {
    return prisma.$transaction((tx) => reserveOrderCapacity(tx, { orderId, lines, sellingModeFlags }));
  }

  async function stock(variantId: string) {
    return (await prisma.warehouseStock.findMany({ where: { variantId } })).map(({ quantity }) => quantity);
  }

  return { cleanup, product, policy, order, reserve, stock };
}

test("OVERSELL sells below zero down to its limit and then refuses NEGATIVE_LIMIT_REACHED", async (t) => {
  const f = fixture("limit");
  await f.cleanup();
  t.after(f.cleanup);
  const { productId, variantIds: [tee] } = await f.product("tee", [-18]);
  await f.policy(productId, "OVERSELL", -20);

  assert.deepEqual(await f.reserve(await f.order("a"), [{ variantId: tee, quantity: 1 }]), { ok: true, created: true });
  assert.deepEqual(await f.reserve(await f.order("b"), [{ variantId: tee, quantity: 1 }]), { ok: true, created: true });
  assert.deepEqual(await f.reserve(await f.order("c"), [{ variantId: tee, quantity: 1 }]), {
    ok: false,
    reason: "NEGATIVE_LIMIT_REACHED",
    variantId: tee,
  });
});

test("with SELLING_MODES_ENABLED off an OVERSELL row checks out exactly as STANDARD", async (t) => {
  const f = fixture("flag-off");
  await f.cleanup();
  t.after(f.cleanup);
  const { productId, variantIds: [tee] } = await f.product("tee", [0]);
  await f.policy(productId, "OVERSELL", -20);

  assert.deepEqual(await f.reserve(await f.order("off"), [{ variantId: tee, quantity: 1 }], SELLING_MODE_FLAGS_OFF), {
    ok: false,
    reason: "INSUFFICIENT_CAPACITY",
    variantId: tee,
  });
  // A PREORDER row with only the capability on is STANDARD too.
  await f.policy(productId, "PREORDER", -20);
  assert.equal(
    (await f.reserve(await f.order("preorder-off"), [{ variantId: tee, quantity: 1 }], { sellingModesEnabled: true, preorderEnabled: false })).ok,
    false,
  );
  assert.equal((await f.reserve(await f.order("preorder-on"), [{ variantId: tee, quantity: 1 }])).ok, true);
});

test("two buyers for the last oversell unit (−19 → −20): exactly one succeeds", async (t) => {
  const f = fixture("race");
  await f.cleanup();
  t.after(f.cleanup);
  const { productId, variantIds: [tee] } = await f.product("tee", [-19]);
  await f.policy(productId, "OVERSELL", -20);
  const [first, second] = [await f.order("first"), await f.order("second")];

  const results = await Promise.all([
    f.reserve(first, [{ variantId: tee, quantity: 1 }]),
    f.reserve(second, [{ variantId: tee, quantity: 1 }]),
  ]);
  assert.deepEqual(results.map(({ ok }) => ok).sort(), [false, true]);
  const refused = results.find((result) => !result.ok);
  assert.equal(refused && !refused.ok ? refused.reason : null, "NEGATIVE_LIMIT_REACHED");
  assert.equal(await prisma.capacityReservation.count({ where: { orderId: { in: [first, second] } } }), 1);
});

test("OVERSELL → STANDARD while stock is negative: unpurchasable, and the stock is left as it was", async (t) => {
  const f = fixture("back-to-standard");
  await f.cleanup();
  t.after(f.cleanup);
  const { productId, variantIds: [tee] } = await f.product("tee", [-4]);
  await f.policy(productId, "OVERSELL", -20);
  assert.equal((await f.reserve(await f.order("before"), [{ variantId: tee, quantity: 1 }])).ok, true);

  await f.policy(productId, "STANDARD", -20);
  assert.deepEqual(await f.reserve(await f.order("after"), [{ variantId: tee, quantity: 1 }]), {
    ok: false,
    reason: "INSUFFICIENT_CAPACITY",
    variantId: tee,
  });
  assert.deepEqual(await f.stock(tee), [-4]);
  assert.equal(await prisma.capacityReservation.count({ where: { variantId: tee } }), 1, "the earlier hold is untouched");
});

test("a set never drives an OVERSELL component below zero; a direct sale of it still may", async (t) => {
  const f = fixture("component");
  await f.cleanup();
  t.after(f.cleanup);
  const top = await f.product("top", [3]);
  const skirt = await f.product("skirt", [0]);
  const set = await f.product("set", [9]);
  await f.policy(skirt.productId, "OVERSELL", -20);
  await prisma.compositeComponentMirror.createMany({
    data: [
      { parentVariantId: set.variantIds[0], componentVariantId: top.variantIds[0], quantity: 1, syncedAt: EARLY },
      { parentVariantId: set.variantIds[0], componentVariantId: skirt.variantIds[0], quantity: 1, syncedAt: EARLY },
    ],
  });

  assert.deepEqual(await f.reserve(await f.order("set"), [{ variantId: set.variantIds[0], quantity: 1 }]), {
    ok: false,
    reason: "INSUFFICIENT_CAPACITY",
    variantId: skirt.variantIds[0],
  });
  assert.equal((await f.reserve(await f.order("direct"), [{ variantId: skirt.variantIds[0], quantity: 1 }])).ok, true);
  // The same variant bought directly and in a set in one order: the whole demand is held to floor 0.
  assert.deepEqual(
    await f.reserve(await f.order("mixed"), [
      { variantId: set.variantIds[0], quantity: 1 },
      { variantId: skirt.variantIds[0], quantity: 1 },
    ]),
    { ok: false, reason: "INSUFFICIENT_CAPACITY", variantId: skirt.variantIds[0] },
  );
});

test("a composite parent whose product is stored non-STANDARD refuses COMPOSITE_MODE_UNSUPPORTED", async (t) => {
  const f = fixture("composite-mode");
  await f.cleanup();
  t.after(f.cleanup);
  const top = await f.product("top", [5]);
  const set = await f.product("set", [5]);
  // Saved before catalog sync made the variant a set: admin could not have refused it then.
  await f.policy(set.productId, "OVERSELL", -20);
  await prisma.compositeComponentMirror.create({
    data: { parentVariantId: set.variantIds[0], componentVariantId: top.variantIds[0], quantity: 1, syncedAt: EARLY },
  });

  assert.deepEqual(await f.reserve(await f.order("on"), [{ variantId: set.variantIds[0], quantity: 1 }]), {
    ok: false,
    reason: "COMPOSITE_MODE_UNSUPPORTED",
    variantId: set.variantIds[0],
  });
  // Capability off: the row is effectively STANDARD and the set sells normally.
  assert.equal(
    (await f.reserve(await f.order("off"), [{ variantId: set.variantIds[0], quantity: 1 }], SELLING_MODE_FLAGS_OFF)).ok,
    true,
  );
});

test("a policy write racing checkout serializes: the locked checkout finishes under the policy it read", async (t) => {
  const f = fixture("serialize");
  await f.cleanup();
  t.after(f.cleanup);
  const { productId, variantIds: [tee] } = await f.product("tee", [0]);
  await f.policy(productId, "OVERSELL", -20);
  const first = await f.order("first");

  let release!: () => void;
  const mayCommit = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reserved!: (result: Awaited<ReturnType<typeof reserveOrderCapacity>>) => void;
  const firstReserved = new Promise<Awaited<ReturnType<typeof reserveOrderCapacity>>>((resolve) => {
    reserved = resolve;
  });
  const checkout = prisma.$transaction(
    async (tx) => {
      reserved(await reserveOrderCapacity(tx, { orderId: first, lines: [{ variantId: tee, quantity: 1 }], sellingModeFlags: ON }));
      await mayCommit;
    },
    { timeout: 20_000 },
  );
  assert.deepEqual(await firstReserved, { ok: true, created: true }, "decided under OVERSELL while holding the lock");

  let written = false;
  const write = f.policy(productId, "STANDARD").then(() => {
    written = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(written, false, "the policy write waits for the checkout's variant lock");

  release();
  await checkout;
  await write;
  assert.deepEqual(await f.reserve(await f.order("second"), [{ variantId: tee, quantity: 1 }]), {
    ok: false,
    reason: "INSUFFICIENT_CAPACITY",
    variantId: tee,
  });
});

test("handoff of a hold taken below zero behaves exactly like one taken above it", async (t) => {
  const f = fixture("handoff");
  await f.cleanup();
  t.after(f.cleanup);
  const { productId, variantIds: [tee] } = await f.product("tee", [0]);
  await f.policy(productId, "OVERSELL", -20);
  const orderId = await f.order("sale");
  assert.equal((await f.reserve(orderId, [{ variantId: tee, quantity: 2 }])).ok, true);

  const acceptedAt = new Date("2026-04-01T10:00:00.000Z");
  await prisma.$transaction((tx) => markOrderCapacityAccepted(tx, orderId, acceptedAt));
  assert.equal(await prisma.$transaction((tx) => handOffMirroredCapacity(tx, new Date())), 0, "acceptance alone releases nothing");

  // Pancake reflects the sale: 0 → −2, read after acceptance.
  const observed = new Date("2026-04-01T10:00:05.000Z");
  await prisma.$transaction(async (tx) => {
    await tx.variantMirror.update({ where: { id: tee }, data: { syncedAt: observed } });
    await tx.warehouseStock.updateMany({ where: { variantId: tee }, data: { quantity: -2, syncedAt: observed } });
  });
  assert.equal(await prisma.$transaction((tx) => handOffMirroredCapacity(tx, new Date())), 1);
  const resource = await prisma.capacityReservationResource.findFirstOrThrow({ where: { variantId: tee } });
  assert.ok(resource.mirroredAt);
  assert.deepEqual(await f.stock(tee), [-2], "the sign travels with the mirror, the hold is retired once");

  // Free is now −2 from the mirror alone: 18 more units reach the limit, the 19th does not.
  assert.equal((await f.reserve(await f.order("to-limit"), [{ variantId: tee, quantity: 18 }])).ok, true);
  assert.equal((await f.reserve(await f.order("past-limit"), [{ variantId: tee, quantity: 1 }])).ok, false);
});
