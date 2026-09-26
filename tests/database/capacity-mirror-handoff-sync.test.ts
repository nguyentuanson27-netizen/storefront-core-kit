import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import {
  markOrderCapacityAccepted,
  readAdvisorySellableUnits,
  reserveOrderCapacity,
} from "../../src/commerce/capacity-reservation-repository.ts";
import { createCatalogMirrorRepository } from "../../src/commerce/catalog-mirror-repository.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";
import type { PancakeParsedCatalogVariation } from "../../src/integrations/pancake/catalog-contract.ts";
import { deleteOrdersWithCapacity } from "../support/order-cleanup.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const repository = createCatalogMirrorRepository(prisma);
const shopId = 910_077;
const PUBLIC_CODE = "capacity-sync-handoff";

function variation(stock: number): PancakeParsedCatalogVariation {
  return {
    id: "capacity-sync-variation",
    productId: "capacity-sync-product",
    displayId: "capacity-sync-display",
    barcode: "capacity-sync-barcode",
    fields: [{ id: "field-size", keyValue: "size", name: "Size", value: "M" }],
    imageUrls: [],
    isHidden: false,
    isLocked: false,
    retailPrice: 100_000,
    retailPriceAfterDiscount: 100_000,
    product: { id: "capacity-sync-product", name: "Capacity Sync", sourceDescription: null, primaryImageUrl: null },
    warehouseStocks: [{ warehouseId: "w1", remainQuantity: stock }],
    sellableStock: stock,
  };
}

async function cleanup() {
  await deleteOrdersWithCapacity(prisma, { where: { publicCode: PUBLIC_CODE } });
  await prisma.productMirror.deleteMany({ where: { pancakeShopId: shopId } });
  await prisma.catalogSyncState.deleteMany({ where: { pancakeShopId: shopId } });
}

test.before(cleanup);
test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test("catalog sync hands a hold to the mirror only when its read started after acceptance", async () => {
  await repository.syncSnapshot({ shopId, variations: [variation(10)], syncedAt: new Date("2026-04-01T00:00:00Z") });
  const variantId = (
    await prisma.variantMirror.findUniqueOrThrow({ where: { pancakeVariationId: "capacity-sync-variation" } })
  ).id;
  const order = await prisma.orderMirror.create({ data: { publicCode: PUBLIC_CODE } });
  const reserved = await prisma.$transaction((tx) =>
    reserveOrderCapacity(tx, { orderId: order.id, lines: [{ variantId, quantity: 2 }] }),
  );
  assert.deepEqual(reserved, { ok: true, created: true });
  await prisma.$transaction((tx) => markOrderCapacityAccepted(tx, order.id, new Date("2026-04-01T12:00:00Z")));

  // A sync whose read started before acceptance already shows the decrement, but proves nothing.
  await repository.syncSnapshot({ shopId, variations: [variation(8)], syncedAt: new Date("2026-04-01T11:59:00Z") });
  assert.equal((await readAdvisorySellableUnits(prisma, [variantId])).get(variantId), 6);

  // The next sync started after acceptance: the mirror now owns those two units.
  await repository.syncSnapshot({ shopId, variations: [variation(8)], syncedAt: new Date("2026-04-01T12:05:00Z") });
  assert.equal((await readAdvisorySellableUnits(prisma, [variantId])).get(variantId), 8);
  const resource = await prisma.capacityReservationResource.findFirstOrThrow({ where: { variantId } });
  assert.deepEqual(resource.mirrorObservationStartedAt, new Date("2026-04-01T12:05:00Z"));
});
