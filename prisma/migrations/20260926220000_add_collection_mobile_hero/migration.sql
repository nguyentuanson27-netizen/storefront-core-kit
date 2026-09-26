-- Optional mobile hero for a collection (spec: core-kit-production-hardening-v1 §8.2).
--
-- Additive and nullable: a collection without one keeps rendering its desktop hero everywhere, and
-- older application code never reads the column. Stored as written and revalidated on read against the
-- trusted Pancake image contract, exactly like `heroImageUrl`.
ALTER TABLE "CollectionDefinition" ADD COLUMN "heroMobileImageUrl" TEXT;
