import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import {
  readRelatedOverrideIds,
  replaceRelatedOverrides,
} from "../../src/commerce/related-product-override-repository.ts";
import { RELATED_OVERRIDE_MAX_ITEMS } from "../../src/commerce/related-product-override.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const SHOP_ID = 999_009;
const EARLY = new Date("2026-01-01T00:00:00.000Z");
const PREFIX = "related-override";

test.after(async () => {
  await prisma.$disconnect();
});

async function cleanup() {
  await prisma.productMirror.deleteMany({ where: { pancakeProductId: { startsWith: PREFIX } } });
}

async function products(count: number): Promise<string[]> {
  await prisma.productMirror.createMany({
    data: Array.from({ length: count }, (_unused, index) => {
      const id = `${PREFIX}-${String(index).padStart(3, "0")}`;
      return { pancakeShopId: SHOP_ID, pancakeProductId: id, slug: id, name: id, syncedAt: EARLY };
    }),
  });
  return (
    await prisma.productMirror.findMany({
      where: { pancakeProductId: { startsWith: `${PREFIX}-` } },
      orderBy: { pancakeProductId: "asc" },
      select: { id: true },
    })
  ).map(({ id }) => id);
}

const replace = (productId: string, relatedProductIds: string[]) =>
  replaceRelatedOverrides(prisma, { productId, relatedProductIds, updatedByUserId: null });

test("B05 an ordered list round-trips and reordering is atomic", async () => {
  await cleanup();
  const [owner, a, b, c] = await products(4);
  assert.deepEqual(await replace(owner!, [a!, b!, c!]), { ok: true });
  assert.deepEqual(await readRelatedOverrideIds(prisma, owner!), [a, b, c]);
  assert.deepEqual(await replace(owner!, [c!, b!, a!]), { ok: true });
  assert.deepEqual(await readRelatedOverrideIds(prisma, owner!), [c, b, a]);
  assert.deepEqual(await replace(owner!, [b!]), { ok: true });
  assert.deepEqual(await readRelatedOverrideIds(prisma, owner!), [b]);
  assert.deepEqual(await replace(owner!, []), { ok: true });
  assert.deepEqual(await readRelatedOverrideIds(prisma, owner!), []);
  await cleanup();
});

test("B05 lists are per product", async () => {
  await cleanup();
  const [p, q, a, b] = await products(4);
  await replace(p!, [a!, b!]);
  await replace(q!, [b!]);
  assert.deepEqual(await readRelatedOverrideIds(prisma, p!), [a, b]);
  assert.deepEqual(await readRelatedOverrideIds(prisma, q!), [b]);
  await cleanup();
});

test("B05 self, duplicates, unknown products and an unknown owner are refused and write nothing", async () => {
  await cleanup();
  const [owner, a] = await products(2);
  assert.deepEqual(await replace(owner!, [a!]), { ok: true });

  assert.deepEqual(await replace(owner!, [owner!]), { ok: false, reason: "SELF_REFERENCE" });
  assert.deepEqual(await replace(owner!, [a!, a!]), { ok: false, reason: "DUPLICATE_PRODUCT" });
  assert.deepEqual(await replace(owner!, ["nope"]), { ok: false, reason: "UNKNOWN_PRODUCT" });
  assert.deepEqual(await replace("no-such-owner", [a!]), { ok: false, reason: "UNKNOWN_PRODUCT" });
  assert.deepEqual(await replace("", [a!]), { ok: false, reason: "INVALID" });
  assert.deepEqual(await readRelatedOverrideIds(prisma, owner!), [a]);
  await cleanup();
});

test("B05 eight are accepted and nine are refused before the database", async () => {
  await cleanup();
  const ids = await products(10);
  const [owner, ...others] = ids;
  assert.deepEqual(await replace(owner!, others.slice(0, RELATED_OVERRIDE_MAX_ITEMS)), { ok: true });
  assert.deepEqual(await replace(owner!, others.slice(0, RELATED_OVERRIDE_MAX_ITEMS + 1)), {
    ok: false,
    reason: "TOO_MANY",
  });
  assert.equal((await readRelatedOverrideIds(prisma, owner!)).length, 8);
  await cleanup();
});

test("B05 the database itself enforces self, ceiling, uniqueness and keys", async () => {
  await cleanup();
  const [owner, a, b] = await products(3);
  const row = (relatedProductId: string, position: number, productId = owner!) =>
    prisma.relatedProductOverride.create({ data: { productId, relatedProductId, position } });

  await assert.rejects(row(owner!, 0), /not_self|check/i, "a product is never its own related product");
  await assert.rejects(row(a!, 8), /position_range|check/i, "position 8 would be the ninth");
  await assert.rejects(row(a!, -1), /position_range|check/i);
  await row(a!, 0);
  await assert.rejects(row(a!, 1), /unique/i, "the same pair twice");
  await assert.rejects(row(b!, 0), /unique/i, "the same position twice");
  await assert.rejects(row("no-such-product", 2), /foreign key|fkey/i);
  await cleanup();
});

test("B05 deleting either product removes the pair", async () => {
  await cleanup();
  const [owner, a, b] = await products(3);
  await replace(owner!, [a!, b!]);
  await prisma.productMirror.delete({ where: { id: a! } });
  assert.deepEqual(await readRelatedOverrideIds(prisma, owner!), [b]);
  await prisma.productMirror.delete({ where: { id: owner! } });
  assert.equal(await prisma.relatedProductOverride.count({ where: { relatedProductId: b! } }), 0);
  await cleanup();
});

test("B05 two concurrent writers of one product serialize and leave a valid list", async () => {
  await cleanup();
  const [owner, a, b, c, d] = await products(5);
  const results = await Promise.all([replace(owner!, [a!, b!]), replace(owner!, [d!, c!])]);
  assert.ok(results.every((result) => result.ok));
  const final = await readRelatedOverrideIds(prisma, owner!);
  assert.ok(
    JSON.stringify(final) === JSON.stringify([a, b]) || JSON.stringify(final) === JSON.stringify([d, c]),
    `one writer wins whole, never a mix: ${JSON.stringify(final)}`,
  );
  await cleanup();
});
