import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createSellingPolicyRepository, readStoredSellingPolicies } from "../../src/commerce/selling-policy-repository.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const repository = createSellingPolicyRepository(prisma);
const SHOP_ID = 999_031;
const EARLY = new Date("2026-01-01T00:00:00.000Z");

test.after(async () => {
  await prisma.$disconnect();
});

function fixture(key: string) {
  const prefix = `selling-policy-${key}`;

  async function cleanup() {
    await prisma.productMirror.deleteMany({ where: { pancakeProductId: { startsWith: prefix } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
  }

  async function product(name: string, variantCount = 1) {
    const id = `${prefix}-${name}`;
    const created = await prisma.productMirror.create({
      data: { pancakeShopId: SHOP_ID, pancakeProductId: id, slug: id, name, syncedAt: EARLY },
    });
    for (let index = 0; index < variantCount; index += 1) {
      await prisma.variantMirror.create({
        data: {
          id: `${id}-v${index}`,
          pancakeVariationId: `${id}-v${index}`,
          productId: created.id,
          isPresent: true,
          isActive: true,
          syncedAt: EARLY,
        },
      });
    }
    return created.id;
  }

  async function admin(name: string) {
    const id = `${prefix}-${name}`;
    const now = new Date();
    await prisma.user.create({
      data: { id, name, email: `${id}@example.test`, emailVerified: true, role: "ADMIN", createdAt: now, updatedAt: now },
    });
    return id;
  }

  return { cleanup, product, admin };
}

test("a policy is stored with its actor, read back through the repository, and reset by deleting the row", async (t) => {
  const f = fixture("roundtrip");
  await f.cleanup();
  t.after(f.cleanup);
  const productId = await f.product("tee");
  const actor = await f.admin("owner");

  assert.equal(await repository.readStoredPolicy(productId), null);

  await repository.saveSellingPolicy(productId, { kind: "SET", sellingMode: "OVERSELL", negativeStockLimit: -12 }, actor);
  assert.deepEqual(await repository.readStoredPolicy(productId), { sellingMode: "OVERSELL", negativeStockLimit: -12 });
  const row = await prisma.productSellingPolicy.findUniqueOrThrow({ where: { productId } });
  assert.equal(row.updatedByUserId, actor);

  await repository.saveSellingPolicy(productId, { kind: "SET", sellingMode: "STANDARD", negativeStockLimit: 0 }, actor);
  assert.deepEqual(
    await readStoredSellingPolicies(prisma, [productId, productId, "missing"]),
    new Map([[productId, { sellingMode: "STANDARD", negativeStockLimit: 0 }]]),
  );

  await repository.saveSellingPolicy(productId, { kind: "RESET" }, actor);
  assert.equal(await prisma.productSellingPolicy.count({ where: { productId } }), 0);
  assert.equal(await repository.readStoredPolicy(productId), null);
});

test("deleting the product cascades; deleting the actor keeps the policy with no actor", async (t) => {
  const f = fixture("cascade");
  await f.cleanup();
  t.after(f.cleanup);
  const kept = await f.product("kept");
  const dropped = await f.product("dropped");
  const actor = await f.admin("leaver");
  for (const productId of [kept, dropped]) {
    await repository.saveSellingPolicy(productId, { kind: "SET", sellingMode: "OVERSELL", negativeStockLimit: -20 }, actor);
  }

  await prisma.user.delete({ where: { id: actor } });
  const orphaned = await prisma.productSellingPolicy.findUniqueOrThrow({ where: { productId: kept } });
  assert.equal(orphaned.updatedByUserId, null);
  assert.equal(orphaned.sellingMode, "OVERSELL");

  await prisma.productMirror.delete({ where: { id: dropped } });
  assert.equal(await prisma.productSellingPolicy.count({ where: { productId: dropped } }), 0);
});

test("the database refuses a policy for a missing product and a limit outside [-100000, 0]", async (t) => {
  const f = fixture("constraints");
  await f.cleanup();
  t.after(f.cleanup);
  const productId = await f.product("tee");

  await assert.rejects(
    prisma.$executeRaw`INSERT INTO "ProductSellingPolicy" ("productId", "sellingMode", "negativeStockLimit", "updatedAt")
      VALUES ('selling-policy-constraints-nope', 'OVERSELL', -1, now())`,
    /foreign key|ProductSellingPolicy_productId_fkey/i,
  );
  for (const limit of [1, -100_001]) {
    await assert.rejects(
      prisma.$executeRaw`INSERT INTO "ProductSellingPolicy" ("productId", "sellingMode", "negativeStockLimit", "updatedAt")
        VALUES (${productId}, 'OVERSELL', ${limit}, now())`,
      /ProductSellingPolicy_negativeStockLimit_range/,
      String(limit),
    );
  }
  for (const limit of [0, -100_000]) {
    await prisma.$executeRaw`INSERT INTO "ProductSellingPolicy" ("productId", "sellingMode", "negativeStockLimit", "updatedAt")
      VALUES (${productId}, 'PREORDER', ${limit}, now())
      ON CONFLICT ("productId") DO UPDATE SET "negativeStockLimit" = EXCLUDED."negativeStockLimit"`;
  }
  assert.equal((await prisma.productSellingPolicy.findUniqueOrThrow({ where: { productId } })).negativeStockLimit, -100_000);
});

test("a policy write waits for a checkout holding the product's variant rows", async (t) => {
  const f = fixture("lock");
  await f.cleanup();
  t.after(f.cleanup);
  const productId = await f.product("tee", 2);
  const actor = await f.admin("owner");

  let releaseCheckout!: () => void;
  const checkoutMayCommit = new Promise<void>((resolve) => {
    releaseCheckout = resolve;
  });
  let lockHeld!: () => void;
  const checkoutHoldsLock = new Promise<void>((resolve) => {
    lockHeld = resolve;
  });

  // Stands in for `reserveOrderCapacity`: same rows, same ascending-id order.
  const checkout = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "VariantMirror" WHERE "productId" = ${productId} ORDER BY "id" FOR UPDATE`;
      lockHeld();
      await checkoutMayCommit;
    },
    { timeout: 10_000 },
  );
  await checkoutHoldsLock;

  let written = false;
  const write = repository
    .saveSellingPolicy(productId, { kind: "SET", sellingMode: "OVERSELL", negativeStockLimit: -20 }, actor)
    .then(() => {
      written = true;
    });

  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(written, false, "the policy write must wait for the checkout's lock");
  assert.equal(await prisma.productSellingPolicy.count({ where: { productId } }), 0);

  releaseCheckout();
  await checkout;
  await write;
  assert.equal(written, true);
  assert.equal((await repository.readStoredPolicy(productId))?.sellingMode, "OVERSELL");
});

test("composite parents and the operator report are read from the mirror", async (t) => {
  const f = fixture("report");
  await f.cleanup();
  t.after(f.cleanup);
  const plain = await f.product("plain");
  const set = await f.product("set");
  const actor = await f.admin("owner");
  await prisma.compositeComponentMirror.create({
    data: {
      parentVariantId: "selling-policy-report-set-v0",
      componentVariantId: "selling-policy-report-plain-v0",
      quantity: 1,
      syncedAt: EARLY,
    },
  });

  assert.equal(await repository.productHasCompositeParent(set), true);
  assert.equal(await repository.productHasCompositeParent(plain), false, "being a component is not being a parent");
  assert.equal(await repository.productExists(plain), true);
  assert.equal(await repository.productExists("selling-policy-report-missing"), false);

  await repository.saveSellingPolicy(plain, { kind: "SET", sellingMode: "OVERSELL", negativeStockLimit: -5 }, actor);
  await repository.saveSellingPolicy(set, { kind: "SET", sellingMode: "STANDARD", negativeStockLimit: 0 }, actor);

  const report = (await repository.readSellingPolicyReport()).filter((row) => row.productId === plain || row.productId === set);
  const byProduct = new Map(report.map((row) => [row.productId, row]));
  assert.deepEqual(byProduct.get(plain)?.stored, { sellingMode: "OVERSELL", negativeStockLimit: -5 });
  assert.deepEqual(
    byProduct.get(plain)?.variants.map((variant) => variant.isCompositeParent),
    [false],
  );
  assert.deepEqual(
    byProduct.get(set)?.variants.map((variant) => variant.isCompositeParent),
    [true],
  );
});
