/**
 * Fresh-entitlement resolution for a selected gift (A07). Pure: facts in, a closed set of outcomes out.
 *
 * The contract decided under the owner's delegation (docs/approvals/core-kit-a-b-c-delegated-decisions-2026-10-18.md):
 * a gift campaign's gifts are *alternatives* and the buyer takes exactly one. A campaign that offers a
 * single gift needs no choice. The selection is only a choice among what the campaign offers *now*:
 *
 * - it never carries a price, a quantity or a campaign definition (quantity comes from the campaign's own
 *   gift row, so the client cannot ask for more);
 * - it is judged again against the campaign as it is at this moment, never against what it was when the
 *   gift was chosen;
 * - a gift that is no longer valid is never replaced by another one. The benefit simply cannot be added
 *   until the buyer chooses again, and the paid cart is not touched.
 */

export type GiftOffer = Readonly<{ variantId: string; quantity: number }>;

export type GiftCampaignFacts = Readonly<{
  kind: string;
  isEnabled: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  gifts: readonly GiftOffer[];
}>;

export type GiftBlockReason = "CAMPAIGN_INACTIVE" | "GIFT_NOT_OFFERED" | "NO_GIFTS_OFFERED";

export type GiftResolution =
  /** Nothing to resolve: no gift campaign, or the benefit is not granted for this cart. */
  | Readonly<{ state: "NOT_APPLICABLE" }>
  /** Granted, more than one gift is offered and none is chosen. */
  | Readonly<{ state: "NEEDS_CHOICE"; offers: readonly GiftOffer[] }>
  | Readonly<{ state: "READY"; gift: GiftOffer }>
  /** The stored choice, or the campaign itself, is no longer valid. Affected benefit checkout is blocked. */
  | Readonly<{ state: "BLOCKED"; reason: GiftBlockReason }>;

/** Half-open `[startsAt, endsAt)`; a missing bound is unbounded on that side. */
export function isCampaignActive(
  campaign: Pick<GiftCampaignFacts, "isEnabled" | "startsAt" | "endsAt">,
  now: Date,
): boolean {
  if (!campaign.isEnabled) return false;
  const at = now.getTime();
  if (!Number.isFinite(at)) return false;
  if (campaign.startsAt !== null && at < campaign.startsAt.getTime()) return false;
  if (campaign.endsAt !== null && at >= campaign.endsAt.getTime()) return false;
  return true;
}

export function resolveGiftSelection(
  input: Readonly<{
    campaign: GiftCampaignFacts | null;
    /** Whether the fresh A05 evaluation grants this campaign to the cart. */
    granted: boolean;
    selectedGiftVariantId: string | null;
    now: Date;
  }>,
): GiftResolution {
  const { campaign, granted, selectedGiftVariantId, now } = input;
  if (campaign === null || campaign.kind !== "GIFT_ITEM" || !granted) return { state: "NOT_APPLICABLE" };
  if (!isCampaignActive(campaign, now)) return { state: "BLOCKED", reason: "CAMPAIGN_INACTIVE" };

  const offers = campaign.gifts;
  if (offers.length === 0) return { state: "BLOCKED", reason: "NO_GIFTS_OFFERED" };

  if (selectedGiftVariantId !== null) {
    const chosen = offers.find((offer) => offer.variantId === selectedGiftVariantId);
    return chosen ? { state: "READY", gift: chosen } : { state: "BLOCKED", reason: "GIFT_NOT_OFFERED" };
  }
  const [only] = offers;
  return offers.length === 1 && only ? { state: "READY", gift: only } : { state: "NEEDS_CHOICE", offers };
}
