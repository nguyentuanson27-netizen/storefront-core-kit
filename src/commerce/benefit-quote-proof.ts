/**
 * The `laq2` rendered-quote proof: what the buyer was shown when a benefit (gift or quantity tier)
 * is part of the quote. A01 of the Core Kit A/B/C programme; the contract is the accepted
 * `docs/specs/core-kit-benefit-quote-v1-technical-review.md` §2.
 *
 * This is deliberately a sibling of `checkout-quote-proof.ts` rather than a change to it. `laq1`
 * stays the only accepted format for legacy paid-only quotes and its module is untouched, so a
 * legacy order can never be re-read through a benefit-shaped lens. Nothing here is wired into
 * checkout: no caller, no flag, no schema. Real buyer benefit checkout stays OFF until A08.
 *
 * What differs from `laq1`, and why:
 *
 * **Separate key.** The MAC key is derived from the same validated server secret with a different
 * context string, so an `laq1` MAC can never verify as `laq2` or the reverse, and neither can pass
 * as a session or client-identity value. The payload also begins with its own format tag.
 *
 * **Role lines.** A quote line has a stable `lineId` and a `PAID` or `GIFT` role, so PAID X and
 * GIFT X are two distinct signed lines even though they share a variant. Each role may use a
 * variant once. Roles carry money rules that are checked before issue: a gift is free, a paid line
 * is not, and every total is recomputed from the lines rather than trusted from the caller.
 *
 * **One campaign.** Owner policy is at most one A1 campaign per checkout, so more than one grant is
 * refused here instead of being left for a caller to rank.
 *
 * **The version comes from the quote, never from the token.** Verification recomputes canonical
 * bytes for the quote the server just rebuilt and compares; a token cannot pick its own, weaker
 * verifier, and no value is read back out of it. As in `laq1`, no money is returned from here.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import {
  MAX_RENDERED_QUOTE_PROOF_BYTES,
  type RenderedQuoteProofVerification,
} from "./checkout-quote-proof.ts";

/** Same envelope as `laq1`: verification rejects anything larger before decoding. */
export const MAX_BENEFIT_QUOTE_PROOF_BYTES = MAX_RENDERED_QUOTE_PROOF_BYTES;

/** Mirrors `ANONYMOUS_CART_MAX_DISTINCT_ITEMS`; a test fails if the two drift apart. */
export const MAX_BENEFIT_PAID_LINES = 50;
/** A06 bound (owner-approved 2026-10-18): at most 5 gifts per campaign. */
export const MAX_BENEFIT_GIFT_LINES = 5;
/** A06 bound (owner-approved 2026-10-18): at most 8 tiers, so a tier index is 0..7. */
export const MAX_BENEFIT_TIERS = 8;
/** A02 column bound for `lineId`. */
export const MAX_BENEFIT_LINE_ID_LENGTH = 64;

const PROOF_FORMAT = "laq2";
const PROOF_KEY_CONTEXT = "la-clothing:checkout-quote-proof-key:v2";
const MIN_SECRET_LENGTH = 32;
const MAC_BYTES = 32;
const PROOF_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export type BenefitQuoteLineRole = "PAID" | "GIFT";

export type BenefitQuoteLine = Readonly<{
  /** Stable, unique within the quote. */
  lineId: string;
  role: BenefitQuoteLineRole;
  variantExternalId: string;
  quantity: number;
  unitPriceVnd: number;
  lineTotalVnd: number;
  /** Required on a GIFT line; on a PAID line it marks a line a tier discount applied to. */
  campaignId: string | null;
  /** Required on a GIFT line; always null on a PAID line. */
  entitlementKey: string | null;
}>;

/** What one campaign granted in this quote, frozen before shipping is evaluated. */
export type BenefitQuoteGrant = Readonly<{
  campaignId: string;
  /** `Q_paid_eligible(campaign)`: can be zero. */
  eligiblePaidQuantity: number;
  /** `S_basis(campaign)`: the frozen eligible paid subtotal before any A1 discount. */
  basisVnd: number;
  /** Index of the reached tier, or null when no tier applies. */
  tierIndex: number | null;
  /** Number of GIFT lines this campaign granted. */
  giftLineCount: number;
}>;

export type BenefitQuoteProofFacts = Readonly<{
  lines: readonly BenefitQuoteLine[];
  grants: readonly BenefitQuoteGrant[];
  /** `Q_paid_cart`: all paid units in the cart; gifts never count. Must be positive. */
  paidQuantity: number;
  /** `S_final_paid`: paid subtotal after approved benefits, without gifts or shipping. */
  paidSubtotalVnd: number;
  shippingFeeVnd: number;
  totalVnd: number;
}>;

function isUsableVnd(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** `quantity * unitPrice` computed exactly, so an overflowing product can never look consistent. */
function exactLineTotal(quantity: number, unitPriceVnd: number): number | null {
  const product = BigInt(quantity) * BigInt(unitPriceVnd);
  return product <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(product) : null;
}

function isUsableLine(line: BenefitQuoteLine): boolean {
  if (
    !line ||
    !isNonEmptyString(line.lineId) ||
    line.lineId.length > MAX_BENEFIT_LINE_ID_LENGTH ||
    (line.role !== "PAID" && line.role !== "GIFT") ||
    !isNonEmptyString(line.variantExternalId) ||
    !isPositiveSafeInteger(line.quantity) ||
    !isUsableVnd(line.unitPriceVnd) ||
    !isUsableVnd(line.lineTotalVnd) ||
    exactLineTotal(line.quantity, line.unitPriceVnd) !== line.lineTotalVnd
  ) {
    return false;
  }

  if (line.role === "GIFT") {
    return (
      line.unitPriceVnd === 0 &&
      line.lineTotalVnd === 0 &&
      isNonEmptyString(line.campaignId) &&
      isNonEmptyString(line.entitlementKey)
    );
  }

  return (
    line.unitPriceVnd > 0 &&
    line.entitlementKey === null &&
    (line.campaignId === null || isNonEmptyString(line.campaignId))
  );
}

function isUsableGrant(grant: BenefitQuoteGrant, paidQuantity: number): boolean {
  return (
    !!grant &&
    isNonEmptyString(grant.campaignId) &&
    Number.isSafeInteger(grant.eligiblePaidQuantity) &&
    grant.eligiblePaidQuantity >= 0 &&
    grant.eligiblePaidQuantity <= paidQuantity &&
    isUsableVnd(grant.basisVnd) &&
    (grant.tierIndex === null ||
      (Number.isSafeInteger(grant.tierIndex) &&
        grant.tierIndex >= 0 &&
        grant.tierIndex < MAX_BENEFIT_TIERS)) &&
    Number.isSafeInteger(grant.giftLineCount) &&
    grant.giftLineCount >= 0 &&
    grant.giftLineCount <= MAX_BENEFIT_GIFT_LINES
  );
}

/**
 * True only when the facts are internally consistent: every derived figure is recomputed from the
 * lines and must equal what the caller declared. A caller that disagrees with its own lines has a
 * bug, and a proof over that disagreement would attest to a number nobody computed.
 */
export function areUsableBenefitQuoteFacts(quote: BenefitQuoteProofFacts): boolean {
  if (
    !quote ||
    !Array.isArray(quote.lines) ||
    !Array.isArray(quote.grants) ||
    quote.lines.length === 0 ||
    quote.lines.length > MAX_BENEFIT_PAID_LINES + MAX_BENEFIT_GIFT_LINES ||
    quote.grants.length > 1 ||
    !isPositiveSafeInteger(quote.paidQuantity) ||
    !isUsableVnd(quote.paidSubtotalVnd) ||
    !isUsableVnd(quote.shippingFeeVnd) ||
    !isUsableVnd(quote.totalVnd)
  ) {
    return false;
  }

  const lineIds = new Set<string>();
  const variantRoles = new Set<string>();
  let paidQuantity = 0;
  let paidSubtotal = 0;
  let paidLines = 0;
  const giftLinesByCampaign = new Map<string, number>();

  for (const line of quote.lines) {
    if (!isUsableLine(line)) return false;
    if (lineIds.has(line.lineId)) return false;
    lineIds.add(line.lineId);

    // Each role may use a variant once; PAID and GIFT of the same variant are the supported pair.
    const roleKey = `${line.role}\u0000${line.variantExternalId}`;
    if (variantRoles.has(roleKey)) return false;
    variantRoles.add(roleKey);

    if (line.role === "PAID") {
      paidLines += 1;
      paidQuantity += line.quantity;
      paidSubtotal += line.lineTotalVnd;
      if (!Number.isSafeInteger(paidQuantity) || !Number.isSafeInteger(paidSubtotal)) return false;
    } else {
      giftLinesByCampaign.set(
        line.campaignId!,
        (giftLinesByCampaign.get(line.campaignId!) ?? 0) + 1,
      );
    }
  }

  if (
    paidLines === 0 ||
    paidLines > MAX_BENEFIT_PAID_LINES ||
    quote.lines.length - paidLines > MAX_BENEFIT_GIFT_LINES ||
    paidQuantity !== quote.paidQuantity ||
    paidSubtotal !== quote.paidSubtotalVnd ||
    quote.paidSubtotalVnd + quote.shippingFeeVnd !== quote.totalVnd ||
    !Number.isSafeInteger(quote.totalVnd)
  ) {
    return false;
  }

  const grantIds = new Set<string>();
  for (const grant of quote.grants) {
    if (!isUsableGrant(grant, quote.paidQuantity)) return false;
    grantIds.add(grant.campaignId);
    if ((giftLinesByCampaign.get(grant.campaignId) ?? 0) !== grant.giftLineCount) return false;
  }

  // A line may only name a campaign the quote actually granted.
  for (const line of quote.lines) {
    if (line.campaignId !== null && !grantIds.has(line.campaignId)) return false;
  }

  return true;
}

function requireUsableFacts(quote: BenefitQuoteProofFacts): void {
  if (!areUsableBenefitQuoteFacts(quote)) {
    throw new TypeError("Benefit quote proof facts must be consistent bounded website money");
  }
}

function compareBytewise(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

/** `<byteLength>:<value>` so no free-form string can masquerade as extra fields. */
function prefixed(value: string): string {
  return `${Buffer.byteLength(value, "utf8")}:${value}`;
}

/**
 * Deterministic, self-delimiting canonical bytes.
 *
 * Lines are sorted by `lineId` (UTF-8 bytewise) and grants by `campaignId` here rather than trusted
 * from the caller, so the render path and the order snapshot canonicalize identically.
 */
function canonicalBenefitQuoteBytes(quote: BenefitQuoteProofFacts): Buffer {
  const lines = [...quote.lines].sort((left, right) => compareBytewise(left.lineId, right.lineId));
  const grants = [...quote.grants].sort((left, right) =>
    compareBytewise(left.campaignId, right.campaignId),
  );

  let canonical =
    `${PROOF_FORMAT}` +
    `|${quote.paidQuantity}` +
    `|${quote.paidSubtotalVnd}` +
    `|${quote.shippingFeeVnd}` +
    `|${quote.totalVnd}` +
    `|${lines.length}`;

  for (const line of lines) {
    canonical +=
      `|${prefixed(line.lineId)}` +
      `:${line.role}` +
      `:${prefixed(line.variantExternalId)}` +
      `:${line.quantity}` +
      `:${line.unitPriceVnd}` +
      `:${line.lineTotalVnd}` +
      `:${prefixed(line.campaignId ?? "")}` +
      `:${prefixed(line.entitlementKey ?? "")}`;
  }

  canonical += `|${grants.length}`;
  for (const grant of grants) {
    canonical +=
      `|${prefixed(grant.campaignId)}` +
      `:${grant.eligiblePaidQuantity}` +
      `:${grant.basisVnd}` +
      `:${grant.tierIndex ?? -1}` +
      `:${grant.giftLineCount}`;
  }

  return Buffer.from(canonical, "utf8");
}

/**
 * A key used for nothing else, and different from the `laq1` key: same derivation shape as
 * `deriveProofKey` with the `:v2` context.
 */
function deriveBenefitProofKey(secret: string): Buffer {
  if (typeof secret !== "string" || secret.trim().length < MIN_SECRET_LENGTH) {
    throw new TypeError("Benefit quote proof requires the validated server secret");
  }
  return createHmac("sha256", secret).update(PROOF_KEY_CONTEXT).digest();
}

function isUsableCartId(cartId: string): boolean {
  return typeof cartId === "string" && cartId.length > 0;
}

/** The cart id is MAC context, never payload, and is length-prefixed like every other string. */
function computeMac(key: Buffer, cartId: string, payload: Buffer): Buffer {
  const cartBytes = Buffer.from(cartId, "utf8");
  return createHmac("sha256", key)
    .update(Buffer.from(`${cartBytes.length}:`, "utf8"))
    .update(cartBytes)
    .update(payload)
    .digest();
}

/**
 * Issues a proof, or `null` when the facts cannot produce a verifiable one.
 *
 * Inconsistent facts are a programming error at the call site and throw. Exceeding the envelope is a
 * data condition the caller must handle, so it returns `null` and the checkout refuses to quote
 * rather than handing out a token its own verifier would always reject.
 */
export function issueBenefitQuoteProof({
  quote,
  cartId,
  secret,
}: Readonly<{
  quote: BenefitQuoteProofFacts;
  cartId: string;
  secret: string;
}>): string | null {
  requireUsableFacts(quote);
  const key = deriveBenefitProofKey(secret);
  if (!isUsableCartId(cartId)) {
    throw new TypeError("Benefit quote proof requires a server-read cart identity");
  }

  const payload = canonicalBenefitQuoteBytes(quote);
  const mac = computeMac(key, cartId, payload);
  const proof = `${payload.toString("base64url")}.${mac.toString("base64url")}`;
  return Buffer.byteLength(proof, "utf8") > MAX_BENEFIT_QUOTE_PROOF_BYTES ? null : proof;
}

/**
 * Establishes only that this token is ours, is bound to this cart, and describes `currentQuote`.
 *
 * The caller must have rebuilt `currentQuote` from server-authoritative pricing first. Total: it
 * fails closed instead of throwing, except for a misconfigured server secret, which must be loud.
 */
export function verifyBenefitQuoteProof({
  proof,
  cartId,
  currentQuote,
  secret,
}: Readonly<{
  proof: unknown;
  cartId: string;
  currentQuote: BenefitQuoteProofFacts;
  secret: string;
}>): RenderedQuoteProofVerification {
  if (!isUsableCartId(cartId)) {
    return Object.freeze({ ok: false as const, reason: "PROOF_UNVERIFIED" as const });
  }
  if (typeof proof !== "string" || proof.length === 0) {
    return Object.freeze({ ok: false as const, reason: "PROOF_MISSING" as const });
  }
  if (Buffer.byteLength(proof, "utf8") > MAX_BENEFIT_QUOTE_PROOF_BYTES) {
    return Object.freeze({ ok: false as const, reason: "PROOF_OVERSIZED" as const });
  }
  if (!PROOF_PATTERN.test(proof)) {
    return Object.freeze({ ok: false as const, reason: "PROOF_MALFORMED" as const });
  }

  const separator = proof.indexOf(".");
  const payload = Buffer.from(proof.slice(0, separator), "base64url");
  const presentedMac = Buffer.from(proof.slice(separator + 1), "base64url");
  if (payload.length === 0 || presentedMac.length !== MAC_BYTES) {
    return Object.freeze({ ok: false as const, reason: "PROOF_MALFORMED" as const });
  }

  const key = deriveBenefitProofKey(secret);
  const expectedMac = computeMac(key, cartId, payload);
  if (!timingSafeEqual(presentedMac, expectedMac)) {
    return Object.freeze({ ok: false as const, reason: "PROOF_UNVERIFIED" as const });
  }

  // Authentic and bound to this cart. Only now is staleness a meaningful question, and it is byte
  // equality against what the server just computed — no token byte becomes a fact.
  if (!areUsableBenefitQuoteFacts(currentQuote)) {
    return Object.freeze({ ok: false as const, reason: "PRICE_CHANGED" as const });
  }
  if (!payload.equals(canonicalBenefitQuoteBytes(currentQuote))) {
    return Object.freeze({ ok: false as const, reason: "PRICE_CHANGED" as const });
  }

  return Object.freeze({ ok: true as const });
}
