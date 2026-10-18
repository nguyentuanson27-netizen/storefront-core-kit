/**
 * Paid-only benefit eligibility and the shipping basis. A05 of the Core Kit A/B/C programme; the
 * contract is the accepted `docs/specs/core-kit-benefit-quote-v1-technical-review.md` §1 and the
 * F01 child spec §2.
 *
 * Pure: no database, no clock, no environment unless the caller omits the shipping policy. Nothing
 * calls it yet — A06 supplies campaigns, A08 wires a real checkout — so its behavior is reachable
 * only from tests, and the default-OFF flags in front of it do not exist because there is nothing to
 * switch. Legacy pricing is never re-derived here: the caller hands in each line's price as the
 * legacy resolver already decided it, plus the resolver's own verdict on whether it discounted.
 *
 * Owner policy encoded below (all accepted 2026-10-18):
 *
 * - **One campaign per checkout.** If more than one campaign has an in-scope paid line, none is
 *   granted. There is no ranking, matching legacy `PROMOTION_CONFLICT`.
 * - **Basis vs. benefit.** A line the legacy resolver discounted counts toward the campaign basis at
 *   its effective price but never receives an A1 price benefit. A line legacy could not decide
 *   (`PROMOTION_CONFLICT`/`PROMOTION_INVALID`) refuses the whole campaign for this checkout.
 * - **Frozen basis, one pass.** `S_basis` and `Q_paid_eligible` are measured before any A1 discount
 *   and the tier is chosen from them once. The discount never feeds back into eligibility, so a tier
 *   cannot oscillate; only afterwards is `S_final_paid` measured, and only that is used for shipping.
 * - **Shipping.** `calculateGuestShippingFeeVnd({ subtotalVnd: S_final_paid, totalQuantity:
 *   Q_paid_cart })` stays the only authority. `Q_paid_cart` counts every paid unit, eligible or not;
 *   gifts count toward neither quantity.
 * - **Refusals are not errors.** They return the undiscounted legacy quote with a reason code.
 */

import {
  calculateGuestShippingFeeVnd,
  type GuestShippingPolicy,
} from "./guest-shipping-policy.ts";
import { type PromotionPricingResult } from "./promotion-pricing.ts";

/** What the legacy resolver decided for one purchasable line. */
export type LegacyPricingOutcome = "NONE" | "DISCOUNTED" | "AMBIGUOUS";

/**
 * Reads the legacy verdict out of `resolvePromotionPricing`'s own result, so there is no second
 * definition of "is this line legacy-discounted". Returns `null` for a line that is not purchasable
 * (`BASE_PRICE_UNAVAILABLE`), which must never reach a benefit quote.
 */
export function classifyLegacyPricing(result: PromotionPricingResult): LegacyPricingOutcome | null {
  if (result.reason === "BASE_PRICE_UNAVAILABLE") return null;
  if (result.reason === "PROMOTION_CONFLICT" || result.reason === "PROMOTION_INVALID") {
    return "AMBIGUOUS";
  }
  return result.isDiscounted ? "DISCOUNTED" : "NONE";
}

export type BenefitEligibilityLine = Readonly<{
  /** Stable identity of the cart line, echoed back in the result. */
  lineKey: string;
  quantity: number;
  /** Effective unit price after legacy pricing, before any A1 benefit. */
  unitPriceVnd: number;
  legacy: LegacyPricingOutcome;
  /** Ids of the campaigns whose scope includes this line (resolved by A06; empty = none). */
  campaignIds: readonly string[];
}>;

/**
 * One reachable step of a campaign. Exactly one of `minEligibleQuantity` / `minBasisVnd` is set.
 * `percentageValue` (1–99) is the A1 price benefit on benefit lines; it is `null` for a gift step,
 * which unlocks a gift instead of changing a price.
 */
export type BenefitEligibilityTier = Readonly<{
  minEligibleQuantity: number | null;
  minBasisVnd: number | null;
  percentageValue: number | null;
}>;

export type BenefitEligibilityCampaign = Readonly<{
  id: string;
  /** Ascending by threshold; the highest step whose threshold is reached applies. */
  tiers: readonly BenefitEligibilityTier[];
}>;

export type BenefitEligibilityRefusal =
  /** More than one campaign has an in-scope paid line; none is granted. */
  | "A1_MULTIPLE_CAMPAIGNS"
  /** An in-scope line's legacy price is ambiguous; the campaign is not granted. */
  | "A1_LEGACY_AMBIGUOUS";

export type BenefitEligibilityLineResult = Readonly<{
  lineKey: string;
  finalUnitPriceVnd: number;
  lineTotalVnd: number;
  /** True only when an A1 price benefit actually lowered this line. */
  benefitApplied: boolean;
}>;

export type BenefitEligibilityResult = Readonly<{
  /** `Q_paid_cart`: every paid unit in the cart. */
  paidQuantity: number;
  /** The campaign that was evaluated (granted or not), or null when none had an in-scope line. */
  campaignId: string | null;
  refusal: BenefitEligibilityRefusal | null;
  /** `Q_paid_eligible(campaign)`; zero when no campaign was evaluated. */
  eligiblePaidQuantity: number;
  /** `S_basis(campaign)`; frozen before any A1 discount. */
  basisVnd: number;
  /** Index of the reached step, or null when no step is reached. */
  tierIndex: number | null;
  /** True when the reached step is a gift step (no percentage). */
  giftUnlocked: boolean;
  /** Paid subtotal at legacy prices, before any A1 benefit. */
  paidSubtotalBeforeBenefitVnd: number;
  discountVnd: number;
  /** `S_final_paid`: after approved benefits, without gifts or shipping. */
  paidSubtotalVnd: number;
  shippingFeeVnd: number;
  totalVnd: number;
  lines: readonly BenefitEligibilityLineResult[];
}>;

const MIN_PERCENTAGE = 1;
const MAX_PERCENTAGE = 99;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function requireSafeInteger(value: unknown, label: string, minimum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${label} must be a safe integer >= ${minimum}`);
  }
  return value;
}

/**
 * The legacy rounding rule (round half up, exact in BigInt) for a percentage price. Restated rather
 * than imported so the legacy module stays untouched; a test compares it against
 * `resolvePromotionPricing` so the two cannot drift.
 */
function percentagePrice(unitPriceVnd: number, percentageValue: number): number | null {
  if (percentageValue < MIN_PERCENTAGE || percentageValue > MAX_PERCENTAGE) return null;
  const effective =
    (BigInt(unitPriceVnd) * BigInt(100 - percentageValue) + BigInt(50)) / BigInt(100);
  return effective > MAX_SAFE ? null : Number(effective);
}

function validateTier(tier: BenefitEligibilityTier): void {
  const hasQuantity = tier?.minEligibleQuantity !== null && tier?.minEligibleQuantity !== undefined;
  const hasBasis = tier?.minBasisVnd !== null && tier?.minBasisVnd !== undefined;
  if (hasQuantity === hasBasis) {
    throw new RangeError("A benefit tier needs exactly one of minEligibleQuantity and minBasisVnd");
  }
  if (hasQuantity) requireSafeInteger(tier.minEligibleQuantity, "minEligibleQuantity", 1);
  if (hasBasis) requireSafeInteger(tier.minBasisVnd, "minBasisVnd", 1);
  if (tier.percentageValue !== null) {
    requireSafeInteger(tier.percentageValue, "percentageValue", MIN_PERCENTAGE);
    if (tier.percentageValue > MAX_PERCENTAGE) {
      throw new RangeError(`percentageValue must be at most ${MAX_PERCENTAGE}`);
    }
  }
}

/**
 * Steps are one ladder: the same threshold kind throughout, strictly increasing, and either all price
 * steps or all gift steps. A ladder that is not monotonic would make "the highest step reached"
 * depend on listing order, so it is a configuration error rather than a guess.
 */
function validateTiers(tiers: readonly BenefitEligibilityTier[]): void {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    throw new RangeError("A benefit campaign needs at least one tier");
  }
  tiers.forEach(validateTier);
  const byQuantity = tiers[0]!.minEligibleQuantity !== null;
  const byPrice = tiers[0]!.percentageValue !== null;
  let previous = 0;
  for (const tier of tiers) {
    if ((tier.minEligibleQuantity !== null) !== byQuantity) {
      throw new RangeError("A benefit ladder must use one threshold kind");
    }
    if ((tier.percentageValue !== null) !== byPrice) {
      throw new RangeError("A benefit ladder must be all price steps or all gift steps");
    }
    const threshold = byQuantity ? tier.minEligibleQuantity! : tier.minBasisVnd!;
    if (threshold <= previous) {
      throw new RangeError("Benefit thresholds must be strictly increasing");
    }
    previous = threshold;
  }
}

function tierReached(
  tier: BenefitEligibilityTier,
  eligiblePaidQuantity: number,
  basisVnd: number,
): boolean {
  return tier.minEligibleQuantity !== null
    ? eligiblePaidQuantity >= tier.minEligibleQuantity
    : basisVnd >= tier.minBasisVnd!;
}

/**
 * Evaluates the one possible campaign for this cart and prices the paid side.
 *
 * Throws `RangeError` for malformed input (a programming error at the call site, like the guest
 * shipping policy does); every business outcome — no campaign, a refusal, a step not reached — is a
 * normal return value.
 */
export function evaluateBenefitEligibility({
  lines,
  campaigns,
  shippingPolicy,
}: Readonly<{
  lines: readonly BenefitEligibilityLine[];
  campaigns: readonly BenefitEligibilityCampaign[];
  /** Omit to read the configured policy, exactly as legacy checkout does. */
  shippingPolicy?: GuestShippingPolicy;
}>): BenefitEligibilityResult {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new RangeError("A benefit evaluation needs at least one paid line");
  }

  const lineKeys = new Set<string>();
  let paidQuantity = 0;
  let subtotalBefore = 0;
  for (const line of lines) {
    if (typeof line.lineKey !== "string" || line.lineKey.length === 0 || lineKeys.has(line.lineKey)) {
      throw new RangeError("Benefit evaluation lines need unique non-empty keys");
    }
    lineKeys.add(line.lineKey);
    requireSafeInteger(line.quantity, "quantity", 1);
    requireSafeInteger(line.unitPriceVnd, "unitPriceVnd", 1);
    if (line.legacy !== "NONE" && line.legacy !== "DISCOUNTED" && line.legacy !== "AMBIGUOUS") {
      throw new RangeError("Benefit evaluation lines need a legacy pricing outcome");
    }
    const total = BigInt(line.quantity) * BigInt(line.unitPriceVnd);
    if (total > MAX_SAFE) throw new RangeError("A line total exceeds the safe-integer range");
    paidQuantity += line.quantity;
    subtotalBefore += Number(total);
    if (!Number.isSafeInteger(paidQuantity) || !Number.isSafeInteger(subtotalBefore)) {
      throw new RangeError("The cart totals exceed the safe-integer range");
    }
  }

  const campaignIds = new Set<string>();
  for (const campaign of campaigns) {
    if (typeof campaign.id !== "string" || campaign.id.length === 0 || campaignIds.has(campaign.id)) {
      throw new RangeError("Benefit campaigns need unique non-empty ids");
    }
    campaignIds.add(campaign.id);
    validateTiers(campaign.tiers);
  }

  const withScope = campaigns.filter((campaign) =>
    lines.some((line) => line.campaignIds.includes(campaign.id)),
  );

  const unchanged = (
    campaignId: string | null,
    refusal: BenefitEligibilityRefusal | null,
    eligiblePaidQuantity: number,
    basisVnd: number,
  ): BenefitEligibilityResult =>
    finish({
      lines,
      paidQuantity,
      subtotalBefore,
      campaignId,
      refusal,
      eligiblePaidQuantity,
      basisVnd,
      tierIndex: null,
      giftUnlocked: false,
      percentageValue: null,
      benefitLineKeys: new Set(),
      shippingPolicy,
    });

  if (withScope.length === 0) return unchanged(null, null, 0, 0);
  // No ranking: two candidates leave no rule for choosing, so neither is granted.
  if (withScope.length > 1) return unchanged(null, "A1_MULTIPLE_CAMPAIGNS", 0, 0);

  const campaign = withScope[0]!;
  const inScope = lines.filter((line) => line.campaignIds.includes(campaign.id));
  const eligiblePaidQuantity = inScope.reduce((sum, line) => sum + line.quantity, 0);
  const basisVnd = inScope.reduce((sum, line) => sum + line.quantity * line.unitPriceVnd, 0);

  // Whole-campaign refusal: granting next to a line legacy refused to price would risk a double
  // discount the moment legacy becomes decidable.
  if (inScope.some((line) => line.legacy === "AMBIGUOUS")) {
    return unchanged(campaign.id, "A1_LEGACY_AMBIGUOUS", eligiblePaidQuantity, basisVnd);
  }

  let tierIndex: number | null = null;
  for (let index = 0; index < campaign.tiers.length; index += 1) {
    if (tierReached(campaign.tiers[index]!, eligiblePaidQuantity, basisVnd)) tierIndex = index;
  }

  if (tierIndex === null) {
    return unchanged(campaign.id, null, eligiblePaidQuantity, basisVnd);
  }

  const reached = campaign.tiers[tierIndex]!;
  const benefitLineKeys = new Set(
    reached.percentageValue === null
      ? []
      : inScope.filter((line) => line.legacy === "NONE").map((line) => line.lineKey),
  );

  return finish({
    lines,
    paidQuantity,
    subtotalBefore,
    campaignId: campaign.id,
    refusal: null,
    eligiblePaidQuantity,
    basisVnd,
    tierIndex,
    giftUnlocked: reached.percentageValue === null,
    percentageValue: reached.percentageValue,
    benefitLineKeys,
    shippingPolicy,
  });
}

function finish({
  lines,
  paidQuantity,
  subtotalBefore,
  campaignId,
  refusal,
  eligiblePaidQuantity,
  basisVnd,
  tierIndex,
  giftUnlocked,
  percentageValue,
  benefitLineKeys,
  shippingPolicy,
}: Readonly<{
  lines: readonly BenefitEligibilityLine[];
  paidQuantity: number;
  subtotalBefore: number;
  campaignId: string | null;
  refusal: BenefitEligibilityRefusal | null;
  eligiblePaidQuantity: number;
  basisVnd: number;
  tierIndex: number | null;
  giftUnlocked: boolean;
  percentageValue: number | null;
  benefitLineKeys: ReadonlySet<string>;
  shippingPolicy: GuestShippingPolicy | undefined;
}>): BenefitEligibilityResult {
  let paidSubtotal = 0;
  const priced = lines.map((line): BenefitEligibilityLineResult => {
    let finalUnitPriceVnd = line.unitPriceVnd;
    let benefitApplied = false;
    if (percentageValue !== null && benefitLineKeys.has(line.lineKey)) {
      const discounted = percentagePrice(line.unitPriceVnd, percentageValue);
      // `0 < discounted < unit` is what a discount means; a rounding that lands back on the unit
      // price leaves this line alone, as in legacy.
      if (discounted !== null && discounted > 0 && discounted < line.unitPriceVnd) {
        finalUnitPriceVnd = discounted;
        benefitApplied = true;
      }
    }
    const lineTotalVnd = line.quantity * finalUnitPriceVnd;
    paidSubtotal += lineTotalVnd;
    return Object.freeze({ lineKey: line.lineKey, finalUnitPriceVnd, lineTotalVnd, benefitApplied });
  });

  const shippingArguments = {
    subtotalVnd: paidSubtotal,
    totalQuantity: paidQuantity,
  };
  const shippingFeeVnd = shippingPolicy
    ? calculateGuestShippingFeeVnd(shippingArguments, shippingPolicy)
    : calculateGuestShippingFeeVnd(shippingArguments);

  return Object.freeze({
    paidQuantity,
    campaignId,
    refusal,
    eligiblePaidQuantity,
    basisVnd,
    tierIndex,
    giftUnlocked,
    paidSubtotalBeforeBenefitVnd: subtotalBefore,
    discountVnd: subtotalBefore - paidSubtotal,
    paidSubtotalVnd: paidSubtotal,
    shippingFeeVnd,
    totalVnd: paidSubtotal + shippingFeeVnd,
    lines: Object.freeze(priced),
  });
}
