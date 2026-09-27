-- Only resources whose accounting is still local (`mirroredAt IS NULL`) are ever summed as holds or
-- considered for handoff, but the ledger keeps every handed-off row for history and grows with each
-- order. This partial index keeps both hot paths (the per-variant hold sum at checkout and in the
-- storefront, and the handoff UPDATE inside every catalog sync) proportional to live holds rather
-- than to the whole order history. Additive; no data change.
CREATE INDEX "CapacityReservationResource_unmirrored_idx"
  ON "CapacityReservationResource" ("variantId", "reservationId")
  WHERE "mirroredAt" IS NULL;
