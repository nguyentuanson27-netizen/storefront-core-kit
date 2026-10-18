import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../src/generated/prisma/client.ts";
import { deleteOrdersWithCapacity } from "../support/order-cleanup.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const PREFIX = "benefit-order-schema";

test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

async function cleanup() {
  await deleteOrdersWithCapacity(prisma, { where: { publicCode: { startsWith: PREFIX } } });
}

async function order(name: string, quoteVersion?: number | null) {
  return (
    await prisma.orderMirror.create({
      data: { publicCode: `${PREFIX}-${name}`, ...(quoteVersion === undefined ? {} : { quoteVersion }) },
    })
  ).id;
}

function line(orderId: string, overrides: Record<string, unknown> = {}) {
  return {
    orderId,
    variantId: "variant-x",
    pancakeVariationId: "pancake-x",
    productName: "Áo thử",
    size: "M",
    quantity: 1,
    unitPriceVnd: BigInt(500_000),
    lineTotalVnd: BigInt(500_000),
    ...overrides,
  };
}

const paid = (orderId: string, overrides: Record<string, unknown> = {}) =>
  line(orderId, { lineId: "l1", lineRole: "PAID", benefitCampaignId: "camp-1", benefitKind: "GIFT_ITEM", benefitCampaignName: "Mua 1 tặng 1", ...overrides });
const gift = (orderId: string, overrides: Record<string, unknown> = {}) =>
  line(orderId, {
    lineId: "l2",
    lineRole: "GIFT",
    unitPriceVnd: BigInt(0),
    lineTotalVnd: BigInt(0),
    benefitCampaignId: "camp-1",
    benefitKind: "GIFT_ITEM",
    benefitCampaignName: "Mua 1 tặng 1",
    entitlementKey: "gift-1",
    ...overrides,
  });

const create = (data: Record<string, unknown>) => prisma.orderLineSnapshot.create({ data: data as never });

test("A02 a legacy line, written without the new columns, is accepted and reads back with NULLs", async () => {
  await cleanup();
  const orderId = await order("legacy");
  await create(line(orderId));
  const [row] = await prisma.orderLineSnapshot.findMany({ where: { orderId } });
  assert.equal(row!.lineId, null);
  assert.equal(row!.lineRole, null);
  assert.equal(row!.benefitCampaignId, null);
  assert.equal(row!.entitlementKey, null);
  const found = await prisma.orderMirror.findUniqueOrThrow({ where: { id: orderId } });
  assert.equal(found.quoteVersion, null);
  await cleanup();
});

test("A02 PAID X and GIFT X of the same variation round-trip as two lines with stable audit facts", async () => {
  await cleanup();
  const orderId = await order("pair", 2);
  await create(paid(orderId));
  await create(gift(orderId));

  const rows = await prisma.orderLineSnapshot.findMany({ where: { orderId }, orderBy: { lineId: "asc" } });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => [row.lineId, row.lineRole, row.variantId, Number(row.unitPriceVnd)]), [
    ["l1", "PAID", "variant-x", 500_000],
    ["l2", "GIFT", "variant-x", 0],
  ]);
  assert.equal(rows[1]!.entitlementKey, "gift-1");
  assert.equal(rows[1]!.benefitCampaignName, "Mua 1 tặng 1");
  assert.equal((await prisma.orderMirror.findUniqueOrThrow({ where: { id: orderId } })).quoteVersion, 2);
  await cleanup();
});

test("A02 a legacy order stays readable beside a v2 order", async () => {
  await cleanup();
  const legacy = await order("old");
  const v2 = await order("new", 2);
  await create(line(legacy));
  await create(paid(v2));
  const all = await prisma.orderLineSnapshot.findMany({
    where: { orderId: { in: [legacy, v2] } },
    orderBy: { createdAt: "asc" },
  });
  assert.deepEqual(all.map((row) => row.lineRole), [null, "PAID"]);
  await cleanup();
});

test("A02 lineId is unique within an order but may repeat across orders", async () => {
  await cleanup();
  const first = await order("first", 2);
  const second = await order("second", 2);
  await create(paid(first));
  await assert.rejects(create(gift(first, { lineId: "l1" })), /unique|orderId_lineId/i, "duplicate lineId in one order");
  await create(paid(second));
  assert.equal(await prisma.orderLineSnapshot.count({ where: { orderId: { in: [first, second] } } }), 2);
  await cleanup();
});

test("A02 the database refuses malformed v2 lines", async () => {
  await cleanup();
  const orderId = await order("bad", 2);
  const refuse = (data: Record<string, unknown>, label: string) =>
    assert.rejects(create(data), /v2_shape|check/i, label);

  await refuse(gift(orderId, { unitPriceVnd: BigInt(1), lineTotalVnd: BigInt(1) }), "a gift with a price");
  await refuse(gift(orderId, { lineTotalVnd: BigInt(1) }), "a gift with a line total");
  await refuse(gift(orderId, { benefitCampaignId: null }), "a gift without a campaign");
  await refuse(gift(orderId, { entitlementKey: null }), "a gift without an entitlement");
  await refuse(paid(orderId, { unitPriceVnd: BigInt(0), lineTotalVnd: BigInt(0) }), "a free paid line");
  await refuse(paid(orderId, { entitlementKey: "e" }), "a paid line with an entitlement");
  await refuse(paid(orderId, { lineRole: "BONUS" }), "an unknown role");
  await refuse(paid(orderId, { benefitKind: "OTHER" }), "an unknown campaign kind");
  await refuse(paid(orderId, { lineId: "" }), "an empty lineId");
  await refuse(paid(orderId, { lineId: "x".repeat(65) }), "an oversized lineId");
  await refuse(paid(orderId, { lineId: null }), "a role without a lineId");
  await refuse(line(orderId, { lineId: "l9" }), "a lineId without a role");
  await refuse(line(orderId, { benefitCampaignId: "camp-1" }), "campaign facts on a legacy line");
  assert.equal(await prisma.orderLineSnapshot.count({ where: { orderId } }), 0);
  await cleanup();
});

test("A02 only the known quote versions are accepted", async () => {
  await cleanup();
  await order("v-null", null);
  await order("v-2", 2);
  for (const version of [0, 1, 3, -1]) {
    await assert.rejects(order(`v-${version}`, version), /quoteVersion_known|check/i, String(version));
  }
  await cleanup();
});

test("A02 the granted campaign's frozen facts live on a v2 order only, as a pair, and a tier needs a grant", async () => {
  await cleanup();
  const make = (name: string, data: Record<string, unknown>) =>
    prisma.orderMirror.create({ data: { publicCode: `${PREFIX}-${name}`, ...data } as never });

  await make("facts-ok", { quoteVersion: 2, benefitCampaignId: "camp-1", benefitEligibleQuantity: 2, benefitBasisVnd: BigInt(800_000), benefitTierIndex: 1 });
  await make("facts-no-tier", { quoteVersion: 2, benefitCampaignId: "camp-1", benefitEligibleQuantity: 0, benefitBasisVnd: BigInt(0) });
  await make("facts-no-grant", { quoteVersion: 2 });
  const refuse = (name: string, data: Record<string, unknown>) =>
    assert.rejects(make(name, data), /benefit_facts|check/i, name);

  await refuse("facts-on-legacy", { benefitCampaignId: "camp-1", benefitEligibleQuantity: 1, benefitBasisVnd: BigInt(1) });
  await refuse("facts-only-quantity", { quoteVersion: 2, benefitCampaignId: "camp-1", benefitEligibleQuantity: 1 });
  await refuse("facts-only-campaign", { quoteVersion: 2, benefitCampaignId: "camp-1" });
  await refuse("facts-without-campaign", { quoteVersion: 2, benefitEligibleQuantity: 1, benefitBasisVnd: BigInt(1) });
  await refuse("facts-empty-campaign", { quoteVersion: 2, benefitCampaignId: "", benefitEligibleQuantity: 1, benefitBasisVnd: BigInt(1) });
  await refuse("facts-only-basis", { quoteVersion: 2, benefitBasisVnd: BigInt(1) });
  await refuse("facts-negative-quantity", { quoteVersion: 2, benefitCampaignId: "c", benefitEligibleQuantity: -1, benefitBasisVnd: BigInt(0) });
  await refuse("facts-negative-basis", { quoteVersion: 2, benefitCampaignId: "c", benefitEligibleQuantity: 0, benefitBasisVnd: BigInt(-1) });
  await refuse("facts-tier-without-grant", { quoteVersion: 2, benefitTierIndex: 0 });
  await refuse("facts-tier-8", { quoteVersion: 2, benefitCampaignId: "c", benefitEligibleQuantity: 1, benefitBasisVnd: BigInt(1), benefitTierIndex: 8 });
  await refuse("facts-tier-negative", { quoteVersion: 2, benefitCampaignId: "c", benefitEligibleQuantity: 1, benefitBasisVnd: BigInt(1), benefitTierIndex: -1 });
  await cleanup();
});

test("A02 campaign facts are a snapshot, not a key: no campaign row is needed or touched", async () => {
  await cleanup();
  const orderId = await order("snapshot", 2);
  await create(paid(orderId, { benefitCampaignId: "campaign-that-does-not-exist" }));
  assert.equal(await prisma.orderLineSnapshot.count({ where: { orderId } }), 1);
  await cleanup();
});
