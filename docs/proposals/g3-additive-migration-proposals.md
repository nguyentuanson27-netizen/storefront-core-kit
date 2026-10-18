# G3 additive migration designs — A02, A06, B01, B04, B05, B06 (approved by delegation, none applied yet)

**Status:** **A02, A06, B01, B04, B05, B06 APPROVED under the owner's delegation** — see the [delegated decision record](../approvals/core-kit-a-b-c-delegated-decisions-2026-10-18.md) for the review outcome and the changes it made to the drafts below (A06 is percentage-only; B06 reuses `parseTrustedProductImageUrl`). Approval permits writing the migration as implementation, tested on CI/local databases only; applying anything to a shared or production database remains a G6 deployment step. The owner approved *drafting* additive designs ([decision record](../approvals/core-kit-a-b-c-owner-decisions-2026-10-18.md) §3). **No schema diff, SQL file or migration is in the repository, and none may be added until the section for that slice is approved.** Each section is its own G3 checkbox; approving one does not approve another.

Existing facts these proposals rely on (all from `prisma/schema.prisma` on `main`):

- The schema is **single-shop**: there is no `shopId` column on catalog, order or promotion tables (`pancakeShopId` exists only as an order attribute). "Shop-scoped authorization" here therefore means *authenticated admin role for this deployment*; adding `shopId` to new tables would invent a tenancy model the rest of the schema lacks. If multi-shop is later wanted it is a separate, cross-cutting migration.
- Precedents to copy: hand-written `CHECK` constraints inside migrations (`ProductSellingPolicy`, `PromotionTarget` exactly-one-of), a single-row revision table (`PromotionPricingRevision`), `onDelete: Cascade` from mirror tables for website-owned rows, `onDelete: SetNull` for `updatedByUserId`.
- Migration naming: `YYYYMMDDHHMMSS_<snake_case>` after `20260928090000_add_product_selling_policy`; each migration is one transaction of purely additive statements.

## Rules common to every slice

1. **Additive only:** `CREATE TABLE`, `ADD COLUMN` nullable (or with a constant default), `CREATE INDEX`, `ADD CONSTRAINT … CHECK/UNIQUE/FOREIGN KEY` on **new** objects. Never rewrite or backfill existing rows; never alter existing constraints.
2. **Old code / new schema:** old application versions must keep working against the migrated database (Prisma selects explicit columns; new nullable columns and new tables are invisible to old code). Deploy order is always *migrate → deploy code that understands it, flag OFF → enable flag*, and the reverse for rollback (flag OFF first).
3. **Feature OFF = zero reads and zero writes** of the new objects.
4. **Rollback:** the application rollback is the flag. A `DROP` rollback script is provided only for the window **before any production row exists**; once data exists the structure stays (dropping would destroy audit/curation data) and rollback is flag OFF.
5. **Tests per slice:** `pnpm prisma:validate`; a `tests/database/*-schema.test.ts` asserting each constraint rejects bad rows at the database (not only in app code), following `collection-definition-schema.test.ts` / `guest-checkout-snapshot-schema.test.ts`; an old-writer test (insert a row without the new columns → legacy readback unchanged).
6. **Reviewer checks off:** schema diff, SQL, rollback, coexistence, test plan, and (for hand-written SQL) that `prisma migrate diff` reports no drift.

---

## A02 — immutable benefit order persistence

**Purpose:** record role lines and benefit audit facts on finalized orders without touching legacy rows.

```prisma
// OrderLineSnapshot — all additive, nullable
lineId        String?   // stable per-order line identity (v2 only)
lineRole      String?   // 'PAID' | 'GIFT' (v2 only)
benefitCampaignId   String?   // snapshot, not FK (history must not change when a campaign does)
benefitKind         String?   // 'GIFT_ITEM' | 'QUANTITY_TIER'
benefitCampaignName String?
entitlementKey      String?

// OrderMirror — additive
quoteVersion  Int?      // NULL = legacy (laq1); 2 = laq2
benefitCampaignId       String? // added while building A04 (see below)
benefitEligibleQuantity Int?   // added while building A04: the proof canonicalizes the grant's
benefitBasisVnd         BigInt? // frozen facts, so the order must store them to rebuild the bytes
benefitTierIndex        Int?
```

```sql
ALTER TABLE "OrderLineSnapshot"
  ADD COLUMN "lineId" TEXT, ADD COLUMN "lineRole" TEXT,
  ADD COLUMN "benefitCampaignId" TEXT, ADD COLUMN "benefitKind" TEXT,
  ADD COLUMN "benefitCampaignName" TEXT, ADD COLUMN "entitlementKey" TEXT;
ALTER TABLE "OrderMirror" ADD COLUMN "quoteVersion" INTEGER;

CREATE UNIQUE INDEX "OrderLineSnapshot_orderId_lineId_key"
  ON "OrderLineSnapshot" ("orderId", "lineId");            -- NULLs are distinct: legacy rows unaffected

ALTER TABLE "OrderLineSnapshot" ADD CONSTRAINT "OrderLineSnapshot_v2_shape" CHECK (
  ("lineId" IS NULL AND "lineRole" IS NULL)
  OR ("lineId" IS NOT NULL AND "lineRole" IN ('PAID','GIFT')
      AND ("lineRole" <> 'GIFT' OR ("unitPriceVnd" = 0 AND "lineTotalVnd" = 0))
      AND ("lineRole" <> 'PAID' OR "unitPriceVnd" > 0)
      AND char_length("lineId") BETWEEN 1 AND 64)
);
ALTER TABLE "OrderMirror" ADD CONSTRAINT "OrderMirror_quoteVersion_known"
  CHECK ("quoteVersion" IS NULL OR "quoteVersion" = 2);
```

- **Implementation note (A02, found by the database test):** a CHECK passes when its expression is NULL, so a v2 branch that tests `"lineRole" IN (...)` lets `lineId` without a role through. The shipped SQL adds `"lineRole" IS NOT NULL` and a legacy branch requiring every new column to be NULL.
- **Legacy:** every existing row has `NULL` in all new columns → constraints vacuously true; `laq1` rebuild from persisted lines unchanged. No fake gifts are ever backfilled.
- **Not changed:** `CapacityReservation @@unique([orderId, variantId])` stays; PAID X + GIFT X is aggregated into one reservation (A03).
- **Coexistence hazard (must be reviewed):** old code reading a v2 order would see a `GIFT` line as an ordinary 0-VND line, and `SYNC_UNKNOWN` recovery or resubmission from old code could rebuild the POS payload incorrectly. Hence rollback is *flag OFF and drain/reconcile v2 orders before any code rollback*; the runbook must say so.
- **Rollback script (pre-data only):** drop the two constraints, the unique index, then the columns.
- **Tests:** same-variation PAID+GIFT rows round-trip; duplicate `(orderId, lineId)` rejected; GIFT with price > 0 rejected; legacy insert without new columns accepted and read back identical.

## A06 — benefit campaign admin persistence

**Purpose (the Prisma below is a sketch of shape, not final syntax):** campaigns, targets, tiers and gift grants, independent of legacy `PromotionCampaign` (no reuse of legacy rows or enum, so legacy readers cannot misinterpret them).

```prisma
model BenefitCampaign {
  id         String   @id @default(cuid())
  kind       String            // 'GIFT_ITEM' | 'QUANTITY_TIER'
  name       String
  startsAt   DateTime?
  endsAt     DateTime?
  isEnabled  Boolean  @default(false)
  enabledAt  DateTime?
  disabledAt DateTime?
  version    Int      @default(1)       // optimistic concurrency for admin edits
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  targets    BenefitCampaignTarget[]
  tiers      BenefitCampaignTier[]
  gifts      BenefitCampaignGift[]
}
model BenefitCampaignTarget {   // exactly one of productId / variantId, like PromotionTarget
  id String @id @default(cuid()); campaignId String; productId String?; variantId String?
  @@unique([campaignId, productId]) @@unique([campaignId, variantId])
}
model BenefitCampaignTier {     // QUANTITY_TIER
  id String @id @default(cuid()); campaignId String; position Int
  thresholdQuantity Int?; thresholdSubtotalVnd BigInt?
  discountType String; percentageValue Int?; fixedAmountVnd BigInt?
  @@unique([campaignId, position])
}
model BenefitCampaignGift {     // GIFT_ITEM
  id String @id @default(cuid()); campaignId String; variantId String; quantity Int
  @@unique([campaignId, variantId])
}
```

- **Hand-written CHECKs:** `kind IN (...)`; `endsAt IS NULL OR startsAt IS NULL OR endsAt > startsAt`; `char_length(name) BETWEEN 1 AND 120`; target exactly-one-of; tier `position BETWEEN 0 AND 7` (**proposed bound: 8 tiers**), exactly one threshold column set and exactly one discount column set, `percentageValue BETWEEN 1 AND 99`, money `> 0` and `<= 9007199254740991`; gift `quantity BETWEEN 1 AND 5` (**proposed bound**). FKs: targets/tiers/gifts → `BenefitCampaign` `ON DELETE CASCADE`; target/gift → mirror tables `ON DELETE CASCADE`.
- **Conflict safety:** publish takes `pg_advisory_xact_lock` on a fixed key inside the publishing transaction, then runs the [overlap predicate](../specs/core-kit-benefit-quote-v1-technical-review.md) §1.3 — the check and the `isEnabled = true` write are atomic, so two admins cannot both publish. The unique/CHECK constraints cannot express time-window overlap alone; an exclusion constraint (`btree_gist`) is **not proposed** because it adds an extension to the shared database.
- **Open for the reviewer:** whether campaign edits bump `PromotionPricingRevision` (it is the Merchant cache generation for legacy pricing) or A1 gets its own revision row. Recommendation: own revision row, because A1 does not change Merchant feed prices.
- **Coexistence / OFF:** new tables only; legacy tables untouched; OFF never reads them.
- **Tests:** each CHECK rejects at the DB; concurrent publish of overlapping campaigns → exactly one wins; cascade behavior; legacy `PromotionCampaign` tests unchanged.

## B01 — curated new-arrivals membership and order

```prisma
model NewArrivalsSelection {
  id              String        @id @default(cuid())
  productId       String        @unique
  position        Int           @unique
  addedAt         DateTime      @default(now())
  updatedByUserId String?
  product         ProductMirror @relation(fields: [productId], references: [id], onDelete: Cascade)
  updatedBy       User?         @relation("NewArrivalsUpdatedBy", fields: [updatedByUserId], references: [id], onDelete: SetNull)
  @@index([updatedByUserId])
}
model NewArrivalsSelectionState {   // single row, optimistic concurrency like PromotionPricingRevision
  id String @id @default("current"); revision BigInt @default(0); updatedAt DateTime @updatedAt
}
```

```sql
ALTER TABLE "NewArrivalsSelection"
  ADD CONSTRAINT "NewArrivalsSelection_position_range" CHECK ("position" >= 0 AND "position" < 500);
-- Prisma emits UNIQUE INDEX for position; the migration replaces it with a deferrable constraint so
-- an atomic reorder (swap/shift) never trips uniqueness mid-statement:
ALTER TABLE "NewArrivalsSelection"
  ADD CONSTRAINT "NewArrivalsSelection_position_key" UNIQUE ("position") DEFERRABLE INITIALLY DEFERRED;
```

- **The cap is a database fact:** `position ∈ [0, 499]` plus `UNIQUE(position)` means at most 500 rows regardless of application bugs (owner's max 500). `productId` unique means no duplicates.
- **Atomic reorder:** one transaction rewrites positions; the writer must also compare-and-bump `NewArrivalsSelectionState.revision` so concurrent admins get a conflict, not a silent overwrite.
- **Verify before approval:** that a hand-edited deferrable `UNIQUE` does not appear as drift in `prisma migrate diff` (Prisma models it as a plain unique; deferrability is invisible to it). If it does drift, fall back to a non-deferrable `UNIQUE` and reorder by delete + reinsert of the affected rows inside one transaction (a temporary position above 499 is not possible under the CHECK).
- **Pagination read:** rank-based `ORDER BY position LIMIT/OFFSET`, served by the unique index. Hidden products keep their slot.
- **Not used:** `createdAt`/`ProductMirror` recency is never a fallback.
- **Coexistence / OFF:** new tables; Pancake sync never writes them (FK cascade only removes the slot of a deleted product).
- **Tests:** 500 accepted / 501st rejected by the DB; duplicate product and duplicate position rejected; reorder atomic under concurrent writers; cascade on product delete.

## B04 — homepage featured products

Same shape as B01 with its own table and bound: `HomepageFeaturedProduct(productId UNIQUE FK cascade, position UNIQUE CHECK 0 <= position < 12, updatedByUserId)`. **The bound 12 is a proposal; the owner has not set one** — reviewer/owner must choose. Independent of `CollectionDefinition.featuredProductSlugs` (no copying). Reorder and concurrency rules as B01 (own revision row or a shared generic state row — reviewer to choose; recommendation: own row per feature to keep rollbacks independent).

## B05 — related-products override

```prisma
model RelatedProductOverride {
  id               String @id @default(cuid())
  productId        String
  relatedProductId String
  position         Int
  @@unique([productId, relatedProductId])
  @@unique([productId, position])
}
```

CHECKs: `productId <> relatedProductId` (no self), `position BETWEEN 0 AND 7` (**proposed bound: 8 per product**). Both FKs → `ProductMirror` `ON DELETE CASCADE`. Hidden/out-of-scope exclusion happens at read time (publication is not a static fact). Absent rows = documented fallback, so OFF and "no override" are the same code path.

## B06 — trusted media for configured size guides

```prisma
model SizeGuideMedia {
  guideKey  String   @id        // must exist in the size-guide config registry (app-validated; not an FK)
  imageUrl  String
  altText   String
  width     Int
  height    Int
  updatedByUserId String?
  updatedAt DateTime @updatedAt
}
```

CHECKs: `char_length("guideKey") BETWEEN 1 AND 64`; `"imageUrl" ~ '^https://'` and `char_length <= 2048`; `char_length("altText") BETWEEN 1 AND 300`; `width, height BETWEEN 1 AND 8000`. Host allow-listing and unknown `guideKey` rejection are application checks (the registry is code/config, not a table) and are the security-relevant part: they need the image-host policy that G5 is also gathering, so **B06 should not be approved before the trusted-host rule is written down.**

---

## Review checklist (per slice, to be copied into the approving review)

- [ ] Prisma diff and migration SQL read in full; only additive statements.
- [ ] Every CHECK/UNIQUE/FK demonstrated at the database by `tests/database` (not only in app code).
- [ ] Old-writer insert and legacy readback test present.
- [ ] Rollback: flag order and (pre-data) drop script reviewed; post-data policy stated.
- [ ] `pnpm prisma:validate` and `prisma migrate diff` clean (no drift).
- [ ] OFF path proven to issue zero statements on the new objects.
- [ ] Deploy order written in `docs/operations/release-and-rollback.md`.
- [x] Proposed bounds **confirmed by the owner 2026-10-18** (A06: 8 tiers / 5 gifts; B04: 12; B05: 8). The bounds are approved; the schema, SQL and rollback of each slice are still **not** approved.

**A07 update:** reviewed and approved on 2026-10-18 under the delegation (see the [delegated record](../approvals/core-kit-a-b-c-delegated-decisions-2026-10-18.md), decision 3): table `CartGiftSelection` with a composite foreign key to `BenefitCampaignGift`, no stored quantity. Original note: A07 (selected-gift state) was not in the G3 list; if it needs a table (`cartId`, `campaignId`, `giftVariantId`, `quantity`, unique on the triple) it gets its own proposal after A05/A06 settle the entitlement model.
