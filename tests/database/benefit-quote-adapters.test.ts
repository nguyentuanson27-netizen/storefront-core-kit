import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { evaluateBenefitEligibility } from "../../src/commerce/benefit-eligibility.ts";
import {
  benefitQuoteFactsFromPersistedOrder,
  buildBenefitQuoteFacts,
  toBenefitOrderRows,
} from "../../src/commerce/benefit-quote-adapters.ts";
import { issueBenefitQuoteProof, verifyBenefitQuoteProof } from "../../src/commerce/benefit-quote-proof.ts";
import { DEFAULT_GUEST_SHIPPING_POLICY } from "../../src/commerce/guest-shipping-policy.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";
import { deleteOrdersWithCapacity } from "../support/order-cleanup.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const PREFIX = "benefit-quote-adapters";
const secret = "test-server-secret-at-least-32-characters-long";
const cartId = "0f8d3c2a-4b1e-4d7a-9c6b-2e5f1a8d4c30";

test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

async function cleanup() {
  await deleteOrdersWithCapacity(prisma, { where: { publicCode: { startsWith: PREFIX } } });
}

/** The completed guest snapshot every order with totals carries (OrderMirror_checkout_snapshot_complete). */
const guestSnapshot = {
  checkoutSnapshottedAt: new Date("2026-10-18T00:00:00.000Z"),
  guestName: "Khách thử",
  guestPhone: "0900000000",
  provinceRef: "p",
  districtRef: "d",
  communeRef: "c",
  addressDetail: "1 Đường thử",
};

const variants = new Map([
  ["pancake-x", { variantId: "vx", productName: "Áo X", color: "Đen", size: "M" }],
  ["pancake-y", { variantId: "vy", productName: "Quần Y", color: null, size: "L" }],
]);

function giftQuote() {
  const evaluation = evaluateBenefitEligibility({
    lines: [
      { lineKey: "vx", quantity: 1, unitPriceVnd: 500_000, legacy: "NONE", campaignIds: ["camp-1"] },
      { lineKey: "vy", quantity: 2, unitPriceVnd: 100_000, legacy: "NONE", campaignIds: [] },
    ],
    campaigns: [{ id: "camp-1", tiers: [{ minEligibleQuantity: null, minBasisVnd: 500_000, percentageValue: null }] }],
    shippingPolicy: DEFAULT_GUEST_SHIPPING_POLICY,
  });
  return buildBenefitQuoteFacts({
    paidLines: [
      { lineKey: "vx", variantExternalId: "pancake-x", quantity: 1 },
      { lineKey: "vy", variantExternalId: "pancake-y", quantity: 2 },
    ],
    gifts: [{ giftKey: "vx", variantExternalId: "pancake-x", quantity: 1, entitlementKey: "gift-1" }],
    evaluation,
  });
}

test("A04 a synthetic gift order written through the adapter reads back to the exact rendered proof", async () => {
  await cleanup();
  const facts = giftQuote();
  const rendered = issueBenefitQuoteProof({ quote: facts, cartId, secret })!;
  const { order, lines } = toBenefitOrderRows(facts, { id: "camp-1", kind: "GIFT_ITEM", name: "Mua 1 tặng 1" }, variants);

  const created = await prisma.orderMirror.create({
    data: { publicCode: `${PREFIX}-gift`, ...guestSnapshot, ...order, lines: { create: lines } },
  });

  const stored = await prisma.orderMirror.findUniqueOrThrow({ where: { id: created.id }, include: { lines: true } });
  assert.equal(stored.lines.length, 3);
  const rebuilt = benefitQuoteFactsFromPersistedOrder(stored, stored.lines);
  assert.ok(rebuilt, "a complete v2 order rebuilds");
  assert.deepEqual(verifyBenefitQuoteProof({ proof: rendered, cartId, currentQuote: rebuilt, secret }), { ok: true });
  assert.equal(issueBenefitQuoteProof({ quote: rebuilt, cartId, secret }), rendered, "byte-identical after a database round trip");

  // PAID X and GIFT X of one variation are two stored lines with stable audit facts.
  const x = stored.lines.filter((line) => line.pancakeVariationId === "pancake-x");
  assert.deepEqual(x.map((line) => line.lineRole).sort(), ["GIFT", "PAID"]);
  const giftRow = x.find((line) => line.lineRole === "GIFT")!;
  assert.equal(giftRow.entitlementKey, "gift-1");
  assert.equal(giftRow.benefitKind, "GIFT_ITEM");
  assert.equal(Number(giftRow.unitPriceVnd), 0);
  await cleanup();
});

test("A04 a legacy order written the old way is never re-read as a benefit quote, and is untouched", async () => {
  await cleanup();
  const created = await prisma.orderMirror.create({
    data: {
      publicCode: `${PREFIX}-legacy`,
      ...guestSnapshot,
      merchandiseSubtotalVnd: BigInt(700_000),
      shippingFeeVnd: BigInt(0),
      totalVnd: BigInt(700_000),
      lines: {
        create: [
          {
            variantId: "vx",
            pancakeVariationId: "pancake-x",
            productName: "Áo X",
            size: "M",
            quantity: 1,
            unitPriceVnd: BigInt(500_000),
            lineTotalVnd: BigInt(500_000),
          },
        ],
      },
    },
    include: { lines: true },
  });
  assert.equal(created.quoteVersion, null);
  assert.ok(created.lines.every((line) => line.lineId === null && line.lineRole === null));
  assert.equal(benefitQuoteFactsFromPersistedOrder(created, created.lines), null);
  await cleanup();
});

test("A04 a no-grant order stores no campaign facts and still rebuilds", async () => {
  await cleanup();
  const evaluation = evaluateBenefitEligibility({
    lines: [{ lineKey: "vx", quantity: 1, unitPriceVnd: 500_000, legacy: "NONE", campaignIds: [] }],
    campaigns: [],
    shippingPolicy: DEFAULT_GUEST_SHIPPING_POLICY,
  });
  const facts = buildBenefitQuoteFacts({
    paidLines: [{ lineKey: "vx", variantExternalId: "pancake-x", quantity: 1 }],
    gifts: [],
    evaluation,
  });
  const { order, lines } = toBenefitOrderRows(facts, null, variants);
  const created = await prisma.orderMirror.create({
    data: { publicCode: `${PREFIX}-nogrant`, ...guestSnapshot, ...order, lines: { create: lines } },
    include: { lines: true },
  });
  assert.equal(created.benefitCampaignId, null);
  const rebuilt = benefitQuoteFactsFromPersistedOrder(created, created.lines);
  assert.equal(
    issueBenefitQuoteProof({ quote: rebuilt!, cartId, secret }),
    issueBenefitQuoteProof({ quote: facts, cartId, secret }),
  );
  await cleanup();
});
