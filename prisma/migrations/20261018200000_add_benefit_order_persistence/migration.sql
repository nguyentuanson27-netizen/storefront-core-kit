-- Core Kit A/B/C slice A02 (docs/proposals/g3-additive-migration-proposals.md, approved 2026-10-18).
-- Additive only: nullable columns and new constraints that every existing row satisfies vacuously
-- (they are NULL on all legacy rows). Nothing is rewritten or backfilled, and no fake gift is ever
-- created for an old order. Old code that never writes these columns keeps working unchanged.

-- AlterTable
ALTER TABLE "OrderLineSnapshot"
    ADD COLUMN "lineId" TEXT,
    ADD COLUMN "lineRole" TEXT,
    ADD COLUMN "benefitCampaignId" TEXT,
    ADD COLUMN "benefitKind" TEXT,
    ADD COLUMN "benefitCampaignName" TEXT,
    ADD COLUMN "entitlementKey" TEXT;

-- AlterTable
ALTER TABLE "OrderMirror"
    ADD COLUMN "quoteVersion" INTEGER,
    ADD COLUMN "benefitCampaignId" TEXT,
    ADD COLUMN "benefitEligibleQuantity" INTEGER,
    ADD COLUMN "benefitBasisVnd" BIGINT,
    ADD COLUMN "benefitTierIndex" INTEGER;

-- CreateIndex: NULLs are distinct, so legacy rows (lineId IS NULL) never collide.
CREATE UNIQUE INDEX "OrderLineSnapshot_orderId_lineId_key" ON "OrderLineSnapshot"("orderId", "lineId");

-- A v2 line has both a lineId and a role, a gift is free, a paid line is not, and a campaign kind is
-- one of the two known ones. Legacy rows (every new column NULL) satisfy the first branch. Each test in
-- the second branch is written so it can only be TRUE or FALSE, never NULL: a CHECK treats NULL as a pass.
ALTER TABLE "OrderLineSnapshot" ADD CONSTRAINT "OrderLineSnapshot_v2_shape" CHECK (
    ("lineId" IS NULL AND "lineRole" IS NULL AND "benefitCampaignId" IS NULL AND "benefitKind" IS NULL
        AND "benefitCampaignName" IS NULL AND "entitlementKey" IS NULL)
    OR (
        "lineId" IS NOT NULL
        AND char_length("lineId") BETWEEN 1 AND 64
        AND "lineRole" IS NOT NULL
        AND "lineRole" IN ('PAID', 'GIFT')
        AND ("benefitKind" IS NULL OR "benefitKind" IN ('GIFT_ITEM', 'QUANTITY_TIER'))
        AND ("lineRole" <> 'GIFT' OR (
            "unitPriceVnd" = 0 AND "lineTotalVnd" = 0
            AND "benefitCampaignId" IS NOT NULL AND "entitlementKey" IS NOT NULL))
        AND ("lineRole" <> 'PAID' OR ("unitPriceVnd" > 0 AND "entitlementKey" IS NULL))
    )
);

-- AddConstraint: only the known quote version, or NULL for legacy.
ALTER TABLE "OrderMirror" ADD CONSTRAINT "OrderMirror_quoteVersion_known" CHECK ("quoteVersion" IS NULL OR "quoteVersion" = 2);

-- The granted campaign's frozen facts exist only on a v2 order, come together (campaign id, eligible
-- quantity and basis), and a tier needs a grant. Every test is written to be TRUE or FALSE, never NULL.
ALTER TABLE "OrderMirror" ADD CONSTRAINT "OrderMirror_benefit_facts" CHECK (
    ("quoteVersion" IS NULL
        AND "benefitCampaignId" IS NULL AND "benefitEligibleQuantity" IS NULL AND "benefitBasisVnd" IS NULL
        AND "benefitTierIndex" IS NULL)
    OR ("quoteVersion" IS NOT NULL AND "quoteVersion" = 2
        AND ("benefitEligibleQuantity" IS NULL) = ("benefitBasisVnd" IS NULL)
        AND ("benefitCampaignId" IS NULL) = ("benefitEligibleQuantity" IS NULL)
        AND ("benefitCampaignId" IS NULL OR char_length("benefitCampaignId") BETWEEN 1 AND 128)
        AND ("benefitEligibleQuantity" IS NULL OR "benefitEligibleQuantity" >= 0)
        AND ("benefitBasisVnd" IS NULL OR "benefitBasisVnd" >= 0)
        AND ("benefitTierIndex" IS NULL OR (
            "benefitEligibleQuantity" IS NOT NULL AND "benefitTierIndex" BETWEEN 0 AND 7)))
);
