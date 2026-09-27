import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import {
  readAdvisorySellableUnits,
  reserveOrderCapacity,
} from "../../src/commerce/capacity-reservation-repository.ts";
import { buildVariantStockCte } from "../../src/commerce/storefront-catalog.ts";
import { Prisma, PrismaClient } from "../../src/generated/prisma/client.ts";
import { deleteOrdersWithCapacity } from "../support/order-cleanup.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const PREFIX = "capacity-parity";
const syncedAt = new Date("2026-01-01T00:00:00.000Z");

async function cleanup() {
  await deleteOrdersWithCapacity(prisma, { where: { publicCode: { startsWith: PREFIX } } });
  await prisma.productMirror.deleteMany({ where: { pancakeProductId: { startsWith: PREFIX } } });
}

test.before(cleanup);
test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

async function variant(name: string, stock: number[], { isPresent = true } = {}) {
  const id = `${PREFIX}-${name}`;
  const product = await prisma.productMirror.create({
    data: { pancakeShopId: 999_004, pancakeProductId: id, slug: id, name, syncedAt },
  });
  await prisma.variantMirror.create({
    data: { id, pancakeVariationId: id, productId: product.id, isPresent, isActive: true, syncedAt },
  });
  if (stock.length > 0) {
    await prisma.warehouseStock.createMany({
      data: stock.map((quantity, index) => ({ variantId: id, pancakeWarehouseId: `w${index}`, quantity, syncedAt })),
    });
  }
  return id;
}

async function edge(parentVariantId: string, componentVariantId: string, quantity: number) {
  await prisma.compositeComponentMirror.create({ data: { parentVariantId, componentVariantId, quantity, syncedAt } });
}

async function hold(name: string, variantId: string, quantity: number) {
  const order = await prisma.orderMirror.create({ data: { publicCode: `${PREFIX}-${name}` } });
  const result = await prisma.$transaction((tx) =>
    reserveOrderCapacity(tx, { orderId: order.id, lines: [{ variantId, quantity }] }),
  );
  assert.ok(result.ok, name);
}

test("the SQL capacity projection matches the TypeScript read model on every fixture shape", async () => {
  const held = await variant("held", [5]);
  await hold("held-order", held, 2);
  const fractional = await variant("fractional", [1.6, 0.6]);
  const empty = await variant("empty", []);
  const negative = await variant("negative", [-3]);
  const nan = await variant("nan", [7]);
  await prisma.$executeRaw`UPDATE "WarehouseStock" SET "quantity" = 'NaN'::float8 WHERE "variantId" = ${nan}`;
  const gone = await variant("gone", [9], { isPresent: false });

  const top = await variant("top", [10]);
  const skirt = await variant("skirt", [5]);
  const set = await variant("set", [0]);
  await edge(set, top, 1);
  await edge(set, skirt, 2);
  await hold("top-order", top, 3);

  const brokenSet = await variant("broken-set", [50]);
  await edge(brokenSet, top, 1);
  await edge(brokenSet, gone, 1);

  const inner = await variant("inner", [4]);
  const leaf = await variant("leaf", [4]);
  const outer = await variant("outer", [4]);
  await edge(inner, leaf, 1);
  await edge(outer, inner, 1);

  const ids = [held, fractional, empty, negative, nan, gone, top, skirt, set, brokenSet, inner, leaf, outer];
  const expected = await readAdvisorySellableUnits(prisma, ids);

  const rows = await prisma.$queryRaw<{ id: string; sellableUnits: Prisma.Decimal }[]>(Prisma.sql`
    ${buildVariantStockCte(new Date())}
    SELECT "id", "sellableUnits" FROM "capacity_sellable" WHERE "id" IN (${Prisma.join(ids)})
  `);
  const actual = new Map(rows.map((row) => [row.id, Number(row.sellableUnits)]));

  assert.deepEqual(Object.fromEntries(actual), Object.fromEntries(expected));
  // And the values themselves, so the pair cannot agree on something wrong.
  assert.deepEqual(Object.fromEntries(expected), {
    [held]: 3,
    [fractional]: 2,
    [empty]: 0,
    [negative]: 0,
    [nan]: 0,
    [gone]: 0,
    [top]: 7,
    [skirt]: 5,
    [set]: 2,
    [brokenSet]: 0,
    [inner]: 4,
    [leaf]: 4,
    [outer]: 0,
  });

  // The listing's own column reads the projection, not the parent's raw mirror.
  const listed = await prisma.$queryRaw<{ id: string; sellableStock: number }[]>(Prisma.sql`
    ${buildVariantStockCte(new Date())}
    SELECT "id", "sellableStock" FROM "variant_base" WHERE "id" IN (${Prisma.join([set, held, top])})
  `);
  assert.deepEqual(
    Object.fromEntries(listed.map((row) => [row.id, row.sellableStock])),
    { [set]: 2, [held]: 3, [top]: 7 },
  );
});
