-- Core Kit A/B/C slice A06 (docs/proposals/g3-additive-migration-proposals.md, approved 2026-10-18,
-- simplified to percentage steps by docs/approvals/core-kit-a-b-c-delegated-decisions-2026-10-18.md).
-- Additive only: five new website-owned tables. Nothing existing is altered or backfilled, and with the
-- benefit capabilities off nothing reads or writes them. Every CHECK below is written so it can only be
-- TRUE or FALSE for a row, never NULL (a CHECK passes on NULL).

-- CreateTable
CREATE TABLE "BenefitCampaign" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "enabledAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BenefitCampaign_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BenefitCampaign_kind_known" CHECK ("kind" IN ('GIFT_ITEM', 'QUANTITY_TIER')),
    CONSTRAINT "BenefitCampaign_name_length" CHECK (char_length("name") BETWEEN 1 AND 120),
    CONSTRAINT "BenefitCampaign_window_order" CHECK (
        "startsAt" IS NULL OR "endsAt" IS NULL OR "endsAt" > "startsAt"),
    CONSTRAINT "BenefitCampaign_version_positive" CHECK ("version" >= 1)
);

-- CreateTable
CREATE TABLE "BenefitCampaignTarget" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,

    CONSTRAINT "BenefitCampaignTarget_pkey" PRIMARY KEY ("id"),
    -- Exactly one of productId / variantId.
    CONSTRAINT "BenefitCampaignTarget_exactly_one" CHECK (("productId" IS NULL) <> ("variantId" IS NULL))
);

-- CreateTable
CREATE TABLE "BenefitCampaignTier" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "thresholdQuantity" INTEGER,
    "thresholdSubtotalVnd" BIGINT,
    "percentageValue" INTEGER,

    CONSTRAINT "BenefitCampaignTier_pkey" PRIMARY KEY ("id"),
    -- Owner-approved ceiling: at most eight steps per campaign.
    CONSTRAINT "BenefitCampaignTier_position_range" CHECK ("position" >= 0 AND "position" < 8),
    CONSTRAINT "BenefitCampaignTier_one_threshold" CHECK (("thresholdQuantity" IS NULL) <> ("thresholdSubtotalVnd" IS NULL)),
    CONSTRAINT "BenefitCampaignTier_threshold_positive" CHECK (
        ("thresholdQuantity" IS NULL OR "thresholdQuantity" >= 1)
        AND ("thresholdSubtotalVnd" IS NULL OR ("thresholdSubtotalVnd" >= 1 AND "thresholdSubtotalVnd" <= 9007199254740991))),
    CONSTRAINT "BenefitCampaignTier_percentage_range" CHECK (
        "percentageValue" IS NULL OR ("percentageValue" >= 1 AND "percentageValue" <= 99))
);

-- CreateTable
CREATE TABLE "BenefitCampaignGift" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "BenefitCampaignGift_pkey" PRIMARY KEY ("id"),
    -- Owner-approved ceilings: at most five gifts, each of quantity 1-5.
    CONSTRAINT "BenefitCampaignGift_position_range" CHECK ("position" >= 0 AND "position" < 5),
    CONSTRAINT "BenefitCampaignGift_quantity_range" CHECK ("quantity" >= 1 AND "quantity" <= 5)
);

-- CreateTable
CREATE TABLE "BenefitRevision" (
    "id" TEXT NOT NULL DEFAULT 'current',
    "revision" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BenefitRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BenefitCampaign_isEnabled_startsAt_endsAt_idx" ON "BenefitCampaign"("isEnabled", "startsAt", "endsAt");
CREATE INDEX "BenefitCampaign_createdByUserId_idx" ON "BenefitCampaign"("createdByUserId");
CREATE UNIQUE INDEX "BenefitCampaignTarget_campaignId_productId_key" ON "BenefitCampaignTarget"("campaignId", "productId");
CREATE UNIQUE INDEX "BenefitCampaignTarget_campaignId_variantId_key" ON "BenefitCampaignTarget"("campaignId", "variantId");
CREATE INDEX "BenefitCampaignTarget_productId_idx" ON "BenefitCampaignTarget"("productId");
CREATE INDEX "BenefitCampaignTarget_variantId_idx" ON "BenefitCampaignTarget"("variantId");
CREATE UNIQUE INDEX "BenefitCampaignTier_campaignId_position_key" ON "BenefitCampaignTier"("campaignId", "position");
CREATE UNIQUE INDEX "BenefitCampaignGift_campaignId_variantId_key" ON "BenefitCampaignGift"("campaignId", "variantId");
CREATE UNIQUE INDEX "BenefitCampaignGift_campaignId_position_key" ON "BenefitCampaignGift"("campaignId", "position");
CREATE INDEX "BenefitCampaignGift_variantId_idx" ON "BenefitCampaignGift"("variantId");

-- AddForeignKey: removing the admin keeps the campaign and forgets who created it.
ALTER TABLE "BenefitCampaign" ADD CONSTRAINT "BenefitCampaign_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: a campaign's definition follows the campaign; a target or gift follows its catalog row.
ALTER TABLE "BenefitCampaignTarget" ADD CONSTRAINT "BenefitCampaignTarget_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BenefitCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BenefitCampaignTarget" ADD CONSTRAINT "BenefitCampaignTarget_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ProductMirror"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BenefitCampaignTarget" ADD CONSTRAINT "BenefitCampaignTarget_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "VariantMirror"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BenefitCampaignTier" ADD CONSTRAINT "BenefitCampaignTier_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BenefitCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BenefitCampaignGift" ADD CONSTRAINT "BenefitCampaignGift_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BenefitCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BenefitCampaignGift" ADD CONSTRAINT "BenefitCampaignGift_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "VariantMirror"("id") ON DELETE CASCADE ON UPDATE CASCADE;
