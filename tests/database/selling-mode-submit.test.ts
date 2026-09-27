import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import {
  createPancakeOrderSubmissionService,
  type PancakeOrderSubmissionEvent,
} from "../../src/commerce/pancake-order-submit.ts";
import { SELLING_MODE_FLAGS_OFF, type SellingModeFlags } from "../../src/commerce/selling-policy.ts";
import { createSellingPolicyRepository } from "../../src/commerce/selling-policy-repository.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";
import type { PancakeCatalogVariation } from "../../src/integrations/pancake/catalog-contract.ts";
import { deleteOrdersWithCapacity } from "../support/order-cleanup.ts";

/**
 * Selling modes spec §7.3 and §12 "Integration" / "Policy-change races": the live Pancake pre-check
 * measures against the same floor as the locked decision, is allowed to be stale, and is never the
 * authority.
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const repository = createSellingPolicyRepository(prisma);
const shopId = 920_041;
const PREFIX = "selling-submit";
const syncedAt = new Date("2026-01-01T00:00:00.000Z");
const ON: SellingModeFlags = { sellingModesEnabled: true, preorderEnabled: true };

test.after(async () => {
  await prisma.$disconnect();
});

async function cleanup() {
  await deleteOrdersWithCapacity(prisma, { where: { publicCode: { startsWith: PREFIX } } });
  await prisma.productMirror.deleteMany({ where: { pancakeProductId: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
}

async function mirroredVariant(name: string, stock: number) {
  const id = `${PREFIX}-${name}`;
  const product = await prisma.productMirror.create({
    data: { pancakeShopId: 999_042, pancakeProductId: id, slug: id, name, syncedAt },
  });
  await prisma.variantMirror.create({
    data: { id, pancakeVariationId: id, productId: product.id, isPresent: true, isActive: true, syncedAt },
  });
  await prisma.warehouseStock.create({ data: { variantId: id, pancakeWarehouseId: "w", quantity: stock, syncedAt } });
  return { variantId: id, productId: product.id };
}

async function setPolicy(productId: string, sellingMode: "STANDARD" | "OVERSELL", negativeStockLimit = -20) {
  const actor = `${PREFIX}-owner`;
  const now = new Date();
  await prisma.user.upsert({
    where: { id: actor },
    create: { id: actor, name: "owner", email: `${actor}@example.test`, emailVerified: true, role: "ADMIN", createdAt: now, updatedAt: now },
    update: {},
  });
  await repository.saveSellingPolicy(productId, { kind: "SET", sellingMode, negativeStockLimit }, actor);
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

/**
 * The client the service sees, with `hook` run once just before its first transaction. With no price
 * drift that transaction is the one that takes the `VariantMirror` locks, so the hook lands exactly
 * between the unlocked pre-check and the locked decision.
 */
function beforeLockedDecision(hook: () => Promise<void>): PrismaClient {
  let fired = false;
  return new Proxy(prisma, {
    get(target, property) {
      if (property === "$transaction") {
        return async (...args: unknown[]) => {
          if (!fired) {
            fired = true;
            await hook();
          }
          return (target.$transaction as (...inner: unknown[]) => unknown)(...args);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function harness(liveStock: Record<string, number>, { flags = ON, client = prisma as PrismaClient } = {}) {
  const events: PancakeOrderSubmissionEvent[] = [];
  let posts = 0;
  const service = createPancakeOrderSubmissionService(
    client,
    {
      async fetchCompleteCatalog() {
        return Object.entries(liveStock).map(([id, stock]) => live(id, stock));
      },
      async createOrder() {
        posts += 1;
        return { id: 930_000 + posts };
      },
    },
    { onEvent: (event) => events.push(event), sellingModeFlags: flags },
  );
  return {
    submit: (publicCode: string) => service.submit({ publicCode, shopId }),
    events,
    posts: () => posts,
  };
}

function rejection(events: readonly PancakeOrderSubmissionEvent[]) {
  const event = events.find((candidate) => candidate.name === "pancake_order.validation_rejected");
  return event && event.name === "pancake_order.validation_rejected" ? { reason: event.reason, detail: event.detail } : null;
}

test("the live pre-check allows an OVERSELL sale where Pancake reports 0, and refuses one at the limit", async (t) => {
  await cleanup();
  t.after(cleanup);
  const { variantId, productId } = await mirroredVariant("tee", 0);
  await setPolicy(productId, "OVERSELL", -20);

  const sold = harness({ [variantId]: 0 });
  const order = await draft("zero", variantId, 1);
  assert.equal((await sold.submit(order.publicCode)).ok, true);
  assert.equal(sold.posts(), 1);

  // Pancake already reports the limit: the pre-check refuses before any lock or POST.
  const atLimit = harness({ [variantId]: -20 });
  const refused = await draft("at-limit", variantId, 1);
  assert.deepEqual(await atLimit.submit(refused.publicCode), { ok: false, state: "REJECTED", reason: "STOCK_UNAVAILABLE" });
  assert.deepEqual(rejection(atLimit.events), { reason: "STOCK_UNAVAILABLE", detail: "LIVE_STOCK_UNAVAILABLE" });
  assert.equal(atLimit.posts(), 0);
  assert.equal(await prisma.capacityReservation.count({ where: { orderId: refused.id } }), 0);
});

test("with SELLING_MODES_ENABLED off, an OVERSELL row is refused by the live pre-check exactly as STANDARD", async (t) => {
  await cleanup();
  t.after(cleanup);
  const { variantId, productId } = await mirroredVariant("tee", 5);
  await setPolicy(productId, "OVERSELL", -20);

  const off = harness({ [variantId]: 0 }, { flags: SELLING_MODE_FLAGS_OFF });
  const order = await draft("off", variantId, 1);
  assert.deepEqual(await off.submit(order.publicCode), { ok: false, state: "REJECTED", reason: "STOCK_UNAVAILABLE" });
  assert.deepEqual(rejection(off.events), { reason: "STOCK_UNAVAILABLE", detail: "LIVE_STOCK_UNAVAILABLE" });
});

test("looser pre-check: it read OVERSELL, STANDARD committed before the lock, and the locked decision refuses", async (t) => {
  await cleanup();
  t.after(cleanup);
  const { variantId, productId } = await mirroredVariant("tee", 0);
  await setPolicy(productId, "OVERSELL", -20);

  const racing = harness(
    { [variantId]: 0 },
    { client: beforeLockedDecision(() => setPolicy(productId, "STANDARD")) },
  );
  const order = await draft("looser", variantId, 1);
  assert.deepEqual(await racing.submit(order.publicCode), { ok: false, state: "REJECTED", reason: "STOCK_UNAVAILABLE" });
  assert.deepEqual(rejection(racing.events), { reason: "STOCK_UNAVAILABLE", detail: "INSUFFICIENT_CAPACITY" });
  assert.equal(racing.posts(), 0, "nothing is sent to Pancake");
  assert.equal(await prisma.capacityReservation.count({ where: { orderId: order.id } }), 0, "nothing is held");
  assert.ok(!racing.events.some((event) => event.name === "pancake_order.create_started"));
});

test("stricter pre-check: the order it rejects stays REJECTED; a fresh order for the same lines succeeds", async (t) => {
  await cleanup();
  t.after(cleanup);
  const { variantId, productId } = await mirroredVariant("tee", 0);
  await setPolicy(productId, "STANDARD");

  // The pre-check reads STANDARD; OVERSELL is committed right after, before any lock would be taken.
  const first = harness({ [variantId]: 0 });
  const order = await draft("stricter", variantId, 1);
  assert.deepEqual(await first.submit(order.publicCode), { ok: false, state: "REJECTED", reason: "STOCK_UNAVAILABLE" });
  await setPolicy(productId, "OVERSELL", -20);
  assert.ok(!first.events.some((event) => event.name === "pancake_order.create_started"), "rejected before POS_SUBMITTING");
  assert.equal(first.posts(), 0);

  // Terminal for that order: submitting it again returns the same rejection, unchanged.
  const again = harness({ [variantId]: 0 });
  assert.deepEqual(await again.submit(order.publicCode), { ok: false, state: "REJECTED", reason: "STOCK_UNAVAILABLE" });
  assert.equal(again.posts(), 0);
  const stored = await prisma.orderMirror.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(stored.state, "REJECTED");
  assert.equal(stored.syncErrorCode, "STOCK_UNAVAILABLE");

  // Recovery is a fresh order for the same lines, whose pre-check reads the new policy.
  const next = await draft("stricter-retry", variantId, 1);
  assert.equal((await again.submit(next.publicCode)).ok, true);
  assert.equal(again.posts(), 1);
});

test("the locked decision reports an exhausted oversell allowance as NEGATIVE_LIMIT_REACHED", async (t) => {
  await cleanup();
  t.after(cleanup);
  // Pancake lags the local ledger: it still reports room, but local holds already reach the limit.
  const { variantId, productId } = await mirroredVariant("tee", -19);
  await setPolicy(productId, "OVERSELL", -20);
  const service = harness({ [variantId]: 0 });

  const first = await draft("first", variantId, 1);
  assert.equal((await service.submit(first.publicCode)).ok, true);
  const second = await draft("second", variantId, 1);
  assert.deepEqual(await service.submit(second.publicCode), { ok: false, state: "REJECTED", reason: "STOCK_UNAVAILABLE" });
  assert.deepEqual(rejection(service.events), { reason: "STOCK_UNAVAILABLE", detail: "NEGATIVE_LIMIT_REACHED" });
  assert.equal(service.posts(), 1);
});
