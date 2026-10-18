/**
 * Synthetic-fixture adapters between the benefit pieces (A04 of the Core Kit A/B/C programme).
 *
 * Three pure mappings, all OFF-only infrastructure — nothing calls them from checkout, and real
 * buyer benefit checkout stays off until A08 has controlled POS readback:
 *
 * 1. A05's evaluation plus the chosen gifts → the facts the `laq2` proof attests to (A01).
 * 2. Those facts → the rows A02 persists (`OrderLineSnapshot` columns and the order-level frozen
 *    grant facts).
 * 3. The persisted rows → the same facts again, so an order can rebuild the exact proof bytes that
 *    were rendered. Rendered proof == persisted rebuild is the property that makes the proof worth
 *    having, and it is what the tests of this module pin down.
 *
 * `laq1` stays the only format for legacy paid-only quotes: a legacy order (no `quoteVersion`) is
 * refused by the rebuild instead of being reinterpreted as a benefit quote.
 */

import {
  areUsableBenefitQuoteFacts,
  type BenefitQuoteGrant,
  type BenefitQuoteLine,
  type BenefitQuoteProofFacts,
} from "./benefit-quote-proof.ts";
import type { BenefitEligibilityResult } from "./benefit-eligibility.ts";

export type BenefitCampaignIdentity = Readonly<{
  id: string;
  kind: "GIFT_ITEM" | "QUANTITY_TIER";
  name: string;
}>;

export type BenefitPaidLineInput = Readonly<{
  /** The key A05 evaluated this line under (the cart line's variant id). */
  lineKey: string;
  variantExternalId: string;
  quantity: number;
}>;

export type BenefitGiftLineInput = Readonly<{
  /** Stable per gift within the campaign, e.g. the gift variant id. */
  giftKey: string;
  variantExternalId: string;
  quantity: number;
  entitlementKey: string;
}>;

/**
 * Which proof format a quote uses. `laq2` only when a campaign was actually granted; everything else —
 * no campaign, a refusal, a step not reached — is the legacy paid-only quote and keeps `laq1`.
 */
export function quoteFormatFor(evaluation: BenefitEligibilityResult): "laq1" | "laq2" {
  return evaluation.campaignId !== null && evaluation.refusal === null && evaluation.tierIndex !== null
    ? "laq2"
    : "laq1";
}

const MAX_LINE_ID_LENGTH = 64;

/** Deterministic line identities, so the same quote always produces the same lineIds. */
export const paidLineId = (lineKey: string): string => `p:${lineKey}`;
export const giftLineId = (campaignId: string, giftKey: string): string => `g:${campaignId}:${giftKey}`;

function requireLineId(lineId: string): string {
  if (lineId.length === 0 || lineId.length > MAX_LINE_ID_LENGTH) {
    throw new RangeError("A benefit quote line id must be 1-64 characters");
  }
  return lineId;
}

/**
 * The facts for a benefit quote. Throws `RangeError` for inconsistent input — gifts without a granted
 * gift step, a paid line missing from the evaluation, a mismatch between what A05 priced and what is
 * passed — because each is a programming error at the call site, never a business outcome.
 */
export function buildBenefitQuoteFacts({
  paidLines,
  gifts,
  evaluation,
}: Readonly<{
  paidLines: readonly BenefitPaidLineInput[];
  gifts: readonly BenefitGiftLineInput[];
  evaluation: BenefitEligibilityResult;
}>): BenefitQuoteProofFacts {
  const granted = evaluation.campaignId !== null && evaluation.refusal === null && evaluation.tierIndex !== null;
  if (gifts.length > 0 && !(granted && evaluation.giftUnlocked)) {
    throw new RangeError("Gifts need a granted gift step in the evaluation");
  }
  if (paidLines.length !== evaluation.lines.length) {
    throw new RangeError("Every evaluated paid line needs exactly one input line");
  }

  const priced = new Map(evaluation.lines.map((line) => [line.lineKey, line]));
  const lines: BenefitQuoteLine[] = [];
  for (const input of paidLines) {
    const result = priced.get(input.lineKey);
    if (!result) throw new RangeError(`No evaluation for paid line ${input.lineKey}`);
    const lineQuantity = result.lineTotalVnd / result.finalUnitPriceVnd;
    if (lineQuantity !== input.quantity) throw new RangeError(`Quantity mismatch on paid line ${input.lineKey}`);
    lines.push({
      lineId: requireLineId(paidLineId(input.lineKey)),
      role: "PAID",
      variantExternalId: input.variantExternalId,
      quantity: input.quantity,
      unitPriceVnd: result.finalUnitPriceVnd,
      lineTotalVnd: result.lineTotalVnd,
      campaignId: result.benefitApplied ? evaluation.campaignId : null,
      entitlementKey: null,
    });
  }

  for (const gift of gifts) {
    lines.push({
      lineId: requireLineId(giftLineId(evaluation.campaignId!, gift.giftKey)),
      role: "GIFT",
      variantExternalId: gift.variantExternalId,
      quantity: gift.quantity,
      unitPriceVnd: 0,
      lineTotalVnd: 0,
      campaignId: evaluation.campaignId,
      entitlementKey: gift.entitlementKey,
    });
  }

  const grants: BenefitQuoteGrant[] = granted
    ? [
        {
          campaignId: evaluation.campaignId!,
          eligiblePaidQuantity: evaluation.eligiblePaidQuantity,
          basisVnd: evaluation.basisVnd,
          tierIndex: evaluation.tierIndex,
          giftLineCount: gifts.length,
        },
      ]
    : [];

  const facts: BenefitQuoteProofFacts = Object.freeze({
    lines: Object.freeze(lines),
    grants: Object.freeze(grants),
    paidQuantity: evaluation.paidQuantity,
    paidSubtotalVnd: evaluation.paidSubtotalVnd,
    shippingFeeVnd: evaluation.shippingFeeVnd,
    totalVnd: evaluation.totalVnd,
  });
  if (!areUsableBenefitQuoteFacts(facts)) {
    throw new RangeError("The assembled benefit quote is not internally consistent");
  }
  return facts;
}

/** What the order row needs besides its lines (A02). */
export type BenefitOrderRowData = Readonly<{
  quoteVersion: 2;
  benefitCampaignId: string | null;
  benefitEligibleQuantity: number | null;
  benefitBasisVnd: bigint | null;
  benefitTierIndex: number | null;
  merchandiseSubtotalVnd: bigint;
  shippingFeeVnd: bigint;
  totalVnd: bigint;
}>;

/** One `OrderLineSnapshot` create payload, minus `orderId`. */
export type BenefitLineRowData = Readonly<{
  variantId: string;
  pancakeVariationId: string;
  productName: string;
  color: string | null;
  size: string;
  quantity: number;
  unitPriceVnd: bigint;
  lineTotalVnd: bigint;
  lineId: string;
  lineRole: "PAID" | "GIFT";
  benefitCampaignId: string | null;
  benefitKind: "GIFT_ITEM" | "QUANTITY_TIER" | null;
  benefitCampaignName: string | null;
  entitlementKey: string | null;
}>;

export type BenefitVariantDescriptor = Readonly<{
  variantId: string;
  productName: string;
  color: string | null;
  size: string;
}>;

/**
 * The rows to persist. `variants` describes each Pancake variation id the quote mentions; a line whose
 * variation is not described is a call-site error, never a row with blanks.
 */
export function toBenefitOrderRows(
  facts: BenefitQuoteProofFacts,
  campaign: BenefitCampaignIdentity | null,
  variants: ReadonlyMap<string, BenefitVariantDescriptor>,
): Readonly<{ order: BenefitOrderRowData; lines: BenefitLineRowData[] }> {
  if (!areUsableBenefitQuoteFacts(facts)) throw new RangeError("Benefit quote facts are not usable");
  const grant = facts.grants[0] ?? null;
  if ((grant === null) !== (campaign === null) || (grant && campaign && grant.campaignId !== campaign.id)) {
    throw new RangeError("The campaign identity must match the quote's single grant");
  }

  const lines = facts.lines.map((line): BenefitLineRowData => {
    const variant = variants.get(line.variantExternalId);
    if (!variant) throw new RangeError(`No variant described for ${line.variantExternalId}`);
    const hasCampaign = line.campaignId !== null;
    return {
      variantId: variant.variantId,
      pancakeVariationId: line.variantExternalId,
      productName: variant.productName,
      color: variant.color,
      size: variant.size,
      quantity: line.quantity,
      unitPriceVnd: BigInt(line.unitPriceVnd),
      lineTotalVnd: BigInt(line.lineTotalVnd),
      lineId: line.lineId,
      lineRole: line.role,
      benefitCampaignId: line.campaignId,
      benefitKind: hasCampaign ? campaign!.kind : null,
      benefitCampaignName: hasCampaign ? campaign!.name : null,
      entitlementKey: line.entitlementKey,
    };
  });

  return Object.freeze({
    order: Object.freeze({
      quoteVersion: 2 as const,
      benefitCampaignId: grant ? grant.campaignId : null,
      benefitEligibleQuantity: grant ? grant.eligiblePaidQuantity : null,
      benefitBasisVnd: grant ? BigInt(grant.basisVnd) : null,
      benefitTierIndex: grant ? grant.tierIndex : null,
      merchandiseSubtotalVnd: BigInt(facts.paidSubtotalVnd),
      shippingFeeVnd: BigInt(facts.shippingFeeVnd),
      totalVnd: BigInt(facts.totalVnd),
    }),
    lines,
  });
}

export type PersistedBenefitOrder = Readonly<{
  quoteVersion: number | null;
  benefitCampaignId: string | null;
  benefitEligibleQuantity: number | null;
  benefitBasisVnd: bigint | null;
  benefitTierIndex: number | null;
  merchandiseSubtotalVnd: bigint | null;
  shippingFeeVnd: bigint | null;
  totalVnd: bigint | null;
}>;

export type PersistedBenefitLine = Readonly<{
  pancakeVariationId: string;
  quantity: number;
  unitPriceVnd: bigint;
  lineTotalVnd: bigint;
  lineId: string | null;
  lineRole: string | null;
  benefitCampaignId: string | null;
  entitlementKey: string | null;
}>;

/**
 * The facts again, from what was stored. Returns `null` for a legacy order (no `quoteVersion`) or for
 * any row that is not a complete v2 line, so a legacy order can never be re-read through this lens.
 */
export function benefitQuoteFactsFromPersistedOrder(
  order: PersistedBenefitOrder,
  rows: readonly PersistedBenefitLine[],
): BenefitQuoteProofFacts | null {
  if (order.quoteVersion !== 2) return null;
  if (
    order.merchandiseSubtotalVnd === null ||
    order.shippingFeeVnd === null ||
    order.totalVnd === null ||
    rows.length === 0
  ) {
    return null;
  }

  const lines: BenefitQuoteLine[] = [];
  let paidQuantity = 0;
  let giftLineCount = 0;
  for (const row of rows) {
    if (row.lineId === null || (row.lineRole !== "PAID" && row.lineRole !== "GIFT")) return null;
    const unitPriceVnd = Number(row.unitPriceVnd);
    const lineTotalVnd = Number(row.lineTotalVnd);
    if (!Number.isSafeInteger(unitPriceVnd) || !Number.isSafeInteger(lineTotalVnd)) return null;
    lines.push({
      lineId: row.lineId,
      role: row.lineRole,
      variantExternalId: row.pancakeVariationId,
      quantity: row.quantity,
      unitPriceVnd,
      lineTotalVnd,
      campaignId: row.benefitCampaignId,
      entitlementKey: row.entitlementKey,
    });
    if (row.lineRole === "PAID") paidQuantity += row.quantity;
    else giftLineCount += 1;
  }

  const hasGrant = order.benefitCampaignId !== null;
  if (hasGrant && (order.benefitEligibleQuantity === null || order.benefitBasisVnd === null)) return null;
  const grants: BenefitQuoteGrant[] = hasGrant
    ? [
        {
          campaignId: order.benefitCampaignId!,
          eligiblePaidQuantity: order.benefitEligibleQuantity!,
          basisVnd: Number(order.benefitBasisVnd!),
          tierIndex: order.benefitTierIndex,
          giftLineCount,
        },
      ]
    : [];

  const facts: BenefitQuoteProofFacts = {
    lines,
    grants,
    paidQuantity,
    paidSubtotalVnd: Number(order.merchandiseSubtotalVnd),
    shippingFeeVnd: Number(order.shippingFeeVnd),
    totalVnd: Number(order.totalVnd),
  };
  return areUsableBenefitQuoteFacts(facts) ? facts : null;
}
