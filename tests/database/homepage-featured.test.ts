import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import {
  HOMEPAGE_FEATURED_MAX_ITEMS,
  listHomepageFeatured,
  readHomepageFeaturedRevision,
  replaceHomepageFeatured,
} from "../../src/commerce/homepage-featured-repository.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const SHOP_ID = 999_008;
const EARLY = new Date("2026-01-01T00:00:00.000Z");
const PREFIX = "homepage-featured";

test.after(async () => {
  await prisma.$disconnect();
});

async function cleanup() {
  await prisma.homepageFeaturedProduct.deleteMany();
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

async function replace(productIds: string[], expected?: bigint) {
  return replaceHomepageFeatured(prisma, {
    productIds,
    expectedRevision: expected ?? (await readHomepageFeaturedRevision(prisma)),
    updatedByUserId: null,
  });
}

const order = async () => (await listHomepageFeatured(prisma)).map(({ productId }) => productId);

test("B04 an ordered selection round-trips with dense positions and an advancing revision", async () => {
  await cleanup();
  const ids = await products(5);
  const before = await readHomepageFeaturedRevision(prisma);
  assert.deepEqual(await replace([ids[3]!, ids[0]!, ids[4]!], before), { ok: true, revision: before + BigInt(1) });
  assert.deepEqual(await order(), [ids[3], ids[0], ids[4]]);
  assert.deepEqual((await listHomepageFeatured(prisma)).map(({ position }) => position), [0, 1, 2]);
  await cleanup();
});

test("B04 a full reversal is atomic through the deferred position constraint", async () => {
  await cleanup();
  const ids = await products(6);
  assert.equal((await replace(ids)).ok, true);
  const reversed = [...ids].reverse();
  assert.equal((await replace(reversed)).ok, true);
  assert.deepEqual(await order(), reversed);
  await cleanup();
});

test("B04 12 slots are accepted and 13 is refused before the database", async () => {
  await cleanup();
  const ids = await products(13);
  assert.equal((await replace(ids.slice(0, HOMEPAGE_FEATURED_MAX_ITEMS))).ok, true);
  assert.deepEqual(await replace(ids), { ok: false, reason: "TOO_MANY" });
  assert.equal((await order()).length, 12, "the refused write changed nothing");
  await cleanup();
});

test("B04 the database itself enforces the ceiling, uniqueness and keys", async () => {
  await cleanup();
  const ids = await products(3);
  const slot = (productId: string, position: number) =>
    prisma.homepageFeaturedProduct.create({ data: { productId, position } });

  await assert.rejects(slot(ids[0]!, 12), /position_range|check/i, "position 12 would be the 13th slot");
  await assert.rejects(slot(ids[0]!, -1), /position_range|check/i);
  await slot(ids[0]!, 0);
  await assert.rejects(slot(ids[1]!, 0), /unique|position_key/i);
  await assert.rejects(slot(ids[0]!, 1), /unique|productId/i);
  await assert.rejects(slot("no-such-product", 2), /foreign key|fkey/i);
  await cleanup();
});

test("B04 refusals write nothing: duplicates, unknown products, invalid input, stale revision", async () => {
  await cleanup();
  const ids = await products(3);
  const start = await readHomepageFeaturedRevision(prisma);
  assert.equal((await replace([ids[0]!], start)).ok, true);

  assert.deepEqual(await replace([ids[1]!, ids[1]!]), { ok: false, reason: "DUPLICATE_PRODUCT" });
  assert.deepEqual(await replace([ids[1]!, "does-not-exist"]), { ok: false, reason: "UNKNOWN_PRODUCT" });
  assert.deepEqual(await replace([""]), { ok: false, reason: "INVALID" });
  assert.deepEqual(await replace([ids[1]!, ids[2]!], start), { ok: false, reason: "STALE_REVISION" });
  assert.deepEqual(await order(), [ids[0]]);
  await cleanup();
});

test("B04 two concurrent writers from one revision: exactly one wins", async () => {
  await cleanup();
  const ids = await products(4);
  const start = await readHomepageFeaturedRevision(prisma);
  const results = await Promise.all([replace([ids[0]!, ids[1]!], start), replace([ids[3]!, ids[2]!], start)]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => !result.ok && result.reason === "STALE_REVISION").length, 1);
  assert.equal(await readHomepageFeaturedRevision(prisma), start + BigInt(1));
  await cleanup();
});

test("B04 a deleted product takes its slot; the rest keep their relative order", async () => {
  await cleanup();
  const ids = await products(4);
  assert.equal((await replace(ids)).ok, true);
  await prisma.productMirror.delete({ where: { id: ids[1]! } });
  assert.deepEqual(await order(), [ids[0], ids[2], ids[3]]);
  await cleanup();
});

test("B04 the featured selection is independent of collections", async () => {
  await cleanup();
  const ids = await products(2);
  const slug = `${PREFIX}-collection`;
  await prisma.collectionDefinition.deleteMany({ where: { slug } });
  await prisma.collectionDefinition.create({
    data: { slug, title: "Independent", featuredProductSlugs: [`${PREFIX}-001`, `${PREFIX}-000`] },
  });
  assert.equal((await replace([ids[0]!])).ok, true);
  const collection = await prisma.collectionDefinition.findUniqueOrThrow({ where: { slug } });
  assert.deepEqual(collection.featuredProductSlugs, [`${PREFIX}-001`, `${PREFIX}-000`], "a collection is not rewritten");
  assert.deepEqual(await order(), [ids[0]], "and the collection's pins are not copied in");
  await prisma.collectionDefinition.deleteMany({ where: { slug } });
  await cleanup();
});
