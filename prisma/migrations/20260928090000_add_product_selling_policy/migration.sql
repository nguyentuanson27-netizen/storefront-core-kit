-- Selling Modes v1, slice M1 (docs/specs/core-kit-selling-modes-v1.md §4.1).
-- Additive only: a new enum and a new website-owned table. No backfill: a product with no row is
-- STANDARD with the default limit, and that answer belongs to resolveSellingPolicy().

-- CreateEnum
CREATE TYPE "SellingMode" AS ENUM ('STANDARD', 'OVERSELL', 'PREORDER');

-- CreateTable
CREATE TABLE "ProductSellingPolicy" (
    "productId" TEXT NOT NULL,
    "sellingMode" "SellingMode" NOT NULL,
    "negativeStockLimit" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "ProductSellingPolicy_pkey" PRIMARY KEY ("productId"),
    -- Prisma cannot express this range; the resolver also fails closed on it (§4.2).
    CONSTRAINT "ProductSellingPolicy_negativeStockLimit_range"
        CHECK ("negativeStockLimit" <= 0 AND "negativeStockLimit" >= -100000)
);

-- CreateIndex
CREATE INDEX "ProductSellingPolicy_updatedByUserId_idx" ON "ProductSellingPolicy"("updatedByUserId");

-- AddForeignKey: configuration follows its product.
ALTER TABLE "ProductSellingPolicy" ADD CONSTRAINT "ProductSellingPolicy_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ProductMirror"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: removing the admin user keeps the policy and forgets who set it.
ALTER TABLE "ProductSellingPolicy" ADD CONSTRAINT "ProductSellingPolicy_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
