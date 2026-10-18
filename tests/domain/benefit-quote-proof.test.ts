import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  MAX_BENEFIT_GIFT_LINES,
  MAX_BENEFIT_LINE_ID_LENGTH,
  MAX_BENEFIT_PAID_LINES,
  MAX_BENEFIT_QUOTE_PROOF_BYTES,
  MAX_BENEFIT_TIERS,
  areUsableBenefitQuoteFacts,
  issueBenefitQuoteProof,
  verifyBenefitQuoteProof,
  type BenefitQuoteLine,
  type BenefitQuoteProofFacts,
} from "../../src/commerce/benefit-quote-proof.ts";
import { ANONYMOUS_CART_MAX_DISTINCT_ITEMS } from "../../src/commerce/anonymous-cart.ts";
import {
  MAX_RENDERED_QUOTE_PROOF_BYTES,
  issueRenderedQuoteProof,
  verifyRenderedQuoteProof,
  type RenderedQuoteProofFacts,
} from "../../src/commerce/checkout-quote-proof.ts";

const secret = "test-server-secret-at-least-32-characters-long";
const otherSecret = "another-server-secret-at-least-32-characters-long";
const cartId = "0f8d3c2a-4b1e-4d7a-9c6b-2e5f1a8d4c30";
const otherCartId = "9a1b7c6d-3e2f-4a5b-8c9d-1e2f3a4b5c6d";

function line(
  lineId: string,
  role: "PAID" | "GIFT",
  variantExternalId: string,
  quantity: number,
  unitPriceVnd: number,
  campaignId: string | null = null,
  entitlementKey: string | null = null,
): BenefitQuoteLine {
  return {
    lineId,
    role,
    variantExternalId,
    quantity,
    unitPriceVnd,
    lineTotalVnd: quantity * unitPriceVnd,
    campaignId,
    entitlementKey,
  };
}

/** Same facts as tests/domain/fixtures/benefit-quote-proof-reference.py (independent computation). */
const VECTORS: Record<string, { facts: BenefitQuoteProofFacts; proof: string }> = {
  paidAndGiftSameVariant: {
    facts: {
      lines: [
        line("l1", "PAID", "var-x", 1, 500_000, "camp-1"),
        line("l2", "GIFT", "var-x", 1, 0, "camp-1", "gift-1"),
      ],
      grants: [
        {
          campaignId: "camp-1",
          eligiblePaidQuantity: 1,
          basisVnd: 500_000,
          tierIndex: null,
          giftLineCount: 1,
        },
      ],
      paidQuantity: 1,
      paidSubtotalVnd: 500_000,
      shippingFeeVnd: 30_000,
      totalVnd: 530_000,
    },
    proof:
      "bGFxMnwxfDUwMDAwMHwzMDAwMHw1MzAwMDB8MnwyOmwxOlBBSUQ6NTp2YXIteDoxOjUwMDAwMDo1MDAwMDA6NjpjYW1wLTE6MDp8MjpsMjpHSUZUOjU6dmFyLXg6MTowOjA6NjpjYW1wLTE6NjpnaWZ0LTF8MXw2OmNhbXAtMToxOjUwMDAwMDotMTox.8Zfg4FymOagyqDTkJPVjrU06VVUmAAiAA6S0OcVB7H4",
  },
  delimiterIdsAndTier: {
    facts: {
      // Deliberately unsorted: canonicalization must not trust the caller's order.
      lines: [
        line("b|2:x", "PAID", "v:|9", 2, 400_000, "c|:1"),
        line("a|1", "PAID", "v|:8", 1, 650_000),
      ],
      grants: [
        {
          campaignId: "c|:1",
          eligiblePaidQuantity: 2,
          basisVnd: 800_000,
          tierIndex: 2,
          giftLineCount: 0,
        },
      ],
      paidQuantity: 3,
      paidSubtotalVnd: 1_450_000,
      shippingFeeVnd: 0,
      totalVnd: 1_450_000,
    },
    proof:
      "bGFxMnwzfDE0NTAwMDB8MHwxNDUwMDAwfDJ8MzphfDE6UEFJRDo0OnZ8Ojg6MTo2NTAwMDA6NjUwMDAwOjA6OjA6fDU6YnwyOng6UEFJRDo0OnY6fDk6Mjo0MDAwMDA6ODAwMDAwOjQ6Y3w6MTowOnwxfDQ6Y3w6MToyOjgwMDAwMDoyOjA.iAuyps4qH7Q8sxelt3---NqgZVa6yMGvgJrJqxRlzMA",
  },
  noGrant: {
    facts: {
      lines: [line("only", "PAID", "var-a", 3, 100_000)],
      grants: [],
      paidQuantity: 3,
      paidSubtotalVnd: 300_000,
      shippingFeeVnd: 30_000,
      totalVnd: 330_000,
    },
    proof:
      "bGFxMnwzfDMwMDAwMHwzMDAwMHwzMzAwMDB8MXw0Om9ubHk6UEFJRDo1OnZhci1hOjM6MTAwMDAwOjMwMDAwMDowOjowOnww.RiWUn7Mj_NiJvmegx27bhs2C6kMPPlcyq7Oii88JI70",
  },
};

const paidAndGift = VECTORS.paidAndGiftSameVariant!.facts;

function issue(
  quote: BenefitQuoteProofFacts = paidAndGift,
  overrides: Partial<Parameters<typeof issueBenefitQuoteProof>[0]> = {},
): string {
  const proof = issueBenefitQuoteProof({ quote, cartId, secret, ...overrides });
  assert.ok(proof, "expected these facts to produce a proof");
  return proof;
}

function verify(overrides: Partial<Parameters<typeof verifyBenefitQuoteProof>[0]> = {}) {
  return verifyBenefitQuoteProof({
    proof: issue(),
    cartId,
    currentQuote: paidAndGift,
    secret,
    ...overrides,
  });
}

function withLine(quote: BenefitQuoteProofFacts, index: number, patch: Partial<BenefitQuoteLine>) {
  return {
    ...quote,
    lines: quote.lines.map((candidate, at) => (at === index ? { ...candidate, ...patch } : candidate)),
  };
}

test("A01 independent reference vectors match byte for byte", () => {
  for (const [name, { facts, proof }] of Object.entries(VECTORS)) {
    assert.equal(issue(facts), proof, `${name} must equal the Python reference computation`);
    assert.deepEqual(
      verifyBenefitQuoteProof({ proof, cartId, currentQuote: facts, secret }),
      { ok: true },
      name,
    );
  }
});

test("A01 PAID X and GIFT X are two distinct signed lines", () => {
  const decoded = Buffer.from(issue().split(".")[0]!, "base64url").toString("utf8");
  assert.equal(decoded.split("|").filter((part) => /^\d+:l[12]:/.test(part)).length, 2);
  assert.match(decoded, /:PAID:/);
  assert.match(decoded, /:GIFT:/);
});

test("A01 canonicalization is order-independent for lines and grants", () => {
  const reordered = { ...paidAndGift, lines: [...paidAndGift.lines].reverse() };
  assert.equal(issue(reordered), issue());
});

test("A01 the proof carries the laq2 tag and never the raw cart id", () => {
  const proof = issue();
  assert.match(proof, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const payload = Buffer.from(proof.split(".")[0]!, "base64url").toString("utf8");
  assert.ok(payload.startsWith("laq2|"));
  assert.ok(!proof.includes(cartId));
  assert.ok(!payload.includes(cartId));
});

test("A01 a proof bound to another cart or secret fails closed", () => {
  assert.deepEqual(verify({ cartId: otherCartId }), { ok: false, reason: "PROOF_UNVERIFIED" });
  assert.deepEqual(verify({ secret: otherSecret }), { ok: false, reason: "PROOF_UNVERIFIED" });
});

test("A01 every bound fact is tampered with, and each change invalidates the proof", () => {
  const proof = issue();
  // Every tamper is itself a consistent, issuable quote, so the rejection is the proof's doing and
  // not the facts validator's.
  const tampered: BenefitQuoteProofFacts[] = [
    {
      ...withLine(paidAndGift, 0, { quantity: 2, lineTotalVnd: 1_000_000 }),
      paidQuantity: 2,
      paidSubtotalVnd: 1_000_000,
      totalVnd: 1_030_000,
    },
    withLine(paidAndGift, 0, { variantExternalId: "var-y" }),
    withLine(paidAndGift, 0, { lineId: "l9" }),
    {
      ...withLine(paidAndGift, 0, { unitPriceVnd: 499_000, lineTotalVnd: 499_000 }),
      paidSubtotalVnd: 499_000,
      totalVnd: 529_000,
    },
    withLine(paidAndGift, 1, { entitlementKey: "gift-2" }),
    withLine(paidAndGift, 1, { variantExternalId: "var-z" }),
    { ...paidAndGift, shippingFeeVnd: 0, totalVnd: 500_000 },
    { ...paidAndGift, grants: [{ ...paidAndGift.grants[0]!, basisVnd: 499_999 }] },
    { ...paidAndGift, grants: [{ ...paidAndGift.grants[0]!, tierIndex: 0 }] },
    { ...paidAndGift, grants: [{ ...paidAndGift.grants[0]!, campaignId: "camp-2" }],
      lines: paidAndGift.lines.map((candidate) => ({ ...candidate, campaignId: "camp-2" })) },
  ];
  for (const currentQuote of tampered) {
    assert.ok(areUsableBenefitQuoteFacts(currentQuote), "the tamper itself must be a valid quote");
    assert.deepEqual(
      verifyBenefitQuoteProof({ proof, cartId, currentQuote, secret }),
      { ok: false, reason: "PRICE_CHANGED" },
    );
  }
});

test("A01 a tampered payload or MAC fails closed", () => {
  const [payload, mac] = issue().split(".") as [string, string];
  const flipped = `${payload.slice(0, -2)}${payload.endsWith("AA") ? "BB" : "AA"}.${mac}`;
  assert.deepEqual(verify({ proof: flipped }), { ok: false, reason: "PROOF_UNVERIFIED" });
  assert.deepEqual(verify({ proof: `${payload}.${mac.slice(0, -2)}AA` }), {
    ok: false,
    reason: "PROOF_UNVERIFIED",
  });
});

test("A01 missing, malformed and oversized proofs fail closed before MAC work", () => {
  assert.deepEqual(verify({ proof: undefined }), { ok: false, reason: "PROOF_MISSING" });
  assert.deepEqual(verify({ proof: "" }), { ok: false, reason: "PROOF_MISSING" });
  assert.deepEqual(verify({ proof: 12 }), { ok: false, reason: "PROOF_MISSING" });
  assert.deepEqual(verify({ proof: "no-dot" }), { ok: false, reason: "PROOF_MALFORMED" });
  assert.deepEqual(verify({ proof: "a b.c" }), { ok: false, reason: "PROOF_MALFORMED" });
  assert.deepEqual(verify({ proof: "AAAA.AAAA" }), { ok: false, reason: "PROOF_MALFORMED" });
  assert.deepEqual(verify({ proof: `${"A".repeat(MAX_BENEFIT_QUOTE_PROOF_BYTES)}.A` }), {
    ok: false,
    reason: "PROOF_OVERSIZED",
  });
  assert.deepEqual(verify({ cartId: "" }), { ok: false, reason: "PROOF_UNVERIFIED" });
});

test("A01 verification is total: unusable current quote reports PRICE_CHANGED, never throws", () => {
  const broken = { ...paidAndGift, lines: [] } as BenefitQuoteProofFacts;
  assert.deepEqual(verify({ currentQuote: broken }), { ok: false, reason: "PRICE_CHANGED" });
  assert.deepEqual(verify({ currentQuote: null as unknown as BenefitQuoteProofFacts }), {
    ok: false,
    reason: "PRICE_CHANGED",
  });
});

test("A01 laq1 and laq2 never authorize each other", () => {
  // A legacy quote and a proof over it.
  const legacyQuote: RenderedQuoteProofFacts = {
    items: [{ variantExternalId: "var-a", quantity: 3, unitPriceVnd: 100_000 }],
    merchandiseSubtotalVnd: 300_000,
    shippingFeeVnd: 30_000,
    totalVnd: 330_000,
    totalQuantity: 3,
  };
  const laq1 = issueRenderedQuoteProof({ quote: legacyQuote, cartId, secret });
  assert.ok(laq1);

  // The same economic quote expressed as laq2.
  const laq2Quote = VECTORS.noGrant!.facts;
  const laq2 = issue(laq2Quote);

  assert.deepEqual(
    verifyBenefitQuoteProof({ proof: laq1, cartId, currentQuote: laq2Quote, secret }),
    { ok: false, reason: "PROOF_UNVERIFIED" },
    "an laq1 token must not verify as laq2",
  );
  assert.deepEqual(
    verifyRenderedQuoteProof({ proof: laq2, cartId, currentQuote: legacyQuote, secret }),
    { ok: false, reason: "PROOF_UNVERIFIED" },
    "an laq2 token must not verify as laq1",
  );
});

test("A01 key separation: an laq2 payload MAC'd under the laq1 key does not verify", () => {
  const [payloadB64] = issue().split(".") as [string];
  const payload = Buffer.from(payloadB64, "base64url");
  const v1Key = createHmac("sha256", secret)
    .update("la-clothing:checkout-quote-proof-key:v1")
    .digest();
  const cartBytes = Buffer.from(cartId, "utf8");
  const forgedMac = createHmac("sha256", v1Key)
    .update(Buffer.from(`${cartBytes.length}:`, "utf8"))
    .update(cartBytes)
    .update(payload)
    .digest();
  const forged = `${payloadB64}.${forgedMac.toString("base64url")}`;
  assert.deepEqual(verify({ proof: forged }), { ok: false, reason: "PROOF_UNVERIFIED" });
});

test("A01 invalid role lines and prices are refused at issue time", () => {
  const cases: Array<[string, BenefitQuoteProofFacts]> = [
    ["duplicate lineId", {
      ...paidAndGift,
      lines: [paidAndGift.lines[0]!, { ...paidAndGift.lines[1]!, lineId: "l1" }],
    }],
    ["gift with a price", withLine(paidAndGift, 1, { unitPriceVnd: 1, lineTotalVnd: 1 })],
    ["gift without an entitlement", withLine(paidAndGift, 1, { entitlementKey: null })],
    ["gift without a campaign", withLine(paidAndGift, 1, { campaignId: null })],
    ["free paid line", withLine(paidAndGift, 0, { unitPriceVnd: 0, lineTotalVnd: 0 })],
    ["paid line with an entitlement", withLine(paidAndGift, 0, { entitlementKey: "e" })],
    ["empty lineId", withLine(paidAndGift, 0, { lineId: "" })],
    ["oversized lineId", withLine(paidAndGift, 0, { lineId: "x".repeat(MAX_BENEFIT_LINE_ID_LENGTH + 1) })],
    ["unknown role", withLine(paidAndGift, 0, { role: "BONUS" as "PAID" })],
    ["fractional quantity", withLine(paidAndGift, 0, { quantity: 1.5 })],
    ["zero quantity", withLine(paidAndGift, 0, { quantity: 0, lineTotalVnd: 0 })],
    ["line total that disagrees with its parts", withLine(paidAndGift, 0, { lineTotalVnd: 499_999 })],
    ["same variant twice in one role", {
      ...paidAndGift,
      lines: [paidAndGift.lines[0]!, line("l3", "PAID", "var-x", 1, 500_000, "camp-1"), paidAndGift.lines[1]!],
      paidQuantity: 2,
      paidSubtotalVnd: 1_000_000,
      totalVnd: 1_030_000,
    }],
    ["declared paid quantity that disagrees with the lines", { ...paidAndGift, paidQuantity: 2 }],
    ["declared subtotal that disagrees with the lines", { ...paidAndGift, paidSubtotalVnd: 1 }],
    ["total that is not subtotal plus shipping", { ...paidAndGift, totalVnd: 999 }],
    ["no paid line (gifts never count)", {
      lines: [paidAndGift.lines[1]!],
      grants: [{ ...paidAndGift.grants[0]! }],
      paidQuantity: 1,
      paidSubtotalVnd: 0,
      shippingFeeVnd: 0,
      totalVnd: 0,
    }],
    ["line naming a campaign that was not granted", withLine(paidAndGift, 0, { campaignId: "other" })],
    ["two campaigns in one checkout", {
      ...paidAndGift,
      grants: [
        paidAndGift.grants[0]!,
        { campaignId: "camp-2", eligiblePaidQuantity: 0, basisVnd: 0, tierIndex: null, giftLineCount: 0 },
      ],
    }],
    ["grant gift count that disagrees with the lines", {
      ...paidAndGift,
      grants: [{ ...paidAndGift.grants[0]!, giftLineCount: 2 }],
    }],
    ["tier index beyond the approved bound", {
      ...paidAndGift,
      grants: [{ ...paidAndGift.grants[0]!, tierIndex: MAX_BENEFIT_TIERS }],
    }],
    ["eligible quantity above the cart's paid quantity", {
      ...paidAndGift,
      grants: [{ ...paidAndGift.grants[0]!, eligiblePaidQuantity: 2 }],
    }],
  ];

  for (const [name, quote] of cases) {
    assert.equal(areUsableBenefitQuoteFacts(quote), false, name);
    assert.throws(
      () => issueBenefitQuoteProof({ quote, cartId, secret }),
      TypeError,
      `${name} must be a call-site error`,
    );
  }
});

test("A01 zero eligible units is valid while the cart still has paid units", () => {
  const quote: BenefitQuoteProofFacts = {
    ...VECTORS.noGrant!.facts,
    grants: [
      { campaignId: "camp-1", eligiblePaidQuantity: 0, basisVnd: 0, tierIndex: null, giftLineCount: 0 },
    ],
  };
  assert.ok(areUsableBenefitQuoteFacts(quote));
  assert.ok(issue(quote));
});

test("A01 issuing refuses a missing cart identity or short secret", () => {
  assert.throws(() => issueBenefitQuoteProof({ quote: paidAndGift, cartId: "", secret }), TypeError);
  assert.throws(() => issueBenefitQuoteProof({ quote: paidAndGift, cartId, secret: "short" }), TypeError);
});

test("A01 the cart ceiling constants agree and a full benefit cart fits the envelope", () => {
  assert.equal(MAX_BENEFIT_PAID_LINES, ANONYMOUS_CART_MAX_DISTINCT_ITEMS);
  assert.equal(MAX_BENEFIT_QUOTE_PROOF_BYTES, MAX_RENDERED_QUOTE_PROOF_BYTES);

  const paid = Array.from({ length: MAX_BENEFIT_PAID_LINES }, (_unused, index) =>
    line(
      `paid-${String(index).padStart(4, "0")}-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee`,
      "PAID",
      `${String(index).padStart(4, "0")}-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`,
      99,
      9_999_999,
      "camp-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    ),
  );
  const gifts = Array.from({ length: MAX_BENEFIT_GIFT_LINES }, (_unused, index) =>
    line(
      `gift-${String(index).padStart(4, "0")}-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee`,
      "GIFT",
      `${String(index).padStart(4, "0")}-gggggggg-bbbb-4ccc-8ddd-eeeeeeeeeeee`,
      5,
      0,
      "camp-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      `entitlement-${index}-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee`,
    ),
  );
  const subtotal = 99 * 9_999_999 * MAX_BENEFIT_PAID_LINES;
  const full: BenefitQuoteProofFacts = {
    lines: [...paid, ...gifts],
    grants: [
      {
        campaignId: "camp-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        eligiblePaidQuantity: 99 * MAX_BENEFIT_PAID_LINES,
        basisVnd: subtotal,
        tierIndex: MAX_BENEFIT_TIERS - 1,
        giftLineCount: MAX_BENEFIT_GIFT_LINES,
      },
    ],
    paidQuantity: 99 * MAX_BENEFIT_PAID_LINES,
    paidSubtotalVnd: subtotal,
    shippingFeeVnd: 0,
    totalVnd: subtotal,
  };

  const proof = issue(full);
  assert.ok(Buffer.byteLength(proof, "utf8") <= MAX_BENEFIT_QUOTE_PROOF_BYTES);
  assert.deepEqual(
    verifyBenefitQuoteProof({ proof, cartId, currentQuote: full, secret }),
    { ok: true },
  );
});

test("A01 a quote whose proof would exceed the envelope returns null instead of an unverifiable token", () => {
  const longId = "v".repeat(MAX_RENDERED_QUOTE_PROOF_BYTES);
  const quote: BenefitQuoteProofFacts = {
    ...VECTORS.noGrant!.facts,
    lines: [line("only", "PAID", longId, 3, 100_000)],
  };
  assert.equal(issueBenefitQuoteProof({ quote, cartId, secret }), null);
});

test("A01 money outside safe integers is refused rather than wrapped", () => {
  const huge = line("h", "PAID", "var-h", 2, Number.MAX_SAFE_INTEGER);
  const quote: BenefitQuoteProofFacts = {
    lines: [{ ...huge, lineTotalVnd: Number.MAX_SAFE_INTEGER }],
    grants: [],
    paidQuantity: 2,
    paidSubtotalVnd: Number.MAX_SAFE_INTEGER,
    shippingFeeVnd: 0,
    totalVnd: Number.MAX_SAFE_INTEGER,
  };
  assert.equal(areUsableBenefitQuoteFacts(quote), false);
});
