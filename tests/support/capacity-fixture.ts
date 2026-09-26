import type { PrismaClient } from "../../src/generated/prisma/client.ts";

type FixtureClient = Pick<PrismaClient, "productMirror" | "variantMirror" | "warehouseStock">;

/** A shop id no storefront fixture uses, so these mirror rows never surface in listing queries. */
const CAPACITY_FIXTURE_SHOP_ID = 999_001;

/**
 * Gives a submission test's order line a real mirrored variant with stock.
 *
 * Submission reserves capacity against `VariantMirror` rows under lock and fails closed on a line
 * whose variant it cannot find, so tests whose subject is something else (events, HTTP status,
 * pricing) need the line's variant to exist with enough mirrored stock. The product is inactive and
 * scoped to an unused shop so it stays out of every storefront surface. Idempotent across reruns.
 */
export async function seedCapacityVariant(
  client: FixtureClient,
  variantId: string,
  { stock = 1_000 }: { stock?: number } = {},
): Promise<void> {
  const syncedAt = new Date("2026-01-01T00:00:00.000Z");
  const product = await client.productMirror.upsert({
    where: { pancakeProductId: `capacity-fixture-product-${variantId}` },
    create: {
      pancakeShopId: CAPACITY_FIXTURE_SHOP_ID,
      pancakeProductId: `capacity-fixture-product-${variantId}`,
      slug: `capacity-fixture-${variantId}`,
      name: "Capacity fixture",
      isActive: false,
      syncedAt,
    },
    update: {},
    select: { id: true },
  });
  await client.variantMirror.upsert({
    where: { id: variantId },
    create: {
      id: variantId,
      pancakeVariationId: `capacity-fixture-${variantId}`,
      productId: product.id,
      isPresent: true,
      isActive: true,
      syncedAt,
    },
    update: { isPresent: true, syncedAt },
  });
  await client.warehouseStock.deleteMany({ where: { variantId } });
  await client.warehouseStock.create({
    data: { variantId, pancakeWarehouseId: "capacity-fixture-warehouse", quantity: stock, syncedAt },
  });
}
