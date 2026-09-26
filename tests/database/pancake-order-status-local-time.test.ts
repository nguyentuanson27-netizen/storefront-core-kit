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
const shopId = 920_017;
const key = "pancake-status-local-time";
let sequence = 0;

function upstreamStatus(orderId: string, status: 2 | 3, updatedAt: string): PancakeOrderStatus {
  return {
    orderId,
    systemId: 862,
    shopId,
    status,
    insertedAt: "2026-08-14T09:00:00",
    updatedAt,
  };
}

async function createOrder(overrides: {
  pancakeSystemId?: string;
  pancakeStatus?: number;
  pancakeStatusUpdatedAt?: string;
} = {}) {
  sequence += 1;
  return prisma.orderMirror.create({
    data: {
      publicCode: `${key}-${sequence}`,
      pancakeShopId: shopId,
      pancakeOrderId: String(9_100_000 + sequence),
      pancakeSystemId: overrides.pancakeSystemId ?? null,
      pancakeStatus: overrides.pancakeStatus ?? null,
      pancakeStatusUpdatedAt: overrides.pancakeStatusUpdatedAt ?? null,
      state: "CONFIRMED",
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

test("reconciliation persists and advances timezone-less Pancake wall-clock revisions", async () => {
  const order = await createOrder();
  let remote = upstreamStatus(order.pancakeOrderId!, 2, "2026-08-14T10:00:00.123456700");
  const service = createPancakeOrderStatusReconciliationService(
    prisma,
    {
      async fetchOrderStatus() {
        return remote;
      },
    },
    { shopId },
  );

  assert.deepEqual(await service.reconcile({ orderId: order.id }), {
    ok: true,
    outcome: "UPDATED",
  });

  remote = upstreamStatus(order.pancakeOrderId!, 3, "2026-08-14T10:00:00.123456800");
  assert.deepEqual(await service.reconcile({ orderId: order.id }), {
    ok: true,
    outcome: "UPDATED",
  });

  const persisted = await prisma.orderMirror.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(persisted.pancakeSystemId, "862");
  assert.equal(persisted.pancakeStatus, 3);
  assert.equal(persisted.pancakeStatusUpdatedAt, "2026-08-14T10:00:00.123456800");
  assert.equal(persisted.state, "CONFIRMED");
});

test("reconciliation fails closed when persisted and remote revisions mix timezone semantics", async () => {
  const order = await createOrder({
    pancakeSystemId: "862",
    pancakeStatus: 2,
    pancakeStatusUpdatedAt: "2026-08-14T10:00:00Z",
  });
  const service = createPancakeOrderStatusReconciliationService(
    prisma,
    {
      async fetchOrderStatus() {
        return upstreamStatus(order.pancakeOrderId!, 3, "2026-08-14T10:00:01");
      },
    },
    { shopId },
  );

  assert.deepEqual(await service.reconcile({ orderId: order.id }), {
    ok: false,
    reason: "STATUS_CONFLICT",
  });

  const persisted = await prisma.orderMirror.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(persisted.pancakeStatus, 2);
  assert.equal(persisted.pancakeStatusUpdatedAt, "2026-08-14T10:00:00Z");
});
