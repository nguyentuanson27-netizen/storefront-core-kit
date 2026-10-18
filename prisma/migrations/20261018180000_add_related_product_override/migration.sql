-- Core Kit A/B/C slice B05 (docs/proposals/g3-additive-migration-proposals.md, approved 2026-10-18).
-- Additive only: one new website-owned table. Nothing existing is altered or backfilled, and with the
-- feature flag OFF nothing reads or writes it.

-- CreateTable
CREATE TABLE "RelatedProductOverride" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "relatedProductId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedByUserId" TEXT,

    CONSTRAINT "RelatedProductOverride_pkey" PRIMARY KEY ("id"),
    -- A product is never its own related product.
    CONSTRAINT "RelatedProductOverride_not_self" CHECK ("productId" <> "relatedProductId"),
    -- Owner-approved bound: at most 8 manual candidates per product.
    CONSTRAINT "RelatedProductOverride_position_range" CHECK ("position" >= 0 AND "position" < 8)
);

-- CreateIndex
CREATE UNIQUE INDEX "RelatedProductOverride_productId_relatedProductId_key" ON "RelatedProductOverride"("productId", "relatedProductId");

-- Deferrable so a reorder inside one transaction may pass through duplicate positions; still enforced at commit.
ALTER TABLE "RelatedProductOverride"
    ADD CONSTRAINT "RelatedProductOverride_productId_position_key" UNIQUE ("productId", "position") DEFERRABLE INITIALLY DEFERRED;

-- CreateIndex
CREATE INDEX "RelatedProductOverride_relatedProductId_idx" ON "RelatedProductOverride"("relatedProductId");

-- CreateIndex
CREATE INDEX "RelatedProductOverride_updatedByUserId_idx" ON "RelatedProductOverride"("updatedByUserId");

-- AddForeignKey: the pair follows either product.
ALTER TABLE "RelatedProductOverride" ADD CONSTRAINT "RelatedProductOverride_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ProductMirror"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelatedProductOverride" ADD CONSTRAINT "RelatedProductOverride_relatedProductId_fkey" FOREIGN KEY ("relatedProductId") REFERENCES "ProductMirror"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: removing the admin keeps the pair and forgets who chose it.
ALTER TABLE "RelatedProductOverride" ADD CONSTRAINT "RelatedProductOverride_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
