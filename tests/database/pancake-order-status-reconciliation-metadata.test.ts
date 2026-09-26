import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createPancakeOrderStatusReconciliationService } from "../../src/commerce/pancake-order-status-reconciliation.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";
import { deleteOrdersWithCapacity } from "../support/order-cleanup.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const shopId = 920_007;
const publicCode = "pancake-status-state-clock";

test.after(async () => {
  await deleteOrdersWithCapacity(prisma, { where: { publicCode } });
  await prisma.$disconnect();
});

test("Pancake status reconciliation never advances the local order state recovery clock", async () => {
  await deleteOrdersWithCapacity(prisma, { where: { publicCode } });
  const localUpdatedAt = new Date("2026-08-12T09:30:00.000Z");
  const order = await prisma.orderMirror.create({
    data: {
      publicCode,
      pancakeShopId: shopId,
      pancakeOrderId: "8800999",
      state: "POS_SUBMITTING",
      updatedAt: localUpdatedAt,
    },
  });

  const service = createPancakeOrderStatusReconciliationService(
    prisma,
    {
      async fetchOrderStatus() {
        return {
          orderId: "8800999",
          systemId: 862,
          shopId,
          status: 2 as const,
          insertedAt: "2026-08-12T09:00:00Z",
          updatedAt: "2026-08-12T10:00:00.123456789Z",
        };
      },
    },
    { shopId },
  );

  assert.deepEqual(await service.reconcile({ orderId: order.id }), {
    ok: true,
    outcome: "UPDATED",
  });

  const persisted = await prisma.orderMirror.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(persisted.state, "POS_SUBMITTING");
  assert.equal(persisted.updatedAt.getTime(), localUpdatedAt.getTime());
  assert.equal(persisted.pancakeStatus, 2);
  assert.equal(persisted.pancakeStatusUpdatedAt, "2026-08-12T10:00:00.123456789Z");
});
