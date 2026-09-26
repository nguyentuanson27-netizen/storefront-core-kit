-- Local capacity reservations (spec: docs/specs/core-kit-production-hardening-v1.md §5).
--
-- Additive and with no backfill: before this migration no order ever held capacity, so there is no
-- historical hold to reconstruct. An application rollback is safe while these tables exist, because
-- older code neither reads nor writes them; it simply stops creating holds. Do not drop them as a
-- rollback: they are the audit trail for capacity that orders consumed.
--
-- What the database cannot enforce: the capacity arithmetic itself (mirrored stock minus active holds
-- stays non-negative) spans tables and is enforced by the reservation transaction, which locks the
-- always-present VariantMirror rows before reading competing holds. The CHECKs below are intra-row only.

-- CreateEnum
CREATE TYPE "CapacityResourceKind" AS ENUM ('SELF', 'COMPONENT');

-- CreateTable
CREATE TABLE "CapacityReservation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapacityReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapacityReservationResource" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "kind" "CapacityResourceKind" NOT NULL,
    "unitsPerLine" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "mirroredAt" TIMESTAMP(3),
    "mirrorObservationStartedAt" TIMESTAMP(3),

    CONSTRAINT "CapacityReservationResource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CapacityReservation_variantId_idx" ON "CapacityReservation"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "CapacityReservation_orderId_variantId_key" ON "CapacityReservation"("orderId", "variantId");

-- CreateIndex
CREATE INDEX "CapacityReservationResource_variantId_mirroredAt_idx" ON "CapacityReservationResource"("variantId", "mirroredAt");

-- CreateIndex
CREATE UNIQUE INDEX "CapacityReservationResource_reservationId_variantId_key" ON "CapacityReservationResource"("reservationId", "variantId");

-- AddForeignKey
ALTER TABLE "CapacityReservation" ADD CONSTRAINT "CapacityReservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "OrderMirror"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapacityReservation" ADD CONSTRAINT "CapacityReservation_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "VariantMirror"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapacityReservationResource" ADD CONSTRAINT "CapacityReservationResource_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "CapacityReservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapacityReservationResource" ADD CONSTRAINT "CapacityReservationResource_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "VariantMirror"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Intra-row invariants.
ALTER TABLE "CapacityReservation"
  ADD CONSTRAINT "CapacityReservation_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "CapacityReservationResource"
  ADD CONSTRAINT "CapacityReservationResource_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "CapacityReservationResource"
  ADD CONSTRAINT "CapacityReservationResource_units_positive" CHECK ("unitsPerLine" > 0);

-- A whole number of purchased units: the resource quantity is always line quantity x unitsPerLine.
ALTER TABLE "CapacityReservationResource"
  ADD CONSTRAINT "CapacityReservationResource_whole_line_units" CHECK ("quantity" % "unitsPerLine" = 0);

-- A standalone line consumes exactly its own unit.
ALTER TABLE "CapacityReservationResource"
  ADD CONSTRAINT "CapacityReservationResource_self_is_one_unit" CHECK ("kind" <> 'SELF' OR "unitsPerLine" = 1);

-- A handoff records its evidence: no mirroredAt without the observation that justified it, and no
-- evidence left behind on a resource that still counts.
ALTER TABLE "CapacityReservationResource"
  ADD CONSTRAINT "CapacityReservationResource_handoff_has_evidence"
  CHECK (("mirroredAt" IS NULL) = ("mirrorObservationStartedAt" IS NULL));
