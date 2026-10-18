import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { computeNewArrivalsPaging } from "../../src/commerce/new-arrivals-paging.ts";
import {
  countNewArrivalsSelection,
  listNewArrivalsSelection,
  readNewArrivalsPageProductIds,
  readNewArrivalsRevision,
  replaceNewArrivalsSelection,
} from "../../src/commerce/new-arrivals-selection-repository.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const SHOP_ID = 999_004;
const EARLY = new Date("2026-01-01T00:00:00.000Z");
const PREFIX = "new-arrivals-selection";

test.after(async () => {
  await prisma.$disconnect();
});

async function cleanup() {
  // The selection table belongs to this feature alone, so clearing it is safe between tests.
  await prisma.newArrivalsSelection.deleteMany();
  await prisma.productMirror.deleteMany({ where: { pancakeProductId: { startsWith: PREFIX } } });
}

async function products(count: number, tag = "p"): Promise<string[]> {
  await prisma.productMirror.createMany({
    data: Array.from({ length: count }, (_unused, index) => {
      const id = `${PREFIX}-${tag}-${String(index).padStart(4, "0")}`;
      return { pancakeShopId: SHOP_ID, pancakeProductId: id, slug: id, name: id, syncedAt: EARLY };
    }),
  });
  const rows = await prisma.productMirror.findMany({
    where: { pancakeProductId: { startsWith: `${PREFIX}-${tag}-` } },
    orderBy: { pancakeProductId: "asc" },
    select: { id: true },
  });
  return rows.map(({ id }) => id);
}

async function replace(productIds: string[], expected?: bigint) {
  return replaceNewArrivalsSelection(prisma, {
    productIds,
    expectedRevision: expected ?? (await readNewArrivalsRevision(prisma)),
    updatedByUserId: null,
  });
}

test("B01 an ordered selection round-trips and the revision advances", async () => {
  await cleanup();
  const ids = await products(5);
  const before = await readNewArrivalsRevision(prisma);

  const order = [ids[3]!, ids[0]!, ids[4]!];
  const result = await replace(order, before);
  assert.deepEqual(result, { ok: true, revision: before + BigInt(1) });
  assert.deepEqual(
    (await listNewArrivalsSelection(prisma)).map(({ productId }) => productId),
    order,
  );
  assert.deepEqual(
    (await listNewArrivalsSelection(prisma)).map(({ position }) => position),
    [0, 1, 2],
    "positions are dense",
  );
  assert.equal(await countNewArrivalsSelection(prisma), 3);
  await cleanup();
});

test("B01 reordering is atomic even though two rows pass through the same position", async () => {
  await cleanup();
  const ids = await products(4);
  assert.equal((await replace(ids)).ok, true);

  // A full reversal moves every row; with a non-deferred unique this would fail mid-way.
  const reversed = [...ids].reverse();
  assert.equal((await replace(reversed)).ok, true);
  assert.deepEqual((await listNewArrivalsSelection(prisma)).map(({ productId }) => productId), reversed);
  await cleanup();
});

test("B01 removing, adding and clearing work in one replace", async () => {
  await cleanup();
  const ids = await products(4);
  assert.equal((await replace([ids[0]!, ids[1]!, ids[2]!])).ok, true);
  assert.equal((await replace([ids[2]!, ids[3]!])).ok, true);
  assert.deepEqual((await listNewArrivalsSelection(prisma)).map(({ productId }) => productId), [ids[2], ids[3]]);
  assert.equal((await replace([])).ok, true);
  assert.equal(await countNewArrivalsSelection(prisma), 0);
  await cleanup();
});

test("B01 pages are sliced by stored rank: 49 slots => 24 / 24 / 1 with no overlap", async () => {
  await cleanup();
  const ids = await products(49);
  assert.equal((await replace(ids)).ok, true);

  const seen: string[] = [];
  for (const page of [1, 2, 3]) {
    const paging = computeNewArrivalsPaging(await countNewArrivalsSelection(prisma), page)!;
    const slice = await readNewArrivalsPageProductIds(prisma, paging);
    assert.equal(slice.length, page === 3 ? 1 : 24);
    seen.push(...slice);
  }
  assert.deepEqual(seen, ids, "every slot exactly once, in stored order");
  assert.deepEqual(await readNewArrivalsPageProductIds(prisma, { offset: 0, limit: 9999 }), ids.slice(0, 24), "limit is clamped");
  assert.deepEqual(await readNewArrivalsPageProductIds(prisma, { offset: -1, limit: 24 }), []);
  await cleanup();
});

test("B01 500 slots are accepted and 501 is refused before touching the database", async () => {
  await cleanup();
  const ids = await products(501);
  assert.equal((await replace(ids.slice(0, 500))).ok, true);
  assert.equal(await countNewArrivalsSelection(prisma), 500);
  assert.deepEqual(await replace(ids), { ok: false, reason: "TOO_MANY" });
  assert.equal(await countNewArrivalsSelection(prisma), 500, "the refused write changed nothing");
  await cleanup();
});

test("B01 the database itself enforces the ceiling, uniqueness and shape", async () => {
  await cleanup();
  const ids = await products(3);
  const slot = (productId: string, position: number) =>
    prisma.newArrivalsSelection.create({ data: { productId, position } });

  await assert.rejects(slot(ids[0]!, 500), /position_range|check/i, "position 500 would be the 501st slot");
  await assert.rejects(slot(ids[0]!, -1), /position_range|check/i);

  await slot(ids[0]!, 0);
  await assert.rejects(slot(ids[1]!, 0), /unique|position_key/i, "duplicate position");
  await assert.rejects(slot(ids[0]!, 1), /unique|productId/i, "duplicate product");
  await assert.rejects(slot("no-such-product", 2), /foreign key|fkey/i);
  await cleanup();
});

test("B01 refusals: duplicates, unknown products, invalid input — nothing is written", async () => {
  await cleanup();
  const ids = await products(2);
  assert.equal((await replace([ids[0]!])).ok, true);

  assert.deepEqual(await replace([ids[1]!, ids[1]!]), { ok: false, reason: "DUPLICATE_PRODUCT" });
  assert.deepEqual(await replace([ids[1]!, "does-not-exist"]), { ok: false, reason: "UNKNOWN_PRODUCT" });
  assert.deepEqual(await replace([""]), { ok: false, reason: "INVALID" });
  assert.deepEqual(
    await replaceNewArrivalsSelection(prisma, {
      productIds: [ids[1]!],
      expectedRevision: 1 as unknown as bigint,
      updatedByUserId: null,
    }),
    { ok: false, reason: "INVALID" },
  );
  assert.deepEqual((await listNewArrivalsSelection(prisma)).map(({ productId }) => productId), [ids[0]]);
  await cleanup();
});

test("B01 a stale editor is refused instead of overwriting a newer order", async () => {
  await cleanup();
  const ids = await products(3);
  const start = await readNewArrivalsRevision(prisma);

  assert.equal((await replace([ids[0]!], start)).ok, true);
  assert.deepEqual(await replace([ids[1]!, ids[2]!], start), { ok: false, reason: "STALE_REVISION" });
  assert.deepEqual((await listNewArrivalsSelection(prisma)).map(({ productId }) => productId), [ids[0]]);
  await cleanup();
});

test("B01 two concurrent writers from the same revision: exactly one wins", async () => {
  await cleanup();
  const ids = await products(4);
  const start = await readNewArrivalsRevision(prisma);

  const results = await Promise.all([
    replace([ids[0]!, ids[1]!], start),
    replace([ids[3]!, ids[2]!], start),
  ]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => !result.ok && result.reason === "STALE_REVISION").length, 1);
  assert.equal(await countNewArrivalsSelection(prisma), 2);
  assert.equal(await readNewArrivalsRevision(prisma), start + BigInt(1));
  await cleanup();
});

test("B01 deleting a product removes its slot and later slots keep their relative order", async () => {
  await cleanup();
  const ids = await products(4);
  assert.equal((await replace(ids)).ok, true);

  await prisma.productMirror.delete({ where: { id: ids[1]! } });
  assert.deepEqual(
    (await listNewArrivalsSelection(prisma)).map(({ productId }) => productId),
    [ids[0], ids[2], ids[3]],
  );
  // Pages are by rank, so the remaining slots are still contiguous for paging.
  assert.deepEqual(await readNewArrivalsPageProductIds(prisma, { offset: 1, limit: 24 }), [ids[2], ids[3]]);
  await cleanup();
});

test("B01 removing the admin who placed a slot keeps the slot", async () => {
  await cleanup();
  const ids = await products(1);
  const userId = `${PREFIX}-admin`;
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.user.create({
    data: {
      id: userId,
      name: "Curator",
      email: `${userId}@example.test`,
      emailVerified: true,
      createdAt: EARLY,
      updatedAt: EARLY,
    },
  });
  const revision = await readNewArrivalsRevision(prisma);
  assert.equal(
    (await replaceNewArrivalsSelection(prisma, { productIds: ids, expectedRevision: revision, updatedByUserId: userId })).ok,
    true,
  );
  await prisma.user.delete({ where: { id: userId } });
  const rows = await prisma.newArrivalsSelection.findMany();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.updatedByUserId, null);
  await cleanup();
});
