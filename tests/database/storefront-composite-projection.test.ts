import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createAnonymousCartService } from "../../src/commerce/anonymous-cart.ts";
import { createProductCommerceAdminService } from "../../src/commerce/product-commerce-admin.ts";
import { createProductCommerceRepository } from "../../src/commerce/product-commerce-repository.ts";
import { createGuestCheckoutSnapshotService } from "../../src/commerce/guest-checkout-snapshot.ts";
import { acceptAnyRenderedQuote } from "../fixtures/rendered-quote-authority.ts";
import { createStorefrontCartRepository } from "../../src/commerce/storefront-cart-repository.ts";
import { createStorefrontProductDetailRepository } from "../../src/commerce/storefront-product-detail.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";
import { allowAnyCartLine } from "../fixtures/cart-line-authority.ts";
import { deleteOrdersWithCapacity } from "../support/order-cleanup.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const productRepository = createStorefrontProductDetailRepository(prisma);
const activationSecret = "composite-fixture-confirmation-secret-1234";
const commerceRepository = createProductCommerceRepository(prisma);
// The fixtures drive the same generic activation service the admin editor uses, so a regression
// in the real path shows up here instead of in a service nothing ships.
const commerceService = createProductCommerceAdminService({
  setVariantActivation: commerceRepository.setVariantActivation,
  readCatalogEnableWarningState: commerceRepository.readCatalogEnableWarningState,
  commitCatalogEnable: commerceRepository.commitCatalogEnable,
  disableCatalog: commerceRepository.disableCatalog,
  activateProductAndStockedVariants: commerceRepository.activateProductAndStockedVariants,
  readConfirmationSecret: () => activationSecret,
  nowMs: () => Date.now(),
});
const adminSession = {
  user: { id: "composite-convergence-admin", role: "ADMIN" },
  session: { id: "composite-convergence-session" },
} as const;
const shopId = 910_060;
const cartId = "projection-composite-cart";
const publicCode = "projection-composite-order";
const syncedAt = new Date("2026-08-22T16:00:00.000Z");
const now = new Date("2026-08-23T00:00:00.000Z");

async function cleanup() {
  await deleteOrdersWithCapacity(prisma, { where: { publicCode } });
  await prisma.cart.deleteMany({ where: { id: cartId } });
  await prisma.productMirror.deleteMany({ where: { pancakeShopId: shopId } });
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => prisma.$disconnect());

test("admin activation converges inactive real parent and child through PDP, cart, checkout, and deactivation", async () => {
  const parent = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: "projection-parent-product",
      slug: "projection-set-a",
      name: "Set A",
      isPresent: true,
      isActive: true,
      syncedAt,
    },
  });
  const component = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: "projection-component-product",
      slug: "projection-shirt-a",
      name: "Ao A",
      isPresent: true,
      isActive: false,
      syncedAt,
    },
  });

  const parentVariant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: "projection-parent-m",
      productId: parent.id,
      size: "M",
      isPresent: true,
      isActive: false,
      pancakeRetailPrice: 790_000,
      pancakeRetailPriceAfterDiscount: 790_000,
      syncedAt,
    },
  });
  const componentVariant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: "projection-component-m",
      productId: component.id,
      color: null,
      size: "M",
      isPresent: true,
      isActive: false,
      pancakeRetailPrice: 390_000,
      pancakeRetailPriceAfterDiscount: 390_000,
      syncedAt,
    },
  });

  await prisma.warehouseStock.createMany({
    data: [
      {
        variantId: parentVariant.id,
        pancakeWarehouseId: "projection-warehouse-parent",
        quantity: 2,
        syncedAt,
      },
      {
        variantId: componentVariant.id,
        pancakeWarehouseId: "projection-warehouse-component",
        quantity: 3,
        syncedAt,
      },
    ],
  });
  await prisma.compositeComponentMirror.create({
    data: {
      parentVariantId: parentVariant.id,
      componentVariantId: componentVariant.id,
      quantity: 1,
      syncedAt,
    },
  });

  const beforeActivation = await productRepository.getProductBySlug({
    shopId,
    slug: "projection-set-a",
  });
  assert.ok(beforeActivation);
  assert.equal(beforeActivation.projection.mode, "standalone");
  assert.deepEqual(beforeActivation.projection.options, []);
  assert.equal(
    await productRepository.getProductBySlug({ shopId, slug: "projection-shirt-a" }),
    null,
  );

  assert.deepEqual(
    await commerceService.setVariantActivation(adminSession, component.id, {
      variantIds: [componentVariant.id],
      isActive: true,
    }),
    {
      ok: true,
      variantIds: [componentVariant.id],
      isActive: true,
    },
  );

  const childOnlyActivated = await productRepository.getProductBySlug({
    shopId,
    slug: "projection-set-a",
  });
  assert.ok(childOnlyActivated);
  assert.equal(childOnlyActivated.projection.mode, "standalone");
  assert.deepEqual(childOnlyActivated.projection.options, []);

  assert.deepEqual(
    await commerceService.setVariantActivation(adminSession, parent.id, {
      variantIds: [parentVariant.id],
      isActive: true,
    }),
    {
      ok: true,
      variantIds: [parentVariant.id],
      isActive: true,
    },
  );

  const detail = await productRepository.getProductBySlug({ shopId, slug: "projection-set-a" });
  assert.ok(detail);
  assert.equal(detail.projection.mode, "composite");
  assert.deepEqual(
    detail.projection.options.map(({ id, kindLabel }) => ({ id, kindLabel })),
    [
      { id: parentVariant.id, kindLabel: "Set" },
      { id: componentVariant.id, kindLabel: "Ao A" },
    ],
  );
  assert.equal(
    await productRepository.getProductBySlug({ shopId, slug: "projection-shirt-a" }),
    null,
  );
  assert.equal(
    (
      await prisma.productMirror.findUniqueOrThrow({
        where: { id: component.id },
        select: { isActive: true },
      })
    ).isActive,
    false,
  );

  await prisma.cart.create({
    data: {
      id: cartId,
      expiresAt: new Date("2026-08-24T00:00:00.000Z"),
    },
  });
  const cartService = createAnonymousCartService(prisma);
  const cartMutation = await cartService.setItemQuantity({
    cartId,
    variantId: componentVariant.id,
    quantity: 1,
    now,
  });
  assert.equal(cartMutation.ok, true);

  const lines = await createStorefrontCartRepository(prisma).getLines({
    shopId,
    items: [{ variantId: componentVariant.id, quantity: 1 }],
  });
  assert.deepEqual(
    lines.map(({ productSlug, productName, available, price }) => ({
      productSlug,
      productName,
      available,
      price,
    })),
    [{ productSlug: null, productName: "Ao A", available: true, price: 390_000 }],
  );

  const checkout = createGuestCheckoutSnapshotService(prisma, {
    checkoutInputValidated: true,
    verifyRenderedQuote: acceptAnyRenderedQuote,
  });
  const checkoutResult = await checkout.create({
    cartId,
    shopId,
    publicCode,
    checkoutInput: {
      name: "Nguyen Van A",
      phone: "0901234567",
      provinceRef: "province-01",
      districtRef: "district-01",
      communeRef: "commune-01",
      detail: "12 Duong A",
      note: "",
    },
    now,
  });
  assert.equal(checkoutResult.ok, true);

  const order = await prisma.orderMirror.findUniqueOrThrow({
    where: { publicCode },
    include: { lines: true },
  });
  assert.deepEqual(
    order.lines.map(({ pancakeVariationId, productName, color, size, unitPriceVnd }) => ({
      pancakeVariationId,
      productName,
      color,
      size,
      unitPriceVnd,
    })),
    [
      {
        pancakeVariationId: "projection-component-m",
        productName: "Ao A",
        color: null,
        size: "M",
        unitPriceVnd: BigInt(390_000),
      },
    ],
  );

  assert.deepEqual(
    await commerceService.setVariantActivation(adminSession, component.id, {
      variantIds: [componentVariant.id],
      isActive: false,
    }),
    {
      ok: true,
      variantIds: [componentVariant.id],
      isActive: false,
    },
  );

  const afterDeactivation = await productRepository.getProductBySlug({
    shopId,
    slug: "projection-set-a",
  });
  assert.ok(afterDeactivation);
  assert.deepEqual(
    afterDeactivation.projection.options.map(({ id, kindLabel }) => ({ id, kindLabel })),
    [{ id: parentVariant.id, kindLabel: "Set" }],
  );

  assert.deepEqual(
    await cartService.updateExistingItemQuantity({
      cartId,
      variantId: componentVariant.id,
      quantity: 2,
      now,
      resolveLine: allowAnyCartLine,
    }),
    {
      ok: false,
      reason: "VARIANT_UNAVAILABLE",
    },
  );

  const unavailableLines = await createStorefrontCartRepository(prisma).getLines({
    shopId,
    items: [{ variantId: componentVariant.id, quantity: 1 }],
  });
  assert.deepEqual(
    unavailableLines.map(
      ({ productSlug, productName, available, unavailableReason, price }) => ({
        productSlug,
        productName,
        available,
        unavailableReason,
        price,
      }),
    ),
    [
      {
        productSlug: null,
        productName: "Ao A",
        available: false,
        unavailableReason: "VARIANT_UNAVAILABLE",
        price: null,
      },
    ],
  );
});