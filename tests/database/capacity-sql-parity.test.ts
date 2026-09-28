import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import {
  readAdvisorySellableUnits,
  readAdvisoryVariantCapacity,
  reserveOrderCapacity,
} from "../../src/commerce/capacity-reservation-repository.ts";
import { buildVariantStockCte } from "../../src/commerce/storefront-catalog.ts";
import { SELLING_MODE_FLAGS_OFF, type SellingModeFlags } from "../../src/commerce/selling-policy.ts";
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

async function variant(
  name: string,
  stock: number[],
  {
    isPresent = true,
    policy = null,
  }: { isPresent?: boolean; policy?: { sellingMode: "STANDARD" | "OVERSELL" | "PREORDER"; negativeStockLimit: number } | null } = {},
) {
  const id = `${PREFIX}-${name}`;
  const product = await prisma.productMirror.create({
    data: { pancakeShopId: 999_004, pancakeProductId: id, slug: id, name, syncedAt },
  });
  if (policy !== null) {
    await prisma.productSellingPolicy.create({ data: { productId: product.id, ...policy } });
  }
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
    reserveOrderCapacity(tx, { orderId: order.id, lines: [{ variantId, quantity }], sellingModeFlags: SELLING_MODE_FLAGS_OFF }),
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
  const expected = await readAdvisorySellableUnits(prisma, ids, SELLING_MODE_FLAGS_OFF);

  const rows = await prisma.$queryRaw<{ id: string; sellableUnits: Prisma.Decimal }[]>(Prisma.sql`
    ${buildVariantStockCte(new Date(), SELLING_MODE_FLAGS_OFF)}
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
    ${buildVariantStockCte(new Date(), SELLING_MODE_FLAGS_OFF)}
    SELECT "id", "sellableStock" FROM "variant_base" WHERE "id" IN (${Prisma.join([set, held, top])})
  `);
  assert.deepEqual(
    Object.fromEntries(listed.map((row) => [row.id, row.sellableStock])),
    { [set]: 2, [held]: 3, [top]: 7 },
  );
});

const FLAG_COMBINATIONS: readonly SellingModeFlags[] = [
  { sellingModesEnabled: false, preorderEnabled: false },
  { sellingModesEnabled: false, preorderEnabled: true },
  { sellingModesEnabled: true, preorderEnabled: false },
  { sellingModesEnabled: true, preorderEnabled: true },
];

test("selling modes: SQL and TypeScript agree on sellable, ready and preorder under every flag combination", async () => {
  const over = { sellingMode: "OVERSELL" as const, negativeStockLimit: -20 };
  const pre = { sellingMode: "PREORDER" as const, negativeStockLimit: -20 };
  const noRow = await variant("m-no-row", [2]);
  const standardNegative = await variant("m-standard-negative", [-3], {
    policy: { sellingMode: "STANDARD", negativeStockLimit: -20 },
  });
  const overNegative = await variant("m-over-negative", [-3], { policy: over });
  const overAtLimit = await variant("m-over-at-limit", [-20], { policy: over });
  const overBelowLimit = await variant("m-over-below-limit", [-25], { policy: over });
  const preZero = await variant("m-pre-zero", [0], { policy: pre });
  const preReady = await variant("m-pre-ready", [1], { policy: pre });
  const preHeld = await variant("m-pre-held", [2], { policy: { sellingMode: "PREORDER", negativeStockLimit: -5 } });
  await hold("m-pre-held-order", preHeld, 2);

  // A set whose own product is stored OVERSELL: not honourable in v1 (§6.1).
  const setTop = await variant("m-set-top", [4]);
  const overSet = await variant("m-over-set", [9], { policy: over });
  await edge(overSet, setTop, 1);
  // A STANDARD set spending an OVERSELL component that is below zero: component floor 0.
  const overComponent = await variant("m-over-component", [-2], { policy: over });
  const standardSet = await variant("m-standard-set", [9]);
  await edge(standardSet, overComponent, 1);

  const ids = [
    noRow,
    standardNegative,
    overNegative,
    overAtLimit,
    overBelowLimit,
    preZero,
    preReady,
    preHeld,
    setTop,
    overSet,
    overComponent,
    standardSet,
  ];

  for (const flags of FLAG_COMBINATIONS) {
    const expected = await readAdvisoryVariantCapacity(prisma, ids, flags);
    const rows = await prisma.$queryRaw<
      { id: string; sellableUnits: Prisma.Decimal; readyUnits: Prisma.Decimal; isPreorderSale: boolean }[]
    >(Prisma.sql`
      ${buildVariantStockCte(new Date(), flags)}
      SELECT "id", "sellableUnits", "readyUnits", "isPreorderSale" FROM "capacity_sellable" WHERE "id" IN (${Prisma.join(ids)})
    `);
    assert.deepEqual(
      Object.fromEntries(
        rows.map((row) => [
          row.id,
          { sellableUnits: Number(row.sellableUnits), readyUnits: Number(row.readyUnits), isPreorderSale: row.isPreorderSale },
        ]),
      ),
      Object.fromEntries(
        [...expected].map(([id, { sellableUnits, readyUnits, isPreorderSale }]) => [
          id,
          { sellableUnits, readyUnits, isPreorderSale },
        ]),
      ),
      JSON.stringify(flags),
    );
  }

  // The values under full enablement, so the pair cannot agree on something wrong.
  const on = await readAdvisoryVariantCapacity(prisma, ids, { sellingModesEnabled: true, preorderEnabled: true });
  const pick = (id: string) => {
    const { sellableUnits, readyUnits, isPreorderSale } = on.get(id)!;
    return [sellableUnits, readyUnits, isPreorderSale];
  };
  assert.deepEqual(pick(noRow), [2, 2, false]);
  assert.deepEqual(pick(standardNegative), [0, 0, false]);
  assert.deepEqual(pick(overNegative), [17, 0, false]);
  assert.deepEqual(pick(overAtLimit), [0, 0, false]);
  assert.deepEqual(pick(overBelowLimit), [0, 0, false]);
  assert.deepEqual(pick(preZero), [20, 0, true]);
  assert.deepEqual(pick(preReady), [21, 1, false]);
  assert.deepEqual(pick(preHeld), [5, 0, true]);
  assert.deepEqual(pick(overSet), [0, 4, false]);
  assert.deepEqual(pick(overComponent), [18, 0, false]);
  assert.deepEqual(pick(standardSet), [0, 0, false]);

  // And with the capability off, every one of them is exactly STANDARD.
  const off = await readAdvisoryVariantCapacity(prisma, ids, SELLING_MODE_FLAGS_OFF);
  assert.deepEqual(
    [overNegative, preZero, preReady, overSet].map((id) => off.get(id)!.sellableUnits),
    [0, 0, 1, 4],
  );
  assert.ok([...off.values()].every(({ isPreorderSale, acceptsPreorder }) => !isPreorderSale && !acceptsPreorder));

  // `availability=in-stock` means "buyable now without preorder" (§9): OVERSELL below zero is in,
  // a preorder-sale variant and a STANDARD variant at or below zero are out.
  const inStock = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    ${buildVariantStockCte(new Date(), { sellingModesEnabled: true, preorderEnabled: true })}
    SELECT "id" FROM "variant_stock"
    WHERE "id" IN (${Prisma.join(ids)}) AND "sellableStock" > 0 AND NOT "isPreorderSale"
    ORDER BY "id"
  `);
  assert.deepEqual(
    inStock.map(({ id }) => id),
    [noRow, overComponent, overNegative, preReady, setTop].sort(),
  );
});
