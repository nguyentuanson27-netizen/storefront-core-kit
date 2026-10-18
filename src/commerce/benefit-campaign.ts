/**
 * Benefit campaign definitions and the publish-time overlap rules (A06): pure, no storage.
 *
 * Validation is the application half of every bound the migration also enforces (the other half is
 * the database). The overlap predicate is the accepted F01 technical review §1.3: two campaigns
 * conflict when their enabled windows intersect and their scopes intersect; an A1 campaign also
 * conflicts with an enabled legacy campaign whose explicit targets it shares — except that a
 * store-wide A1 campaign skips the legacy refusal (owner decision 2, 2026-10-18) because the runtime
 * rules of A05 already keep a legacy-discounted line out of the A1 price benefit.
 */

export const BENEFIT_MAX_TIERS = 8;
export const BENEFIT_MAX_GIFTS = 5;
export const BENEFIT_MAX_GIFT_QUANTITY = 5;
export const BENEFIT_MAX_TARGETS = 200;
export const BENEFIT_MAX_NAME_LENGTH = 120;
export const BENEFIT_MAX_PERCENTAGE = 99;

export type BenefitCampaignKind = "GIFT_ITEM" | "QUANTITY_TIER";

export type BenefitTierDraft = Readonly<{
  /** Exactly one of the two. */
  thresholdQuantity: number | null;
  thresholdSubtotalVnd: number | null;
  /** NULL for a gift step; 1-99 for a price step. */
  percentageValue: number | null;
}>;

export type BenefitGiftDraft = Readonly<{ variantId: string; quantity: number }>;

export type BenefitTargetDraft = Readonly<{ productId: string } | { variantId: string }>;

export type BenefitCampaignDraft = Readonly<{
  kind: BenefitCampaignKind;
  name: string;
  startsAt: Date | null;
  endsAt: Date | null;
  /** Empty = store-wide. */
  targets: readonly BenefitTargetDraft[];
  tiers: readonly BenefitTierDraft[];
  gifts: readonly BenefitGiftDraft[];
}>;

export type BenefitDraftRefusal =
  | "INVALID_KIND"
  | "INVALID_NAME"
  | "INVALID_WINDOW"
  | "INVALID_TARGETS"
  | "INVALID_TIERS"
  | "INVALID_GIFTS";

export type BenefitDraftValidation =
  | Readonly<{ ok: true; draft: BenefitCampaignDraft }>
  | Readonly<{ ok: false; reason: BenefitDraftRefusal }>;

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64;
}

function isDateOrNull(value: unknown): value is Date | null {
  return value === null || (value instanceof Date && Number.isFinite(value.getTime()));
}

/** Validates a campaign definition. Never throws: a bad definition is a typed refusal. */
export function validateBenefitCampaignDraft(input: BenefitCampaignDraft): BenefitDraftValidation {
  if (input?.kind !== "GIFT_ITEM" && input?.kind !== "QUANTITY_TIER") return { ok: false, reason: "INVALID_KIND" };

  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length < 1 || name.length > BENEFIT_MAX_NAME_LENGTH) return { ok: false, reason: "INVALID_NAME" };

  if (
    !isDateOrNull(input.startsAt) ||
    !isDateOrNull(input.endsAt) ||
    (input.startsAt !== null && input.endsAt !== null && input.endsAt.getTime() <= input.startsAt.getTime())
  ) {
    return { ok: false, reason: "INVALID_WINDOW" };
  }

  if (!Array.isArray(input.targets) || input.targets.length > BENEFIT_MAX_TARGETS) {
    return { ok: false, reason: "INVALID_TARGETS" };
  }
  const seenTargets = new Set<string>();
  for (const target of input.targets) {
    const hasProduct = "productId" in target && target.productId !== undefined;
    const hasVariant = "variantId" in target && (target as { variantId?: unknown }).variantId !== undefined;
    if (hasProduct === hasVariant) return { ok: false, reason: "INVALID_TARGETS" };
    const id = hasProduct ? (target as { productId: unknown }).productId : (target as { variantId: unknown }).variantId;
    const key = `${hasProduct ? "p" : "v"}:${String(id)}`;
    if (!isId(id) || seenTargets.has(key)) return { ok: false, reason: "INVALID_TARGETS" };
    seenTargets.add(key);
  }

  if (!Array.isArray(input.tiers) || input.tiers.length < 1 || input.tiers.length > BENEFIT_MAX_TIERS) {
    return { ok: false, reason: "INVALID_TIERS" };
  }
  const byQuantity = input.tiers[0]!.thresholdQuantity !== null;
  let previous = 0;
  for (const tier of input.tiers) {
    const hasQuantity = tier.thresholdQuantity !== null;
    const hasSubtotal = tier.thresholdSubtotalVnd !== null;
    if (hasQuantity === hasSubtotal || hasQuantity !== byQuantity) return { ok: false, reason: "INVALID_TIERS" };
    const threshold = hasQuantity ? tier.thresholdQuantity! : tier.thresholdSubtotalVnd!;
    if (
      !Number.isSafeInteger(threshold) ||
      threshold < 1 ||
      threshold <= previous
    ) {
      return { ok: false, reason: "INVALID_TIERS" };
    }
    previous = threshold;
    const isPrice = tier.percentageValue !== null;
    if (isPrice !== (input.kind === "QUANTITY_TIER")) return { ok: false, reason: "INVALID_TIERS" };
    if (isPrice && (!Number.isSafeInteger(tier.percentageValue) || tier.percentageValue! < 1 || tier.percentageValue! > BENEFIT_MAX_PERCENTAGE)) {
      return { ok: false, reason: "INVALID_TIERS" };
    }
  }
  // A gift campaign has exactly one step (the threshold that unlocks the gifts).
  if (input.kind === "GIFT_ITEM" && input.tiers.length !== 1) return { ok: false, reason: "INVALID_TIERS" };

  if (!Array.isArray(input.gifts)) return { ok: false, reason: "INVALID_GIFTS" };
  if (input.kind === "QUANTITY_TIER" && input.gifts.length !== 0) return { ok: false, reason: "INVALID_GIFTS" };
  if (input.kind === "GIFT_ITEM" && (input.gifts.length < 1 || input.gifts.length > BENEFIT_MAX_GIFTS)) {
    return { ok: false, reason: "INVALID_GIFTS" };
  }
  const seenGifts = new Set<string>();
  for (const gift of input.gifts) {
    if (
      !isId(gift.variantId) ||
      seenGifts.has(gift.variantId) ||
      !Number.isSafeInteger(gift.quantity) ||
      gift.quantity < 1 ||
      gift.quantity > BENEFIT_MAX_GIFT_QUANTITY
    ) {
      return { ok: false, reason: "INVALID_GIFTS" };
    }
    seenGifts.add(gift.variantId);
  }

  return { ok: true, draft: { ...input, name } };
}

/** A campaign as the overlap rules see it: a window and the set of products it covers. */
export type BenefitScopeFacts = Readonly<{
  id: string;
  name: string;
  startsAt: Date | null;
  endsAt: Date | null;
  /** Explicit product targets; null = store-wide. */
  productIds: ReadonlySet<string> | null;
  /** Explicit variant IDs and their parent product IDs. */
  variantProductIds: ReadonlyMap<string, string>;
}>;

export type BenefitConflict = Readonly<{
  with: "BENEFIT" | "LEGACY";
  id: string;
  name: string;
}>;

/** Half-open `[start, end)` windows, `null` unbounded on that side. */
export function windowsIntersect(
  left: Readonly<{ startsAt: Date | null; endsAt: Date | null }>,
  right: Readonly<{ startsAt: Date | null; endsAt: Date | null }>,
): boolean {
  const leftStart = left.startsAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const leftEnd = left.endsAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightStart = right.startsAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const rightEnd = right.endsAt?.getTime() ?? Number.POSITIVE_INFINITY;
  return leftStart < rightEnd && rightStart < leftEnd;
}

function scopesIntersect(left: BenefitScopeFacts, right: BenefitScopeFacts): boolean {
  if (left.productIds === null || right.productIds === null) return true;
  for (const productId of left.productIds) if (right.productIds.has(productId)) return true;
  for (const [variantId, productId] of left.variantProductIds) {
    if (right.productIds.has(productId) || right.variantProductIds.has(variantId)) return true;
  }
  for (const productId of right.variantProductIds.values()) {
    if (left.productIds.has(productId)) return true;
  }
  return false;
}

/**
 * Everything that forbids publishing `candidate` now.
 *
 * - against another enabled benefit campaign: windows and scopes intersect (store-wide intersects all);
 * - against an enabled legacy campaign: windows intersect and *both* have explicit scopes that share a
 *   product. A store-wide candidate skips this check, and so does a legacy campaign with no explicit
 *   scope (the runtime rules keep legacy-discounted lines out of the A1 price benefit).
 */
export function findBenefitPublishConflicts(
  candidate: BenefitScopeFacts,
  enabledBenefit: readonly BenefitScopeFacts[],
  enabledLegacy: readonly BenefitScopeFacts[],
): BenefitConflict[] {
  const conflicts: BenefitConflict[] = [];
  for (const other of enabledBenefit) {
    if (other.id === candidate.id) continue;
    if (windowsIntersect(candidate, other) && scopesIntersect(candidate, other)) {
      conflicts.push({ with: "BENEFIT", id: other.id, name: other.name });
    }
  }
  if (candidate.productIds !== null) {
    for (const other of enabledLegacy) {
      if (other.productIds === null) continue;
      if (windowsIntersect(candidate, other) && scopesIntersect(candidate, other)) {
        conflicts.push({ with: "LEGACY", id: other.id, name: other.name });
      }
    }
  }
  return conflicts;
}
