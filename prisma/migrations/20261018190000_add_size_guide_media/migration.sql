-- Core Kit A/B/C slice B06 (docs/proposals/g3-additive-migration-proposals.md, approved 2026-10-18).
-- Additive only: one new website-owned table. Nothing existing is altered or backfilled, and with the
-- feature flag OFF nothing reads or writes it.

-- CreateTable
CREATE TABLE "SizeGuideMedia" (
    "guideKey" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "altText" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SizeGuideMedia_pkey" PRIMARY KEY ("guideKey"),
    -- The application validates these first; the database refuses what it should never be handed.
    CONSTRAINT "SizeGuideMedia_guideKey_length" CHECK (char_length("guideKey") BETWEEN 1 AND 64),
    CONSTRAINT "SizeGuideMedia_imageUrl_https" CHECK ("imageUrl" ~ '^https://' AND char_length("imageUrl") <= 2048),
    CONSTRAINT "SizeGuideMedia_altText_length" CHECK (char_length("altText") BETWEEN 1 AND 300),
    CONSTRAINT "SizeGuideMedia_dimensions" CHECK ("width" BETWEEN 1 AND 8000 AND "height" BETWEEN 1 AND 8000)
);

-- CreateIndex
CREATE INDEX "SizeGuideMedia_updatedByUserId_idx" ON "SizeGuideMedia"("updatedByUserId");

-- AddForeignKey: removing the admin keeps the image and forgets who set it.
ALTER TABLE "SizeGuideMedia" ADD CONSTRAINT "SizeGuideMedia_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
