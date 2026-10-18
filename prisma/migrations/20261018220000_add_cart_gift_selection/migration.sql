-- Core Kit A/B/C slice A07 (selected-gift state; own small G3 review recorded in
-- docs/approvals/core-kit-a-b-c-delegated-decisions-2026-10-18.md).
-- Additive only: one new website-owned table. Nothing existing is altered or backfilled, and with the
-- benefit capabilities off nothing reads or writes it. The composite foreign key to
-- "BenefitCampaignGift" means the database itself refuses a gift the campaign does not offer, and
-- removes the choice if the campaign stops offering it.

-- CreateTable
CREATE TABLE "CartGiftSelection" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "giftVariantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CartGiftSelection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CartGiftSelection_campaignId_giftVariantId_idx" ON "CartGiftSelection"("campaignId", "giftVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "CartGiftSelection_cartId_campaignId_key" ON "CartGiftSelection"("cartId", "campaignId");

-- AddForeignKey
ALTER TABLE "CartGiftSelection" ADD CONSTRAINT "CartGiftSelection_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartGiftSelection" ADD CONSTRAINT "CartGiftSelection_campaignId_giftVariantId_fkey" FOREIGN KEY ("campaignId", "giftVariantId") REFERENCES "BenefitCampaignGift"("campaignId", "variantId") ON DELETE CASCADE ON UPDATE CASCADE;

