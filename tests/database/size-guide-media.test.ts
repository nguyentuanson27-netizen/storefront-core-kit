import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import {
  listSizeGuideMedia,
  removeSizeGuideMedia,
  saveSizeGuideMedia,
} from "../../src/commerce/size-guide-media-repository.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const KEY = "size-guide-media-test";
const GOOD = "https://content.pancake.vn/1/2/3/4/photo-1.jpg";

test.after(async () => {
  await prisma.sizeGuideMedia.deleteMany({ where: { guideKey: { startsWith: KEY } } });
  await prisma.$disconnect();
});

const media = (suffix: string, overrides: Record<string, unknown> = {}) => ({
  guideKey: `${KEY}-${suffix}`,
  imageUrl: GOOD,
  altText: "Sơ đồ đo",
  width: 1200,
  height: 800,
  ...overrides,
});
const mine = async () => (await listSizeGuideMedia(prisma)).filter((row) => row.guideKey.startsWith(KEY));

test("B06 save, replace and remove one chart's image", async () => {
  await prisma.sizeGuideMedia.deleteMany({ where: { guideKey: { startsWith: KEY } } });
  await saveSizeGuideMedia(prisma, media("a"), null);
  assert.deepEqual(await mine(), [media("a")]);

  await saveSizeGuideMedia(prisma, media("a", { altText: "Đã sửa", width: 600 }), null);
  const [row] = await mine();
  assert.equal(row!.altText, "Đã sửa");
  assert.equal(row!.width, 600);
  assert.equal((await mine()).length, 1, "one row per chart");

  await removeSizeGuideMedia(prisma, media("a").guideKey);
  assert.deepEqual(await mine(), []);
  await removeSizeGuideMedia(prisma, "never-stored");
});

test("B06 the database refuses what the application should never hand it", async () => {
  const create = (overrides: Record<string, unknown>) =>
    prisma.sizeGuideMedia.create({ data: media("bad", overrides) as never });

  await assert.rejects(create({ imageUrl: "http://content.pancake.vn/1/2/3/4/photo-1.jpg" }), /imageUrl_https|check/i);
  await assert.rejects(create({ imageUrl: "javascript:alert(1)" }), /imageUrl_https|check/i);
  await assert.rejects(create({ imageUrl: `https://content.pancake.vn/${"a".repeat(2100)}` }), /imageUrl_https|check/i);
  await assert.rejects(create({ altText: "" }), /altText_length|check/i);
  await assert.rejects(create({ altText: "x".repeat(301) }), /altText_length|check/i);
  await assert.rejects(create({ width: 0 }), /dimensions|check/i);
  await assert.rejects(create({ width: 8001 }), /dimensions|check/i);
  await assert.rejects(create({ height: 0 }), /dimensions|check/i);
  await assert.rejects(create({ height: 8001 }), /dimensions|check/i);
  await assert.rejects(create({ guideKey: "" }), /guideKey_length|check/i);
  await assert.rejects(create({ guideKey: "k".repeat(65) }), /guideKey_length|check/i);
  assert.deepEqual(await mine(), []);
});

test("B06 removing the admin who set an image keeps the image", async () => {
  const userId = `${KEY}-admin`;
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.user.create({
    data: {
      id: userId,
      name: "Curator",
      email: `${userId}@example.test`,
      emailVerified: true,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
  await saveSizeGuideMedia(prisma, media("keep"), userId);
  await prisma.user.delete({ where: { id: userId } });
  const row = await prisma.sizeGuideMedia.findUniqueOrThrow({ where: { guideKey: media("keep").guideKey } });
  assert.equal(row.updatedByUserId, null);
  await removeSizeGuideMedia(prisma, row.guideKey);
});
