import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { readMetaPurchaseSnapshot } from "../../src/commerce/meta-purchase-snapshot.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";
import { deleteOrdersWithCapacity } from "../support/order-cleanup.ts";

// The pixel id is captured when the config module first loads, because the Content-Security-Policy
// is built from the same value and the two must agree. Setting it after the fact would be a no-op,
// so it is set here and the reporting module is pulled in afterwards. This is the key next.config
// inlines at build time, which is what the config module actually reads.
process.env.LA_BUILD_FACEBOOK_PIXEL_ID = "123456789012345";
const { reportMetaPurchase, reportMetaPurchaseSafely } = await import(
  "../../src/commerce/meta-purchase-reporting.ts"
);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for database smoke tests");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const shopId = 910_090;
const orderCode = "META-TEST-0001";
const syncedAt = new Date("2026-08-29T03:00:00.000Z");

const requestContext = {
  clientIpAddress: "203.0.113.9",
  clientUserAgent: "Mozilla/5.0",
  fbp: "fb.1.1700000000000.1234567890",
  fbc: "fb.1.1700000000000.AbCd",
  eventSourceUrl: "https://example.test/checkout",
} as const;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function cleanup() {
  await deleteOrdersWithCapacity(prisma, { where: { publicCode: orderCode } });
  await prisma.productMirror.deleteMany({ where: { pancakeShopId: shopId } });
}

async function seedConfirmedOrder(state: "CONFIRMED" | "DRAFT" = "CONFIRMED") {
  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: "meta-product",
      slug: "meta-linen-shirt",
      name: "Áo Linen",
      isPresent: true,
      isActive: true,
      syncedAt,
    },
  });
  const variant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: "meta-variation",
      productId: product.id,
      color: "Ink",
      size: "M",
      isPresent: true,
      isActive: true,
      pancakeRetailPrice: 449_000,
      pancakeRetailPriceAfterDiscount: 449_000,
      syncedAt,
    },
  });
  const order = await prisma.orderMirror.create({
    data: {
      publicCode: orderCode,
      state,
      checkoutSnapshottedAt: syncedAt,
      guestName: "Nguyễn Văn An",
      guestPhone: "0912345678",
      provinceRef: "1",
      districtRef: "2",
      communeRef: "3",
      addressDetail: "12 Nguyễn Huệ",
      note: "",
      merchandiseSubtotalVnd: BigInt(898_000),
      shippingFeeVnd: BigInt(30_000),
      totalVnd: BigInt(928_000),
    },
  });
  await prisma.orderLineSnapshot.create({
    data: {
      orderId: order.id,
      variantId: variant.id,
      pancakeVariationId: variant.pancakeVariationId,
      productName: "Áo Linen",
      color: "Ink",
      size: "M",
      quantity: 2,
      unitPriceVnd: BigInt(449_000),
      lineTotalVnd: BigInt(898_000),
    },
  });
}

/** The access token is read per call, so it is what turns server reporting on and off here. */
function withConversionsEnv<T>(run: () => Promise<T>): Promise<T> {
  process.env.FACEBOOK_CAPI_ACCESS_TOKEN = "test-token";
  return run().finally(() => {
    delete process.env.FACEBOOK_CAPI_ACCESS_TOKEN;
  });
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => prisma.$disconnect());

test("the purchase snapshot reports the order total and its lines by catalog slug", async () => {
  await seedConfirmedOrder();

  assert.deepEqual(await readMetaPurchaseSnapshot(prisma, orderCode), {
    // The reported value is what the buyer paid, shipping included.
    valueVnd: 928_000,
    contents: [{ id: "meta-linen-shirt", quantity: 2, itemPrice: 449_000 }],
  });
});

test("an order that is not confirmed is not a sale", async () => {
  await seedConfirmedOrder("DRAFT");

  assert.equal(await readMetaPurchaseSnapshot(prisma, orderCode), null);
  assert.equal(await readMetaPurchaseSnapshot(prisma, "NO-SUCH-ORDER"), null);
});

test("an order with a line it cannot describe exactly is not reported at all", async () => {
  await seedConfirmedOrder();
  const order = await prisma.orderMirror.findUniqueOrThrow({
    where: { publicCode: orderCode },
    select: { id: true },
  });
  // Past Number's exact range the price cannot be reported, and reporting the order without the
  // line would contradict its own total.
  await prisma.orderLineSnapshot.updateMany({
    where: { orderId: order.id },
    data: { unitPriceVnd: BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1) },
  });

  assert.equal(await readMetaPurchaseSnapshot(prisma, orderCode), null);
});

test("the server event carries hashed identity and the order code as its dedup id", async () => {
  await seedConfirmedOrder();

  const requests: Array<{ url: string; body: unknown }> = [];
  const reportedAt = new Date("2026-08-29T04:00:00.000Z");
  await withConversionsEnv(() =>
    reportMetaPurchase(prisma, orderCode, requestContext, {
      now: reportedAt,
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return new Response("{}", { status: 200 });
      },
    }),
  );

  assert.equal(requests.length, 1);
  const request = requests[0]!;
  assert.equal(request.url, "https://graph.facebook.com/v21.0/123456789012345/events");

  const body = request.body as { data: Array<Record<string, unknown>> };
  const event = body.data[0]!;
  assert.equal(event.event_name, "Purchase");
  // Same id the browser pixel sends, which is what stops this counting as a second sale.
  assert.equal(event.event_id, orderCode);
  // Meta wants whole seconds, not milliseconds.
  assert.equal(event.event_time, Math.floor(reportedAt.getTime() / 1000));
  assert.deepEqual(event.custom_data, {
    currency: "VND",
    value: 928_000,
    contents: [{ id: "meta-linen-shirt", quantity: 2, item_price: 449_000 }],
    content_type: "product",
  });

  const userData = event.user_data as Record<string, unknown>;
  assert.deepEqual(userData.ph, [sha256("84912345678")]);
  assert.deepEqual(userData.fn, [sha256("an")]);
  assert.equal(userData.fbp, requestContext.fbp);

  // The buyer's phone and name must never leave in the clear.
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes("0912345678"), false);
  assert.equal(serialized.includes("Nguyễn"), false);
});

test("nothing is sent when the Conversions API has no access token", async () => {
  await seedConfirmedOrder();

  let called = false;
  await reportMetaPurchase(prisma, orderCode, requestContext, {
    fetchImpl: async () => {
      called = true;
      return new Response("{}", { status: 200 });
    },
  });

  assert.equal(called, false);
});

test("a reporting failure never reaches the checkout that triggered it", async () => {
  await seedConfirmedOrder();

  await withConversionsEnv(async () => {
    // Must resolve, not reject: the sale is already complete by the time this runs.
    await reportMetaPurchaseSafely(prisma, orderCode, requestContext, {
      fetchImpl: async () => {
        throw new Error("Meta is unreachable");
      },
    });
  });
});
