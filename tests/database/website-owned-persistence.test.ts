import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../src/generated/prisma/client.ts";
import { deleteOrdersWithCapacity } from "../support/order-cleanup.ts";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required for database smoke tests");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const testShopId = 920_005;
const userId = "website-owned-persistence-user";
const userEmail = "website-owned-persistence@example.invalid";
const productExternalId = "website-owned-persistence-product";
const variationExternalId = "website-owned-persistence-variation";

async function cleanup() {
  await deleteOrdersWithCapacity(prisma, { where: { userId } });
  await prisma.cart.deleteMany({ where: { userId } });
  await prisma.address.deleteMany({ where: { userId } });
  await prisma.productMirror.deleteMany({ where: { pancakeProductId: productExternalId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

test.beforeEach(cleanup);
test.afterEach(cleanup);

test.after(async () => {
  await prisma.$disconnect();
});

test("saved addresses belong to a customer account and are removed with it", async () => {
  await prisma.user.create({
    data: {
      id: userId,
      name: "Persistence Customer",
      email: userEmail,
      emailVerified: false,
      createdAt: new Date("2026-08-09T00:00:00.000Z"),
      updatedAt: new Date("2026-08-09T00:00:00.000Z"),
      addresses: {
        create: {
          label: "Nhà",
          recipientName: "Persistence Customer",
          phone: "0900000000",
          provinceRef: "province-ref",
          districtRef: "district-ref",
          communeRef: "commune-ref",
          detail: "123 Test Street",
        },
      },
    },
    include: { addresses: true },
  });

  assert.equal(await prisma.address.count({ where: { userId } }), 1);

  await prisma.user.delete({ where: { id: userId } });

  assert.equal(await prisma.address.count({ where: { userId } }), 0);
});

test("anonymous cart stores variant identity and enforces one positive row per variant", async () => {
  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: testShopId,
      pancakeProductId: productExternalId,
      slug: productExternalId,
      name: "Persistence Product",
      syncedAt: new Date("2026-08-09T00:00:00.000Z"),
      variants: {
        create: {
          pancakeVariationId: variationExternalId,
          syncedAt: new Date("2026-08-09T00:00:00.000Z"),
        },
      },
    },
    include: { variants: true },
  });

  const variantId = product.variants[0]?.id;
  assert.ok(variantId);

  const cart = await prisma.cart.create({
    data: {
      expiresAt: new Date("2026-08-16T00:00:00.000Z"),
      items: {
        create: {
          variantId,
          quantity: 2,
        },
      },
    },
    include: { items: true },
  });

  assert.equal(cart.items[0]?.quantity, 2);

  await assert.rejects(
    () =>
      prisma.cartItem.create({
        data: {
          cartId: cart.id,
          variantId,
          quantity: 1,
        },
      }),
    (error: unknown) => error instanceof Error,
  );

  await assert.rejects(
    () =>
      prisma.cart.create({
        data: {
          expiresAt: new Date("2026-08-16T00:00:00.000Z"),
          items: {
            create: {
              variantId,
              quantity: 0,
            },
          },
        },
      }),
    (error: unknown) => error instanceof Error,
  );
});

test("product editorial content is one-to-one with the Pancake-backed mirror", async () => {
  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: testShopId,
      pancakeProductId: productExternalId,
      slug: productExternalId,
      name: "Persistence Product",
      syncedAt: new Date("2026-08-09T00:00:00.000Z"),
      content: {
        create: {
          editorialDescription: "Clean lines and relaxed proportions.",
          careInstructions: "Cold wash.",
          seoTitle: "Persistence Product | LA Clothing",
        },
      },
    },
    include: { content: true },
  });

  assert.equal(product.content?.editorialDescription, "Clean lines and relaxed proportions.");
  assert.equal(await prisma.productContent.count({ where: { productId: product.id } }), 1);
});

test("local order mirror starts as DRAFT and keeps Pancake order identity optional", async () => {
  await prisma.user.create({
    data: {
      id: userId,
      name: "Persistence Customer",
      email: userEmail,
      emailVerified: false,
      createdAt: new Date("2026-08-09T00:00:00.000Z"),
      updatedAt: new Date("2026-08-09T00:00:00.000Z"),
    },
  });

  const order = await prisma.orderMirror.create({
    data: {
      publicCode: "WEB-TEST-0001",
      userId,
    },
  });

  assert.equal(order.state, "DRAFT");
  assert.equal(order.pancakeOrderId, null);
});
