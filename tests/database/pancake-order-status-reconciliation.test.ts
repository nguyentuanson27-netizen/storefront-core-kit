import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createPancakeOrderStatusReconciliationService } from "../../src/commerce/pancake-order-status-reconciliation.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";
import type { PancakeOrderStatus } from "../../src/integrations/pancake/order-status.ts";
import { deleteOrdersWithCapacity } from "../support/order-cleanup.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const key = "pancake-status-reconcile";
const shopId = 920_007;
let sequence = 0;

type StatusGateway = {
  fetchOrderStatus(shopId: number, orderId: string): Promise<PancakeOrderStatus>;
};

function createService(gateway: StatusGateway, configuredShopId = shopId) {
  return createPancakeOrderStatusReconciliationService(prisma, gateway, {
    shopId: configuredShopId,
  });
}

function nextIdentity() {
  sequence += 1;
  return {
    publicCode: `${key}-${sequence}`,
    pancakeOrderId: String(8_800_000 + sequence),
  };
}

function upstreamStatus(
  orderId: string,
  overrides: Partial<PancakeOrderStatus> = {},
): PancakeOrderStatus {
  return {
    orderId,
    systemId: 9_007_199_254_740_991,
    shopId,
    status: 2,
    insertedAt: "2026-08-12T09:00:00Z",
    updatedAt: "2026-08-12T10:00:00.123456789Z",
    ...overrides,
  };
}

async function createOrder(
  overrides: Partial<{
    pancakeShopId: number | null;
    pancakeOrderId: string | null;
    pancakeSystemId: string | null;
    pancakeStatus: number | null;
    pancakeStatusUpdatedAt: string | null;
    state: "DRAFT" | "VALIDATING" | "POS_SUBMITTING" | "CONFIRMED" | "REJECTED" | "SYNC_UNKNOWN";
  }> = {},
) {
  const identity = nextIdentity();
  return prisma.orderMirror.create({
    data: {
      publicCode: identity.publicCode,
      pancakeShopId: overrides.pancakeShopId === undefined ? shopId : overrides.pancakeShopId,
      pancakeOrderId:
        overrides.pancakeOrderId === undefined ? identity.pancakeOrderId : overrides.pancakeOrderId,
      pancakeSystemId: overrides.pancakeSystemId ?? null,
      pancakeStatus: overrides.pancakeStatus ?? null,
      pancakeStatusUpdatedAt: overrides.pancakeStatusUpdatedAt ?? null,
      state: overrides.state ?? "CONFIRMED",
    },
  });
}

async function cleanup() {
  await deleteOrdersWithCapacity(prisma, { where: { publicCode: { startsWith: `${key}-` } } });
}

test.beforeEach(cleanup);

test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test("reconciliation persists a newer Pancake status without changing local order state", async () => {
  const order = await createOrder();
  let calls = 0;
  const gateway = {
    async fetchOrderStatus(receivedShopId: number, receivedOrderId: string) {
      calls += 1;
      assert.equal(receivedShopId, shopId);
      assert.equal(receivedOrderId, order.pancakeOrderId);
      return upstreamStatus(receivedOrderId, { status: 6 });
    },
  };
  const service = createService(gateway);

  assert.deepEqual(await service.reconcile({ orderId: order.id }), {
    ok: true,
    outcome: "UPDATED",
  });
  assert.equal(calls, 1);

  const persisted = await prisma.orderMirror.findUniqueOrThrow({
    where: { id: order.id },
    select: {
      pancakeSystemId: true,
      pancakeStatus: true,
      pancakeStatusUpdatedAt: true,
      state: true,
    },
  });
  assert.deepEqual(persisted, {
    pancakeSystemId: "9007199254740991",
    pancakeStatus: 6,
    pancakeStatusUpdatedAt: "2026-08-12T10:00:00.123456789Z",
    state: "CONFIRMED",
  });
});

test("reconciliation fails closed before Pancake for missing, unsynced, or cross-shop local orders", async () => {
  const unsynced = await createOrder({ pancakeOrderId: null });
  const wrongShop = await createOrder({ pancakeShopId: shopId + 1 });
  let calls = 0;
  const service = createService({
    async fetchOrderStatus() {
      calls += 1;
      throw new Error("must not call Pancake");
    },
  });

  assert.deepEqual(await service.reconcile({ orderId: "00000000-0000-4000-8000-000000000000" }), {
    ok: false,
    reason: "ORDER_NOT_FOUND",
  });
  assert.deepEqual(await service.reconcile({ orderId: unsynced.id }), {
    ok: false,
    reason: "ORDER_UNSYNCED",
  });
  assert.deepEqual(await service.reconcile({ orderId: wrongShop.id }), {
    ok: false,
    reason: "SHOP_SCOPE_UNVERIFIED",
  });
  assert.equal(calls, 0);
});

test("reconciliation rejects invalid configured shop scope before database or Pancake access", async () => {
  let calls = 0;
  const gateway = {
    async fetchOrderStatus() {
      calls += 1;
      throw new Error("must not call");
    },
  };

  for (const configuredShopId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createService(gateway, configuredShopId), TypeError);
  }
  assert.equal(calls, 0);
});

test("reconciliation collapses upstream failures without persisting error details", async () => {
  const order = await createOrder();
  const secretMarker = "customer-phone-0900000000";
  const service = createService({
    async fetchOrderStatus() {
      throw new Error(secretMarker);
    },
  });

  const result = await service.reconcile({ orderId: order.id });
  assert.deepEqual(result, { ok: false, reason: "STATUS_UNAVAILABLE" });
  assert.equal(JSON.stringify(result).includes(secretMarker), false);

  const persisted = await prisma.orderMirror.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(persisted.pancakeSystemId, null);
  assert.equal(persisted.pancakeStatus, null);
  assert.equal(persisted.pancakeStatusUpdatedAt, null);
  assert.equal(persisted.state, "CONFIRMED");
});

test("reconciliation is idempotent for the same upstream instant and rejects conflicting data", async () => {
  const order = await createOrder({
    pancakeSystemId: "862",
    pancakeStatus: 2,
    pancakeStatusUpdatedAt: "2026-08-12T17:00:00.123456789+07:00",
  });
  const before = await prisma.orderMirror.findUniqueOrThrow({ where: { id: order.id } });

  let remote = upstreamStatus(order.pancakeOrderId!, {
    systemId: 862,
    status: 2,
    updatedAt: "2026-08-12T10:00:00.123456789Z",
  });
  const service = createService({
    async fetchOrderStatus() {
      return remote;
    },
  });

  assert.deepEqual(await service.reconcile({ orderId: order.id }), {
    ok: true,
    outcome: "UNCHANGED",
  });

  remote = { ...remote, status: 3 };
  assert.deepEqual(await service.reconcile({ orderId: order.id }), {
    ok: false,
    reason: "STATUS_CONFLICT",
  });

  remote = { ...remote, status: 2, systemId: 863 };
  assert.deepEqual(await service.reconcile({ orderId: order.id }), {
    ok: false,
    reason: "STATUS_CONFLICT",
  });

  const after = await prisma.orderMirror.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime());
  assert.equal(after.pancakeSystemId, "862");
  assert.equal(after.pancakeStatus, 2);
  assert.equal(after.pancakeStatusUpdatedAt, "2026-08-12T17:00:00.123456789+07:00");
  assert.equal(after.state, "CONFIRMED");
});

test("reconciliation ignores older revisions and preserves sub-millisecond ordering", async () => {
  const order = await createOrder({
    pancakeSystemId: "862",
    pancakeStatus: 2,
    pancakeStatusUpdatedAt: "2026-08-12T10:00:00.123456700Z",
  });
  let remote = upstreamStatus(order.pancakeOrderId!, {
    systemId: 862,
    status: 1,
    updatedAt: "2026-08-12T10:00:00.123456600Z",
  });
  const service = createService({
    async fetchOrderStatus() {
      return remote;
    },
  });

  assert.deepEqual(await service.reconcile({ orderId: order.id }), {
    ok: true,
    outcome: "STALE",
  });

  remote = {
    ...remote,
    status: 3,
    updatedAt: "2026-08-12T10:00:00.123456800Z",
  };
  assert.deepEqual(await service.reconcile({ orderId: order.id }), {
    ok: true,
    outcome: "UPDATED",
  });

  const persisted = await prisma.orderMirror.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(persisted.pancakeStatus, 3);
  assert.equal(persisted.pancakeStatusUpdatedAt, "2026-08-12T10:00:00.123456800Z");
  assert.equal(persisted.state, "CONFIRMED");
});

test("concurrent reconciliation cannot let a delayed stale response overwrite a newer status", async () => {
  const order = await createOrder();
  let calls = 0;
  let releaseOlder!: () => void;
  let olderStarted!: () => void;
  const olderGate = new Promise<void>((resolve) => {
    releaseOlder = resolve;
  });
  const started = new Promise<void>((resolve) => {
    olderStarted = resolve;
  });

  const service = createService({
    async fetchOrderStatus() {
      calls += 1;
      if (calls === 1) {
        olderStarted();
        await olderGate;
        return upstreamStatus(order.pancakeOrderId!, {
          systemId: 862,
          status: 2,
          updatedAt: "2026-08-12T10:00:00.123456700Z",
        });
      }
      return upstreamStatus(order.pancakeOrderId!, {
        systemId: 862,
        status: 3,
        updatedAt: "2026-08-12T10:00:00.123456800Z",
      });
    },
  });

  const delayedOlder = service.reconcile({ orderId: order.id });
  await started;
  const newer = await service.reconcile({ orderId: order.id });
  releaseOlder();
  const older = await delayedOlder;

  assert.deepEqual(newer, { ok: true, outcome: "UPDATED" });
  assert.deepEqual(older, { ok: true, outcome: "STALE" });

  const persisted = await prisma.orderMirror.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(persisted.pancakeSystemId, "862");
  assert.equal(persisted.pancakeStatus, 3);
  assert.equal(persisted.pancakeStatusUpdatedAt, "2026-08-12T10:00:00.123456800Z");
  assert.equal(persisted.state, "CONFIRMED");
});

test("reconciliation rejects malformed local order ids before database or network semantics are entered", async () => {
  let calls = 0;
  const service = createService({
    async fetchOrderStatus() {
      calls += 1;
      throw new Error("must not call");
    },
  });

  for (const orderId of ["", " order-id", "x".repeat(129)]) {
    await assert.rejects(() => service.reconcile({ orderId }), TypeError);
  }
  assert.equal(calls, 0);
});
