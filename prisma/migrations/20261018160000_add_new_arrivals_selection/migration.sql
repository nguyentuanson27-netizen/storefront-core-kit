-- Core Kit A/B/C slice B01 (docs/proposals/g3-additive-migration-proposals.md, approved 2026-10-18).
-- Additive only: two new website-owned tables. Nothing existing is altered or backfilled, and with
-- the feature flag OFF nothing reads or writes them.

-- CreateTable
CREATE TABLE "NewArrivalsSelection" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedByUserId" TEXT,

    CONSTRAINT "NewArrivalsSelection_pkey" PRIMARY KEY ("id"),
    -- With UNIQUE(position) this makes "at most 500 slots" a database fact (owner-approved ceiling).
    CONSTRAINT "NewArrivalsSelection_position_range" CHECK ("position" >= 0 AND "position" < 500)
);

-- CreateTable
CREATE TABLE "NewArrivalsSelectionState" (
    "id" TEXT NOT NULL DEFAULT 'current',
    "revision" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewArrivalsSelectionState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NewArrivalsSelection_productId_key" ON "NewArrivalsSelection"("productId");

-- Deferrable so an atomic reorder inside one transaction may pass through duplicate positions; the
-- constraint is still enforced at commit. Prisma models this as a plain unique and reports no drift.
ALTER TABLE "NewArrivalsSelection"
    ADD CONSTRAINT "NewArrivalsSelection_position_key" UNIQUE ("position") DEFERRABLE INITIALLY DEFERRED;

-- CreateIndex
CREATE INDEX "NewArrivalsSelection_updatedByUserId_idx" ON "NewArrivalsSelection"("updatedByUserId");

-- AddForeignKey: a slot follows its product.
ALTER TABLE "NewArrivalsSelection" ADD CONSTRAINT "NewArrivalsSelection_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ProductMirror"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: removing the admin keeps the slot and forgets who placed it.
ALTER TABLE "NewArrivalsSelection" ADD CONSTRAINT "NewArrivalsSelection_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
