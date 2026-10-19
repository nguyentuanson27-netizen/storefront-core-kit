# Core Kit reusable capabilities A/B/C — Execution checklist v1

Status: **REMAINING WORK ONLY (scope reset 2026-10-19)**. Port La.Na's current functionality with minimal adapters; no fresh feature, duplicate POS tests, shared migration or production activation. Completed PR entries below remain historical evidence.

Planning base: `main@1f71d610387f1e000c89bc11732a79426fa0dfb8`; spec: [A/B/C umbrella spec](../docs/specs/core-kit-reusable-capabilities-a-b-c-v1.md); tasks: [detailed plan](./core-kit-reusable-a-b-c-v1-plan.md).

## Gates — revised for a source-code port, not a new product

- [x] **G0** — The 13-capability source/test matrix was recorded in the plan and revalidated under F00 (#28); no duplicate audit.
- [x] **G1** — F01 child technical contract [approved](../docs/specs/core-kit-benefit-quote-v1-technical-review.md).
- [x] **G2 (porting evidence only)** — Reuse La.Na's [2026-10-14/15 live create/readback record](https://github.com/nguyentuanson27-netizen/la.na_design_storefront/blob/main/docs/integrations/pancake-gift-quantity-acceptance.md): two split-line cases PASS on shop `715077776`. Per [La.Na ADR 0016 D-08](https://github.com/nguyentuanson27-netizen/la.na_design_storefront/blob/main/docs/decisions/0016-gift-quantity-promotions-v1-decisions.md), gifts are 0 VND in the website quote but **1,000 VND in the outbound POS projection**, offset from PAID items. A direct 0-VND POS case was **not** tested and is not part of the port. **No new POS probe.** Core Kit's shop `1635185058` is **not certified by this evidence**; G6 still governs production ON.
- [x] **G3** — Existing slices have their per-slice schema/SQL and CI evidence. Do not re-review merged migrations; review only a future migration **if A08 actually needs one**.
- [x] **G4** — [ADR 0010](../docs/decisions/0010-category-taxonomy-vs-collections.md): B09 SKIPPED.
- [x] **G5 resolved by SKIP** — B10/B11 are out of scope: keep Core Kit's existing trusted media; no new proxy, CDN experiment or image benchmark.
- [ ] **G6 (release only)** — Before any production enablement: exact-head CI, shop configuration/evidence boundary, security, rollback and explicit owner go/no-go. **Does not block OFF-only code porting.**
- [x] **GB1** — Approved B1 contract; B01-B03 implemented with recorded CI.

## Remaining tasks and order

1. **A08**: Port the existing La.Na benefit checkout + D-08 Pancake projection to Core Kit's canonical quote, reservation, order and gateway. Flag stays OFF.
2. **C04**: Port La.Na's current gift choice/repair + one-time checkout reminder into the existing Core Kit checkout after A08; no duplicate form or UI redesign.
3. **A09 optional**: La.Na now uses a read-only upsell banner linking to `/sale` (OD-01/A). Core Kit has **no `/sale` route**. SKIP unless a matching **existing** destination can be reused; do not create one.
4. **C03b deferred**: La.Na already supports drawer quantity/remove; transfer only if later chosen, never a dependency for A08/C04.
5. **A10, B09, B10, B11 SKIPPED**; no inline add, category engine, image proxy or new tests for non-features.

**Verification rule:** Reuse La.Na tests and existing Core Kit CI; validate only changed integration seams. Relevant DB/domain tests for order/money/locks; targeted browser/keyboard/axe for changed UI; add a new test only for a port-specific regression. Do not repeat live POS readback, add broad device matrices, invent features or require production release checks for an OFF-only PR. See the [lean plan](./core-kit-reusable-a-b-c-v1-plan.md#remaining-scope--lean-lana-port-2026-10-19).

## Dependency-ordered task checklist

- [x] **F00 — Revalidate audited matrix and ownership at implementation SHA** [Foundation; deps: none; Revalidation gate]
  - [x] Acceptance: At /build SHA, re-check the **already-delivered §2 matrix** source/test links, classifications and adoption decisions, recording only evidenced drift and reviewer approval.
  - [x] Verification: Compare pinned plan baseline against exact current source/test tree and record actual focused tests/CI when run.
  - Evidence: revalidated at `main@a397e44` (baseline `1f71d61`): 0 code drift, 60/60 matrix paths present, local baseline `pnpm test` 1843 pass and `pnpm test:db` 478 pass; see [slice record](../docs/verification/core-kit-a-b-c-slice-record.md#f00--revalidation-of-the-2-gap-matrix). Reviewer acknowledgement is by the owner's delegated self-review instruction.

- [x] **F01 — Approve child contracts and POS evidence matrix** [Foundation; deps: F00; Human / external evidence gate]
  - [x] Acceptance: Owner signs off on stacking/priority, paid/eligible/shipping bases, lineId, role, laq2 compatibility, reservation and rollback constraints.
  - [x] Verification: Human design review plus controlled POS evidence plan; no API mutation in plan-only PR.
  - Evidence: Owner policy selected 2026-10-18: [approval record](../docs/approvals/core-kit-a-b-c-owner-decisions-2026-10-18.md), [technical F01 draft](../docs/specs/core-kit-benefit-quote-v1.md); **G1 satisfied 2026-10-18** by the owner's approval of the [technical review](../docs/specs/core-kit-benefit-quote-v1-technical-review.md). The original Core Kit-specific POS proof was not collected; La.Na's actual source evidence is now recorded under the re-scoped G2 portability gate above. Other-shop production verification is not implied.

- [x] **A01 — Design/test v2 role lines and laq2 proof** [A; deps: F01; Approved A contract]
  - [x] Acceptance: PAID X + GIFT X are distinct signed lines; invalid duplicate IDs/roles/prices fail closed.
  - [x] Verification: `pnpm test:domain` quote/proof regressions, bounds, tamper and legacy vectors.
  - Evidence: PR #39; code `src/commerce/benefit-quote-proof.ts` (pure, not wired: no caller, no flag, no schema); tests `tests/domain/benefit-quote-proof.test.ts` (17) with vectors computed independently by `tests/domain/fixtures/benefit-quote-proof-reference.py`. Local: lint 0 errors, typecheck, `pnpm test` all pass. Exact-head CI and merge SHA in the [slice record](../docs/verification/core-kit-a-b-c-slice-record.md).

- [x] **A02 — Add immutable benefit order persistence** [A; deps: A01; Migration review]
  - [x] Acceptance: Same-variation role lines round-trip with stable audit facts; legacy rows with no v2 data remain readable.
  - [x] Verification: `pnpm prisma:validate` and `pnpm test:db` snapshot schema/rollback/legacy readback.
  - Evidence: PR #48; migration `20261018200000_add_benefit_order_persistence` (nullable `lineId`, `lineRole`, `benefitCampaignId`, `benefitKind`, `benefitCampaignName`, `entitlementKey` on `OrderLineSnapshot`; `quoteVersion` plus the granted campaign's frozen facts `benefitCampaignId`, `benefitEligibleQuantity`, `benefitBasisVnd`, `benefitTierIndex` on `OrderMirror` (what the `laq2` proof canonicalizes, so an order can rebuild the exact proof bytes); unique `(orderId, lineId)`; shape CHECKs; `prisma migrate diff` empty; verified on a fresh database too). Tests: `tests/database/benefit-order-schema.test.ts` (8): legacy line without the columns reads back NULL; PAID X + GIFT X of one variation round-trip as two lines; legacy and v2 orders side by side; `lineId` unique per order but reusable across orders; **13 malformed v2 shapes refused by the database**; only quote versions NULL/2; campaign facts are a snapshot (no key). No application code writes the columns yet (A04/A08). Exact-head CI and merge SHA in the [slice record](../docs/verification/core-kit-a-b-c-slice-record.md).

- [x] **A03 — Aggregate gift and paid stock through existing locks** [A; deps: A01, A02; Capacity safety gate]
  - [x] Acceptance: PAID X×1 + GIFT X×1 holds quantity 2 in one order/variant reservation; stock 1 refuses all atomically.
  - [x] Verification: `pnpm test:db` capacity-reservation/mirror-handoff/concurrency and `pnpm test:domain` capacity resources.
  - Evidence: PR #41; `src/commerce/benefit-capacity-demand.ts` derives the reservation input from PAID/GIFT lines and the **existing** `reserveOrderCapacity` (lock order, composite expansion, floors, all-or-none) is unchanged; it already merged duplicate variants. Tests: `tests/domain/benefit-capacity-demand.test.ts` (5), `tests/database/benefit-capacity.test.ts` (5: one row quantity 2, stock 1 refuses atomically incl. other lines, gift of another variant, two concurrent checkouts on stock 2 => one wins, idempotent retry). Does not need A02's columns (the ledger is keyed by order and variant). Exact-head CI and merge SHA in the [slice record](../docs/verification/core-kit-a-b-c-slice-record.md).

- [x] **A04 — Stage laq2 proof/render adapters with synthetic fixtures (OFF)** [A; deps: A01, A02, A03; OFF-only infrastructure]
  - [x] Acceptance: `laq1` remains legacy-only; synthetic `laq2` benefit lines prove signature/amount/role parity, while **real buyer benefit checkout stays OFF until A08**.
  - [x] Verification: `pnpm test:domain` fixture quote/proof, `pnpm test:db` snapshot/legacy readback and flag-OFF regression.
  - Evidence: PR #49; `src/commerce/benefit-quote-adapters.ts` (unwired; OFF-only infrastructure): A05 evaluation + gifts -> `laq2` facts, facts -> the A02 rows, persisted rows -> the same facts, and `quoteFormatFor` (`laq2` only when a campaign was granted; everything else keeps `laq1`). Tests: `tests/domain/benefit-quote-adapters.test.ts` (10), `tests/database/benefit-quote-adapters.test.ts` (3): **the proof rendered from the evaluation is byte-identical to the proof rebuilt from rows read back from PostgreSQL** (gift quote, tier discount, a grant that no line carries, no grant); a legacy order is never re-read as a benefit quote; tampered stored rows fail verification; the reservation input comes from the same lines (PAID X + GIFT X = 2). Real buyer benefit checkout stays OFF until A08. Exact-head CI and merge SHA in the [slice record](../docs/verification/core-kit-a-b-c-slice-record.md).

- [x] **A05 — Implement pure paid-only tier eligibility and shipping basis** [A; deps: F01; Stacking must be approved]
  - [x] Acceptance: A×1 eligible + B×2 ineligible => campaign count 1, shipping count 3; no eligible units => campaign 0 but shipping count positive.
  - [x] Verification: `pnpm test:domain` benefit/guest-shipping-policy tests including all threshold boundaries.
  - Evidence: PR #40; code `src/commerce/benefit-eligibility.ts` (pure, not wired); tests `tests/domain/benefit-eligibility.test.ts` (19): mixed cart A×1 eligible + B×2 ineligible => eligible 1, shipping count 3; no eligible units; strict 999,999 / 1,000,000 / 1,000,001 and quantity 2 / 3 boundaries; tier just below/at/above; one-pass; legacy-discounted basis-only; ambiguous and multi-campaign refusal; rounding parity with `resolvePromotionPricing`. Six mutations of the production code each fail a test. Exact-head CI and merge SHA in the [slice record](../docs/verification/core-kit-a-b-c-slice-record.md).

- [x] **A06 — Add benefit campaign admin lifecycle and persistence** [A; deps: A05, F01; Admin/schema approval]
  - [x] Acceptance: Non-admin or invalid campaign write fails closed; enabled conflicting rules resolve per approved contract.
  - [x] Verification: `pnpm test:domain` admin validation/auth and `pnpm test:db` lifecycle/concurrency/migration.
  - Evidence: PR #50; migration `20261018210000_add_benefit_campaigns` (`BenefitCampaign`, `...Target`, `...Tier`, `...Gift`, `BenefitRevision`; CHECKs for kind, name length, window order, version, exactly-one target, 8 tiers, one threshold, 1-99 %, 5 gifts, quantity 1-5; `prisma migrate diff` empty). Code: `benefit-campaign.ts` (validation, half-open window overlap, publish conflicts), `benefit-campaign-repository.ts` (create / redefine-a-never-enabled-draft / publish under one advisory lock / disable / revision), `benefit-campaign-form.ts` (pure form parser), `/admin/benefits` (list, draft form, enable, disable; admin-only; typed redirect reasons). Tests: domain 11 + 6; `tests/database/benefit-campaign.test.ts` (12): every CHECK refused at the database, publish bumps version and revision, stale / unknown / ended refused, product-covers-variant overlap names the conflicting campaign, adjacent windows allowed, store-wide intersects benefit campaigns but skips the legacy refusal (owner decision 2), legacy explicit-target overlap refused, **two simultaneous conflicting publishes: exactly one wins**, disable repeatable and re-publishable, redefine only before first enable, catalog delete cascades the target/gift. Playwright `admin-benefits.spec.ts` (5, Axe `BUYER_AXE_TAGS`): focused status/alert, conflict message names the other campaign, invalid input stores nothing, unknown reason never rendered, anonymous redirected. Nothing in checkout reads campaigns yet (A08), so enabling one changes no buyer price. Exact-head CI and merge SHA in the [slice record](../docs/verification/core-kit-a-b-c-slice-record.md).

- [x] **A07 — Persist selected gift state and enforce fresh entitlement** [A; deps: A01, A05, A06; Approved gift choice contract]
  - [x] Acceptance: Stale/invalid selected gift blocks affected checkout without silent substitution or paid-cart corruption.
  - [x] Verification: `pnpm test:domain` gift-choice validation and `pnpm test:db` concurrency/revalidation.
  - Evidence: PR #51; own small G3 review recorded in the [delegated decisions](../docs/approvals/core-kit-a-b-c-delegated-decisions-2026-10-18.md) (gifts are alternatives; no quantity or price stored; fresh revalidation; never substituted); migration `20261018220000_add_cart_gift_selection` (one table; composite FK to `BenefitCampaignGift`; `prisma migrate diff` empty). Code: `benefit-gift-selection.ts` (pure `resolveGiftSelection`: `NOT_APPLICABLE` / `NEEDS_CHOICE` / `READY` / `BLOCKED`), `benefit-gift-selection-repository.ts` (`selectCartGift`, `clearCartGift`, `revalidateCartGift` from one RepeatableRead snapshot). Tests: domain 7; `tests/database/cart-gift-selection.test.ts` (7): replace-not-append; refusals for unknown/expired cart, inactive/tier/unknown campaign, an unoffered gift (nothing stored); **the database itself refuses an unoffered gift and a second row per cart+campaign**; a gift that stops being offered removes the choice and the buyer is asked to choose again, never given another; disabling or ending (end exclusive) the campaign blocks a stored choice; choosing never changes `CartItem` rows and cart deletion removes the choice; 12 concurrent choices end with one row. Five mutations of the production code each fail a test. Nothing calls it yet (A08). Exact-head CI and merge SHA in the [slice record](../docs/verification/core-kit-a-b-c-slice-record.md).

- [ ] **A08 — Port current La.Na benefit checkout and vendor projection** [A; deps: A03-A07 done; flag OFF]
  - [ ] Acceptance: Use existing Core Kit cart/quote/proof/stock/order gateway with La.Na D-08 gift projection (0-VND website gift, 1,000-VND Pancake gift offset from PAID). No new POS format or price authority.
  - [ ] Verification: La.Na [recorded live adapter evidence](https://github.com/nguyentuanson27-netizen/la.na_design_storefront/blob/main/docs/integrations/pancake-gift-quantity-acceptance.md) + existing affected Core Kit domain/DB/integration tests and exact-head CI; **no new Pancake write**.
  - Evidence: pending port PR; Core Kit target-shop production activation remains under G6.

- [ ] **A09 — OPTIONAL / otherwise SKIP: current La.Na read-only upsell banner** [A; deps: A08]
  - [ ] Acceptance: Existing server-proven opportunity links to an **already supported** relevant destination; no direct checkout add, no new `/sale` route or quote simulator. If no equivalent destination, mark SKIPPED.
  - [ ] Verification: Only relevant existing checkout/link/quote checks if actually ported; normal CI.
  - Evidence: La.Na [current banner](https://github.com/nguyentuanson27-netizen/la.na_design_storefront/blob/main/src/components/commerce/checkout-upsell.tsx); Core Kit currently has no `/sale`.

- [x] **B01 — Persist curated new-arrivals membership and order** [B; deps: F00; BLOCKED: GB1 child spec + G3 migration approval before /build]
  - [x] Acceptance: **GB1 child spec + G3 schema/migration approval linked before any code**; approved finite `pageSize`, durable atomic manual selection/order, empty without created-at backfill and old-writer compatibility.
  - [x] Verification: Check signed-off child spec/migration links first, then `pnpm prisma:validate` and `pnpm test:db` curation/reorder/concurrency/migration.
  - Evidence: PR #42; migration `20261018160000_add_new_arrivals_selection` (two new tables, additive, applied only to CI/local databases); `src/commerce/new-arrivals-selection-repository.ts`, `src/commerce/new-arrivals-paging.ts` (no caller, no route change, no flag needed: nothing reads it until B03). Tests: `tests/domain/new-arrivals-paging.test.ts` (6), `tests/database/new-arrivals-selection.test.ts` (11): round trip + dense positions, atomic full reversal, 500 accepted / 501 refused, DB-level CHECK/UNIQUE/FK, stale revision, two concurrent writers => one wins, cascade on product delete, admin removal keeps slot. `prisma migrate diff` after the migration is empty (no drift). Exact-head CI and merge SHA in the [slice record](../docs/verification/core-kit-a-b-c-slice-record.md).

- [x] **B02 — Expose admin-only arrivals curator** [B; deps: B01; Admin auth review]
  - [x] Acceptance: Only admins change selection, with reliable validation feedback and persisted ordering.
  - [x] Verification: `pnpm test:domain` admin/auth and `pnpm test:db` writes; authenticated HTTP smoke.
  - Evidence: PR #43; `/admin/new-arrivals` (`src/app/admin/new-arrivals/{page,actions}.tsx`), pure planner `src/commerce/new-arrivals-admin.ts`, picker/label reads in the B01 repository. Server actions re-authorize with `requireCurrentAdmin()`; the page uses `requireCurrentAdminPage()`; outcomes are a redirect carrying a typed reason from a closed set. Tests: `tests/domain/new-arrivals-admin.test.ts` (9), `tests/a11y-runtime/admin-new-arrivals.spec.ts` (3, desktop admin project): search + add, reorder, remove, persisted order, axe on empty/filled/error, stale editor announced and focused with the newer order intact, hostile `?error=` never rendered, unauthenticated visitor redirected. Public `/new-arrivals` is unchanged (B03). Exact-head CI and merge SHA in the [slice record](../docs/verification/core-kit-a-b-c-slice-record.md).

- [x] **B03 — Add ON/OFF curated arrivals read model** [B; deps: B01, B02; GB1 pagination/empty-state approval + route/SEO parity]
  - [x] Acceptance: **Recheck approved GB1 spec**: OFF original editorial/no data query; ON+empty editorial frame and accessible empty-list status (zero cards, no fallback/redirect); ON+selection preserves manual order and canonical pricing across bounded pages.
  - [x] Verification: `pnpm test:domain` page bounds (N-1/N/N+1/2N+1, N = approved `pageSize`), cross-page order, hidden/no-backfill and invalid pages; `pnpm test:db` listing/query bounds; browser axe/keyboard at 390×844, 768 and 1440 for OFF/ON-empty/pagination.
  - Evidence: PR #44; flag `NEW_ARRIVALS_CURATION_ENABLED` (default OFF; `.env.example`, `deploy/vps/env.example`, runbook section). `src/routes/new-arrivals.ts`, `new-arrivals-model.ts`, `metadata/new-arrivals.ts`, `src/app/new-arrivals/page.tsx`, `listProductsByIds` in the catalog repository (same visibility, stock and promotion projection as `/shop`; hidden products dropped in place, no backfill). Tests: `tests/domain/new-arrivals-route-model.test.ts` (10), `tests/database/new-arrivals-listing.test.ts` (6), `tests/a11y-runtime/new-arrivals-curation.spec.ts` (6: ON 26 slots => 23 visible + 2 with the hole not refilled, keyboard Next, axe + no overflow at 390×844 / 768×1024 / 1440×900 on pages 1 and 2, 404 table, ON-empty status with no redirect, all-hidden page keeps the frame, OFF ignores `?page=` and renders no list); the unmodified `editorial` and `evergreen-pages` specs pass against an OFF server. `pnpm build` OK. Exact-head CI and merge SHA in the [slice record](../docs/verification/core-kit-a-b-c-slice-record.md).

- [x] **B04 — Curate homepage featured products without copying collections** [B; deps: F00; Gap/audit first]
  - [x] Acceptance: OFF preserves auto discovery homepage edit; ON selection is ordered, bounded, persistent and independent of collections.
  - [x] Verification: `pnpm test:db` featured product CRUD and `pnpm test:domain` home view model.
  - Evidence: PR #45; migration `20261018170000_add_homepage_featured` (two new tables; unique deferrable position + `CHECK position < 12` => the 12 ceiling is a database fact; `prisma migrate diff` empty); `src/commerce/homepage-featured-repository.ts`; admin `/admin/homepage-featured` reusing the accepted planner with `maxItems = 12`; flag `HOMEPAGE_FEATURED_ENABLED` (default OFF) read in `src/routes/home.ts` (OFF: no selection read; ON + empty/all-hidden: automatic discovery). Tests: `tests/domain/homepage-featured.test.ts` (5), `tests/database/homepage-featured.test.ts` (8, incl. independence from a collection's pins), `tests/a11y-runtime/homepage-featured.spec.ts` (5: curated order with a hidden product dropped and not refilled, fallback, admin up to 12 and a refused 13th with a focused alert, unauthenticated redirect, OFF ignores the selection; axe with the buyer tag set). Exact-head CI and merge SHA in the [slice record](../docs/verification/core-kit-a-b-c-slice-record.md).

- [x] **B05 — Add optional related-products editorial override** [B; deps: F00; Fallback must be reviewed]
  - [x] Acceptance: Manual candidates exclude self, duplicates, hidden/out-of-scope products; absent override uses documented fallback.
  - [x] Verification: `pnpm test:domain` override/fallback + `pnpm test:db` admin operation.
  - Evidence: PR #46; migration `20261018180000_add_related_product_override` (one new table: `CHECK productId <> relatedProductId`, `CHECK position < 8`, unique deferrable `(productId, position)`, unique pair, both FKs cascade; `prisma migrate diff` empty); `src/commerce/related-product-override{,-repository}.ts`; admin `/admin/products/<id>/related` (linked from the product editor); flag `RELATED_PRODUCTS_OVERRIDE_ENABLED` (default OFF) read in `listConfiguredRelatedStorefrontProducts`: OFF never reads the table; ON shows the first 4 currently visible manual candidates in stored order, else the unchanged collection-projected fallback. Tests: `tests/domain/related-product-override.test.ts` (6), `tests/database/related-product-override.test.ts` (7), `tests/a11y-runtime/related-override.spec.ts` (6: order with a hidden candidate skipped, fallback when none/all hidden, axe at 390px, admin add up to 8 and a refused ninth with a focused alert, reorder/remove, self never offered, unauthenticated redirect, OFF ignores overrides); the unmodified `related-products` spec passes. Exact-head CI and merge SHA in the [slice record](../docs/verification/core-kit-a-b-c-slice-record.md).

- [x] **B06 — Add optional trusted media for configured size guides** [B; deps: F00; Optional/default OFF]
  - [x] Acceptance: Unknown guide IDs and untrusted images rejected; writes require authenticated admin role.
  - [x] Verification: `pnpm test:domain` validation, `pnpm test:db` storage; PDP browser/a11y fallback.
  - Evidence: PR #47; migration `20261018190000_add_size_guide_media` (one new table with CHECKs on https URL ≤ 2048, alt 1–300, dimensions 1–8000, key length; `prisma migrate diff` empty); `src/commerce/size-guide-media{,-repository}.ts` (trust rule = the existing `parseTrustedProductImageUrl`, no new host); admin `/admin/size-guide`; flag `SIZE_GUIDE_MEDIA_ENABLED` (default OFF) read in `src/routes/size-guide.ts`. Tests: `tests/domain/size-guide-media.test.ts` (8), `tests/database/size-guide-media.test.ts` (3), `tests/a11y-runtime/size-guide-media.spec.ts` (5: untrusted image refused with a focused alert and nothing stored, trusted image stored, image beside its table only for that chart, no horizontal overflow and axe clean at 390px, a stale untrusted row never rendered, unauthenticated redirect, OFF ignores stored images); the unmodified `evergreen-pages` spec passes. Exact-head CI and merge SHA in the [slice record](../docs/verification/core-kit-a-b-c-slice-record.md).

- [x] **B07 — Add bounded search suggestion read model** [B; deps: F00; Independent]
  - [x] Acceptance: Hidden/stale products omitted; suggestions count, input length, latency and DB query volume bounded.
  - [x] Verification: `pnpm test:domain` discovery/search and `pnpm test:db` suggestions visibility/price tests.
  - Evidence: PR #29; code `src/commerce/storefront-search-suggestions.ts`, `src/routes/search-suggestions-model.ts`, `src/routes/search-suggestions.ts` (server action); flag `SEARCH_SUGGESTIONS_ENABLED` default OFF. Local on base `main@81438ef`: lint 0 errors, typecheck, `pnpm test` 1862 pass, `tests/database/search-suggestions.test.ts` 6 pass, `pnpm build` OK. Exact-head CI and merge SHA in the [slice record](../docs/verification/core-kit-a-b-c-slice-record.md).

- [x] **B08 — Decide category taxonomy versus current collections** [B; deps: F00; owner decision ACCEPTED]
  - [x] Acceptance: [ADR 0010](../docs/decisions/0010-category-taxonomy-vs-collections.md) chooses KEEP collections and defer taxonomy; no second membership/route authority.
  - [x] Verification: existing route/SEO architecture evidence in ADR reviewed for owner decision, not a runtime implementation test.
  - Evidence: [owner decision record](../docs/approvals/core-kit-a-b-c-owner-decisions-2026-10-18.md); accepted ADR 0010. B09 is SKIPPED.

- [ ] **B09 — Implement category identity and membership if approved** [B; deps: B08; **SKIPPED BY OWNER — not implemented**]
  - [ ] Acceptance: not applicable while accepted ADR 0010 keeps collections; reopening requires amended owner approval and G3.
  - [ ] Verification: not run; no taxonomy feature was implemented.
  - Evidence: [accepted ADR 0010](../docs/decisions/0010-category-taxonomy-vs-collections.md); skip is not implementation completion.

- [ ] **B10 — SKIPPED (no image benchmark)** [B; no implementation]
  - Evidence: Core Kit already has trusted media; adding an image proxy is outside this port.
- [ ] **B11 — SKIPPED (no new image endpoint)** [B; no implementation]
  - Evidence: no new API, tests, CDN measurement or proxy security work is needed when the endpoint is not built.

- [x] **C01 — Extract portable PDP/mobile selection interaction models** [C; deps: F00; Independent]
  - [x] Acceptance: Selection/not chosen/out of stock/loading/preorder use existing business truth without parallel pricing.
  - [x] Verification: `pnpm test:domain` PDP models and `tests/a11y-runtime/pdp-promotion.spec.ts`.
  - Evidence: PR #31; `src/components/headless/pdp-mobile-interaction-model.ts` (pure), `use-pdp-mobile-interactions.ts` (hooks), brand `pdp-sticky-purchase-bar.tsx` + gallery/detail wiring; flag `PDP_MOBILE_INTERACTIONS_ENABLED` default OFF. Local on base `main@26bce5a`: lint 0 errors, typecheck, `pnpm test` incl. 18 new domain tests, `pdp-mobile-interactions.spec.ts` 6/6 plus unchanged `pdp-promotion`, `storefront-media`, `variant-deep-link` specs 12/12 in Chromium (390×844, 768×1024, 1440×900, axe, keyboard, touch swipe). Exact-head CI and merge SHA in the [slice record](../docs/verification/core-kit-a-b-c-slice-record.md).

- [x] **C02 — Add headless PLP filter interaction** [C; deps: F00; Canonical discovery; no B07]
  - [x] Acceptance: Existing URL-backed filters and no-JS forms remain canonical; filter drawer/chips and focus states do not depend on B07 or C05.
  - [x] Verification: `pnpm test:domain` filter model and `tests/a11y-runtime/discovery.spec.ts` browser/keyboard.
  - Evidence: PR #30; `src/components/headless/plp-filter-model.ts` (pure), `use-plp-filter-disclosure.ts` (hook), brand adapter `src/components/brand/listing-filter-region.tsx`; flag `SHOP_FILTER_DISCLOSURE_ENABLED` default OFF. Local on base `main@75e69b4`: lint 0 errors, typecheck, new domain tests, `plp-filter-disclosure.spec.ts` 7/7 plus the unchanged `discovery.spec.ts` 2/2 in Chromium (390×844, 768×1024, 1440×900, axe, keyboard). Exact-head CI and merge SHA in the [slice record](../docs/verification/core-kit-a-b-c-slice-record.md).

- [x] **C03 — Add optional accessible headless cart drawer** [C; deps: F00; Independent] — **v1 is read-only (see C03b)**
  - [x] Acceptance (read-only scope): Keyboard focus trap/restore and Escape work; opening is single-flight and stale answers are dropped; OFF retains the existing cart page; the drawer never recalculates item money or stock.
  - [ ] Not covered by v1: "stale/double **mutations** do not lose buyer data" has no subject because the drawer performs no mutation. Quantity change and removal remain on `/cart`. This line stays unticked until C03b exists.
  - [x] Verification: `pnpm test:domain` cart models and the browser spec `tests/a11y-runtime/cart-drawer.spec.ts` (the existing cart/checkout specs are the OFF regression).
  - Evidence: PR #32 (merged), review follow-up in the fix PR; `src/components/headless/cart-drawer-model.ts` (pure), `use-cart-drawer.ts`, brand `src/components/brand/cart-drawer.tsx`, read model `src/routes/cart-drawer-model.ts` + server action `src/routes/cart-drawer.ts`; flag `CART_DRAWER_ENABLED` default OFF. Exact-head CI and merge SHAs in the [slice record](../docs/verification/core-kit-a-b-c-slice-record.md).

- [ ] **C03b — DEFERRED, optional La.Na drawer behaviour** [C; not a blocker]
  - [ ] Acceptance: Only if selected later, adapt La.Na's existing `use-cart-drawer` quantity/remove actions to Core Kit's canonical cart mutations; no new business rules.
  - [ ] Verification: Affected cart mutation and focus regression only if ported; no work now.

- [ ] **A10 — SKIPPED: obsolete checkout inline add** [A; not implemented]
  - Evidence: La.Na owner OD-01/A replaced inline add with a read-only link; do not revive the abandoned UI or action.

- [ ] **C04 — Port La.Na gift selection/repair and checkout reminder** [C; deps: A08; no drawer dependency]
  - [ ] Acceptance: Use existing Core Kit checkout form/authoritative paid+gift quote; invalid selection can be repaired, no automatic gift choice, form fields survive re-quote; OFF checkout untouched.
  - [ ] Verification: Reuse La.Na [picker/reminder implementation evidence](https://github.com/nguyentuanson27-netizen/la.na_design_storefront/blob/main/docs/verification/storefront-gift-picker-checkout-reminder.md), plus affected Core Kit checkout domain/keyboard/browser checks.
  - Evidence: pending port PR.

- [x] **C05 — Add optional search overlay after bounded suggestions** [C; deps: B07; Optional/default OFF]
  - [x] Acceptance: Overlay consumes B07's approved bounded suggestions and keyboard/empty/error states, never blocking C02/no-JS search.
  - [x] Verification: `pnpm test:domain` overlay model and `tests/a11y-runtime/discovery.spec.ts` runtime/focus. (Browser evidence is the new `search-overlay.spec.ts`; `discovery.spec.ts` and the editorial/evergreen specs are the OFF regression.)
  - Evidence: PR #33; `src/components/headless/search-overlay-model.ts` (pure), `use-search-overlay.ts`, brand `src/components/brand/search-overlay.tsx`; flag `SEARCH_OVERLAY_ENABLED` default OFF, effective only with `SEARCH_SUGGESTIONS_ENABLED`. Local on base `main@ebe7197`: lint 0 errors, typecheck, `pnpm test`, `search-overlay.spec.ts` 10/10 in Chromium (390×844, 1440×900, axe, keyboard, Tab trap, stale-response case). Exact-head CI and merge SHA in the [slice record](../docs/verification/core-kit-a-b-c-slice-record.md).

- [ ] **R00 — Production release/rollback only** [Release; depends on G6]
  - [ ] Acceptance: When enabling, record approved shop scope, rollback/flag OFF, exact-head CI, security and owner go/no-go.
  - [ ] Verification: Existing release checks **at activation**; no extra test suite or live POS write merely to merge an OFF-only port.

## Batch checkpoints

- [x] **CP0:** F00 source/test audit and F01 technical contract already reviewed; La.Na vendor source evidence is now linked under G2.
- [x] **CP-A0:** A01/A02/A03 (role proof/order history/locked stock) delivered.
- [x] **CP-A1:** A04/A05 (OFF-only `laq2` adapters and pure eligibility) delivered.
- [ ] **CP-A2:** A06/A07 delivered, but A08 real checkout port and C04 UI are still open; G2 source evidence is recorded, not target-shop certification.
- [ ] **CP-A3:** A09 is optional/otherwise SKIP; A10 explicitly SKIPPED and not blocking.
- [x] **CP-B1:** Curated new arrivals delivered (B01-B03).
- [x] **CP-B2:** B04-B07 delivered.
- [x] **CP-B3:** B08 decided, B09 SKIPPED.
- [x] **CP-B4:** Scope decision: B10/B11 SKIPPED, no proxy built.
- [x] **CP-C (completed independent slices only):** C01/C02/C03/C05 delivered; C04 remains open under A08, not falsely marked complete.
- [ ] **CP-R:** G6/R00 release sign-off applies if/when production flags are enabled.

## Minimal verification for remaining port PRs

- [ ] Changes correspond to existing merged La.Na behaviour and the smallest Core Kit adapter; no new feature/route/engine/refactor.
- [ ] Required existing CI on the exact changed head is green (lint/typecheck/build and repository checks); run focused current tests for impacted money/cart/DB or checkout UI. Add regression cases **only for newly exposed port-specific defects**.
- [ ] Verify default-OFF/legacy behaviour and cart ownership; record any target-shop evidence gap explicitly rather than pretending La.Na tested that shop.
- [ ] Production activation is separate G6; no live POS probe, new performance project or mandatory full manual-device matrix for an OFF-only port.

**B09, A10, B10 and B11 are SKIPPED under this scope.** C03b/A09 are optional and non-blocking. No production flag ON without a separate G6 owner decision.
