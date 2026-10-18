-- Core Kit A/B/C slice B04 (docs/proposals/g3-additive-migration-proposals.md, approved 2026-10-18).
-- Additive only: two new website-owned tables. Nothing existing is altered or backfilled, and with the
-- feature flag OFF nothing reads or writes them.

-- CreateTable
CREATE TABLE "HomepageFeaturedProduct" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedByUserId" TEXT,

    CONSTRAINT "HomepageFeaturedProduct_pkey" PRIMARY KEY ("id"),
    -- With UNIQUE(position) this makes "at most 12 slots" a database fact (owner-approved ceiling).
    CONSTRAINT "HomepageFeaturedProduct_position_range" CHECK ("position" >= 0 AND "position" < 12)
);

-- CreateTable
CREATE TABLE "HomepageFeaturedState" (
    "id" TEXT NOT NULL DEFAULT 'current',
    "revision" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomepageFeaturedState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HomepageFeaturedProduct_productId_key" ON "HomepageFeaturedProduct"("productId");

-- Deferrable so an atomic reorder may pass through duplicate positions; still enforced at commit.
ALTER TABLE "HomepageFeaturedProduct"
    ADD CONSTRAINT "HomepageFeaturedProduct_position_key" UNIQUE ("position") DEFERRABLE INITIALLY DEFERRED;

-- CreateIndex
CREATE INDEX "HomepageFeaturedProduct_updatedByUserId_idx" ON "HomepageFeaturedProduct"("updatedByUserId");

-- AddForeignKey: a slot follows its product.
ALTER TABLE "HomepageFeaturedProduct" ADD CONSTRAINT "HomepageFeaturedProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ProductMirror"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: removing the admin keeps the slot and forgets who placed it.
ALTER TABLE "HomepageFeaturedProduct" ADD CONSTRAINT "HomepageFeaturedProduct_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
