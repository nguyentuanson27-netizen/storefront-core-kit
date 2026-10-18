/**
 * Persistence of the buyer's gift choice (A07). The only module that reads or writes `CartGiftSelection`.
 *
 * The write-time checks are a courtesy that gives the buyer an immediate, typed refusal. They are not the
 * authority: `revalidateCartGift` judges the stored choice against the campaign as it is at that moment,
 * and the composite foreign key makes a gift the campaign does not offer unrepresentable.
 */

import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";

import {
  isCampaignActive,
  resolveGiftSelection,
  type GiftResolution,
} from "./benefit-gift-selection.ts";

export type SelectGiftRefusal = "CART_NOT_FOUND" | "CAMPAIGN_INACTIVE" | "GIFT_NOT_OFFERED";

export type SelectGiftResult = Readonly<{ ok: true }> | Readonly<{ ok: false; reason: SelectGiftRefusal }>;

const ID_MAX_LENGTH = 64;
const validId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= ID_MAX_LENGTH;

/** Records (or replaces) the cart's choice for one campaign. Concurrent writers end with exactly one row. */
export async function selectCartGift(
  prisma: Pick<PrismaClient, "$transaction">,
  input: Readonly<{ cartId: string; campaignId: string; giftVariantId: string; now: Date }>,
): Promise<SelectGiftResult> {
  const { cartId, campaignId, giftVariantId, now } = input;
  if (!validId(cartId)) return { ok: false, reason: "CART_NOT_FOUND" };
  if (!validId(campaignId)) return { ok: false, reason: "CAMPAIGN_INACTIVE" };
  if (!validId(giftVariantId)) return { ok: false, reason: "GIFT_NOT_OFFERED" };

  return prisma.$transaction(async (tx): Promise<SelectGiftResult> => {
    const cart = await tx.cart.findUnique({ where: { id: cartId }, select: { expiresAt: true } });
    if (!cart || cart.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "CART_NOT_FOUND" };

    const campaign = await tx.benefitCampaign.findUnique({
      where: { id: campaignId },
      select: { kind: true, isEnabled: true, startsAt: true, endsAt: true, gifts: { select: { variantId: true } } },
    });
    if (!campaign || campaign.kind !== "GIFT_ITEM" || !isCampaignActive(campaign, now)) {
      return { ok: false, reason: "CAMPAIGN_INACTIVE" };
    }
    if (!campaign.gifts.some((gift) => gift.variantId === giftVariantId)) {
      return { ok: false, reason: "GIFT_NOT_OFFERED" };
    }

    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "CartGiftSelection" ("id", "cartId", "campaignId", "giftVariantId", "updatedAt")
      VALUES (${randomUUID()}, ${cartId}, ${campaignId}, ${giftVariantId}, CURRENT_TIMESTAMP)
      ON CONFLICT ("cartId", "campaignId")
      DO UPDATE SET "giftVariantId" = EXCLUDED."giftVariantId", "updatedAt" = CURRENT_TIMESTAMP
    `);
    return { ok: true };
  });
}

/** Removes the choice. Removing a choice that is not there is a no-op. */
export async function clearCartGift(
  prisma: Pick<PrismaClient, "cartGiftSelection">,
  input: Readonly<{ cartId: string; campaignId: string }>,
): Promise<void> {
  if (!validId(input.cartId) || !validId(input.campaignId)) return;
  await prisma.cartGiftSelection.deleteMany({ where: { cartId: input.cartId, campaignId: input.campaignId } });
}

/**
 * Judges the stored choice against the campaign *now*, from one consistent snapshot. `granted` is the
 * fresh A05 evaluation. The caller (A08) treats `BLOCKED` and `NEEDS_CHOICE` as "this benefit cannot be
 * added"; neither ever picks another gift or changes the paid cart.
 */
export async function revalidateCartGift(
  prisma: Pick<PrismaClient, "$transaction">,
  input: Readonly<{ cartId: string; campaignId: string; granted: boolean; now: Date }>,
): Promise<GiftResolution> {
  const { cartId, campaignId, granted, now } = input;
  if (!validId(cartId) || !validId(campaignId)) return { state: "NOT_APPLICABLE" };

  return prisma.$transaction(
    async (tx) => {
      const campaign = await tx.benefitCampaign.findUnique({
        where: { id: campaignId },
        select: {
          kind: true,
          isEnabled: true,
          startsAt: true,
          endsAt: true,
          gifts: { orderBy: { position: "asc" }, select: { variantId: true, quantity: true } },
        },
      });
      const selection = await tx.cartGiftSelection.findUnique({
        where: { cartId_campaignId: { cartId, campaignId } },
        select: { giftVariantId: true },
      });
      return resolveGiftSelection({
        campaign,
        granted,
        selectedGiftVariantId: selection?.giftVariantId ?? null,
        now,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
