# Core Kit reusable capabilities A/B/C — Execution checklist v1

Status: **ACTIVE EXECUTION TRACKER**. Owner selected option A for F01, B1, G3 direction and G4 on 2026-10-18; this approval does not itself complete a feature, permit migration, POS writes or production release.

Planning base: `main@1f71d610387f1e000c89bc11732a79426fa0dfb8`; spec: [A/B/C umbrella spec](../docs/specs/core-kit-reusable-capabilities-a-b-c-v1.md); tasks: [detailed plan](./core-kit-reusable-a-b-c-v1-plan.md).

## Approval and evidence gates (do not infer gate completion from policy selection)

- [ ] G0 Review this /plan's **completed** 13-capability source/test/reuse matrix (§2 of plan). F00 subsequently revalidates it at the implementation SHA; do not defer initial matrix until after plan approval.
- [x] **G1 ACCEPTED 2026-10-18** (owner approved the technical review). Original text: technical child-spec review was required. Owner approved option A F01 business policies (single A1 campaign, no same-line legacy stacking, `lineId`/`laq2`, paid bases). [Decision record](../docs/approvals/core-kit-a-b-c-owner-decisions-2026-10-18.md) and [F01 child-spec draft](../docs/specs/core-kit-benefit-quote-v1.md) must be technically reviewed/merged before the G1 implementation gate closes. The technical proposal was accepted: [F01 technical review](../docs/specs/core-kit-benefit-quote-v1-technical-review.md) (accepted).
- [ ] G2 Controlled Pancake acceptance/readback proves 0-VND gift, same-variation PAID+GIFT and differently-priced PAID rows **for each enabled use case**, or case remains OFF.
- [x] **G3 per-slice review DONE 2026-10-18 under the owner's delegation** ("tự đề xuất quyết định"): A02, A06, B01, B04, B05, B06 approved in the [delegated decision record](../docs/approvals/core-kit-a-b-c-delegated-decisions-2026-10-18.md). Applying any migration to a shared/production database is still a G6 step. Original text: per-slice SQL/migration review remained BLOCKED. Owner approved additive **design direction and drafting** only, not any concrete Prisma schema diff, migration SQL, rollback or deployment. Drafts for review: [G3 proposals](../docs/proposals/g3-additive-migration-proposals.md) (nothing applied; all per-slice approvals open). [Decision record](../docs/approvals/core-kit-a-b-c-owner-decisions-2026-10-18.md).
- [x] **G4 OWNER DECISION ACCEPTED:** [ADR 0010](../docs/decisions/0010-category-taxonomy-vs-collections.md) keeps collections; B08 decided; B09 **SKIPPED, not implemented**.
- [ ] G5 Image proxy measurements/security decision before B11 (otherwise SKIP).
- [ ] G6 Human review + exact-head tests/runtime + release gate before enabling any new capability.
- [x] **GB1 ACCEPTED 2026-10-18** (owner approved the technical review; **G3 for B01 still required before B01 code**). Original text: child-spec technical review BEFORE B01/B03 /build: owner approved option A (`pageSize=24`, max 500 curated items, `?page=N`, invalid 404, stable slot pagination and accessible empty state). [B1 child-spec draft](../docs/specs/core-kit-new-arrivals-curation-v1.md); [owner decision](../docs/approvals/core-kit-a-b-c-owner-decisions-2026-10-18.md). Review/merge child spec and **separately approve G3 concrete schema/migration** before B01 code. Accepted proposal: [B1 technical review](../docs/specs/core-kit-new-arrivals-curation-v1-technical-review.md) (accepted).

## Execution status — blocked tasks (gates are not waived)

Gate evidence and per-slice records live in the [slice record](../docs/verification/core-kit-a-b-c-slice-record.md).

- **G1 satisfied (2026-10-18):** F01, A01 and A05 are unblocked by G1. A06, A07 still need G3 / their own dependencies; A02, A03, A04 need A01 and G3 (A02); A08–A10, C04 also need G2.
- **BLOCKED on G2 (controlled POS readback):** A08, and transitively A09, A10, C04.
- **G3 additive drafting direction accepted; concrete migration approval still BLOCKED:** A02, A06, B04, B05, B06 and B01 (also GB1).
- **GB1 satisfied (2026-10-18); G3 for B01 still BLOCKS:** B01, B02, B03 (B02/B03 also depend on B01).
- **G4 resolved:** B08 decision complete; B09 SKIPPED by accepted ADR 0010. **G5 remains BLOCKED:** B10 needs real CDN measurements/security review, so B11 is blocked.
- **Completed (no unmet gate, no schema change):** B07, C01, C02, C03, C05 — all behind default-OFF flags; see the release-readiness section of the slice record.

## Dependency-ordered task checklist

- [x] **F00 — Revalidate audited matrix and ownership at implementation SHA** [Foundation; deps: none; Revalidation gate]
  - [x] Acceptance: At /build SHA, re-check the **already-delivered §2 matrix** source/test links, classifications and adoption decisions, recording only evidenced drift and reviewer approval.
  - [x] Verification: Compare pinned plan baseline against exact current source/test tree and record actual focused tests/CI when run.
  - Evidence: revalidated at `main@a397e44` (baseline `1f71d61`): 0 code drift, 60/60 matrix paths present, local baseline `pnpm test` 1843 pass and `pnpm test:db` 478 pass; see [slice record](../docs/verification/core-kit-a-b-c-slice-record.md#f00--revalidation-of-the-2-gap-matrix). Reviewer acknowledgement is by the owner's delegated self-review instruction.

- [x] **F01 — Approve child contracts and POS evidence matrix** [Foundation; deps: F00; Human / external evidence gate]
  - [x] Acceptance: Owner signs off on stacking/priority, paid/eligible/shipping bases, lineId, role, laq2 compatibility, reservation and rollback constraints.
  - [x] Verification: Human design review plus controlled POS evidence plan; no API mutation in plan-only PR.
  - Evidence: Owner policy selected 2026-10-18: [approval record](../docs/approvals/core-kit-a-b-c-owner-decisions-2026-10-18.md), [technical F01 draft](../docs/specs/core-kit-benefit-quote-v1.md); **G1 satisfied 2026-10-18** by the owner's approval of the [technical review](../docs/specs/core-kit-benefit-quote-v1-technical-review.md). The controlled POS evidence *plan* is in the child spec §4; the evidence itself (G2) is **not** collected and still blocks A08.

- [x] **A01 — Design/test v2 role lines and laq2 proof** [A; deps: F01; Approved A contract]
  - [x] Acceptance: PAID X + GIFT X are distinct signed lines; invalid duplicate IDs/roles/prices fail closed.
  - [x] Verification: `pnpm test:domain` quote/proof regressions, bounds, tamper and legacy vectors.
  - Evidence: PR #39; code `src/commerce/benefit-quote-proof.ts` (pure, not wired: no caller, no flag, no schema); tests `tests/domain/benefit-quote-proof.test.ts` (17) with vectors computed independently by `tests/domain/fixtures/benefit-quote-proof-reference.py`. Local: lint 0 errors, typecheck, `pnpm test` all pass. Exact-head CI and merge SHA in the [slice record](../docs/verification/core-kit-a-b-c-slice-record.md).

- [ ] **A02 — Add immutable benefit order persistence** [A; deps: A01; Migration review]
  - [ ] Acceptance: Same-variation role lines round-trip with stable audit facts; legacy rows with no v2 data remain readable.
  - [ ] Verification: `pnpm prisma:validate` and `pnpm test:db` snapshot schema/rollback/legacy readback.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [x] **A03 — Aggregate gift and paid stock through existing locks** [A; deps: A01, A02; Capacity safety gate]
  - [x] Acceptance: PAID X×1 + GIFT X×1 holds quantity 2 in one order/variant reservation; stock 1 refuses all atomically.
  - [x] Verification: `pnpm test:db` capacity-reservation/mirror-handoff/concurrency and `pnpm test:domain` capacity resources.
  - Evidence: PR #41; `src/commerce/benefit-capacity-demand.ts` derives the reservation input from PAID/GIFT lines and the **existing** `reserveOrderCapacity` (lock order, composite expansion, floors, all-or-none) is unchanged; it already merged duplicate variants. Tests: `tests/domain/benefit-capacity-demand.test.ts` (5), `tests/database/benefit-capacity.test.ts` (5: one row quantity 2, stock 1 refuses atomically incl. other lines, gift of another variant, two concurrent checkouts on stock 2 => one wins, idempotent retry). Does not need A02's columns (the ledger is keyed by order and variant). Exact-head CI and merge SHA in the [slice record](../docs/verification/core-kit-a-b-c-slice-record.md).

- [ ] **A04 — Stage laq2 proof/render adapters with synthetic fixtures (OFF)** [A; deps: A01, A02, A03; OFF-only infrastructure]
  - [ ] Acceptance: `laq1` remains legacy-only; synthetic `laq2` benefit lines prove signature/amount/role parity, while **real buyer benefit checkout stays OFF until A08**.
  - [ ] Verification: `pnpm test:domain` fixture quote/proof, `pnpm test:db` snapshot/legacy readback and flag-OFF regression.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [x] **A05 — Implement pure paid-only tier eligibility and shipping basis** [A; deps: F01; Stacking must be approved]
  - [x] Acceptance: A×1 eligible + B×2 ineligible => campaign count 1, shipping count 3; no eligible units => campaign 0 but shipping count positive.
  - [x] Verification: `pnpm test:domain` benefit/guest-shipping-policy tests including all threshold boundaries.
  - Evidence: PR #40; code `src/commerce/benefit-eligibility.ts` (pure, not wired); tests `tests/domain/benefit-eligibility.test.ts` (19): mixed cart A×1 eligible + B×2 ineligible => eligible 1, shipping count 3; no eligible units; strict 999,999 / 1,000,000 / 1,000,001 and quantity 2 / 3 boundaries; tier just below/at/above; one-pass; legacy-discounted basis-only; ambiguous and multi-campaign refusal; rounding parity with `resolvePromotionPricing`. Six mutations of the production code each fail a test. Exact-head CI and merge SHA in the [slice record](../docs/verification/core-kit-a-b-c-slice-record.md).

- [ ] **A06 — Add benefit campaign admin lifecycle and persistence** [A; deps: A05, F01; Admin/schema approval]
  - [ ] Acceptance: Non-admin or invalid campaign write fails closed; enabled conflicting rules resolve per approved contract.
  - [ ] Verification: `pnpm test:domain` admin validation/auth and `pnpm test:db` lifecycle/concurrency/migration.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [ ] **A07 — Persist selected gift state and enforce fresh entitlement** [A; deps: A01, A05, A06; Approved gift choice contract]
  - [ ] Acceptance: Stale/invalid selected gift blocks affected checkout without silent substitution or paid-cart corruption.
  - [ ] Verification: `pnpm test:domain` gift-choice validation and `pnpm test:db` concurrency/revalidation.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [ ] **A08 — Prove POS create/readback parity and complete gated A1** [A; deps: A03, A04, A05, A06, A07; External POS acceptance; default OFF]
  - [ ] Acceptance: Controlled readback proves all accepted paid+gift rows and money; unsupported formats remain OFF and fail closed.
  - [ ] Verification: Approved Pancake live/test-environment readback; `pnpm test:db` order/capacity and existing integration tests.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [ ] **A09 — Build bounded read-only promotion upsell evaluator** [A; deps: A05, A08; Optional/default OFF]
  - [ ] Acceptance: Suggest only a proved increment that does not lose existing grants; no viable candidate/timeout yields no offer.
  - [ ] Verification: `pnpm test:domain` upsell proof/timeout/bounds and `pnpm test:db` candidate visibility.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [x] **B01 — Persist curated new-arrivals membership and order** [B; deps: F00; BLOCKED: GB1 child spec + G3 migration approval before /build]
  - [x] Acceptance: **GB1 child spec + G3 schema/migration approval linked before any code**; approved finite `pageSize`, durable atomic manual selection/order, empty without created-at backfill and old-writer compatibility.
  - [x] Verification: Check signed-off child spec/migration links first, then `pnpm prisma:validate` and `pnpm test:db` curation/reorder/concurrency/migration.
  - Evidence: PR #42; migration `20261018160000_add_new_arrivals_selection` (two new tables, additive, applied only to CI/local databases); `src/commerce/new-arrivals-selection-repository.ts`, `src/commerce/new-arrivals-paging.ts` (no caller, no route change, no flag needed: nothing reads it until B03). Tests: `tests/domain/new-arrivals-paging.test.ts` (6), `tests/database/new-arrivals-selection.test.ts` (11): round trip + dense positions, atomic full reversal, 500 accepted / 501 refused, DB-level CHECK/UNIQUE/FK, stale revision, two concurrent writers => one wins, cascade on product delete, admin removal keeps slot. `prisma migrate diff` after the migration is empty (no drift). Exact-head CI and merge SHA in the [slice record](../docs/verification/core-kit-a-b-c-slice-record.md).

- [ ] **B02 — Expose admin-only arrivals curator** [B; deps: B01; Admin auth review]
  - [ ] Acceptance: Only admins change selection, with reliable validation feedback and persisted ordering.
  - [ ] Verification: `pnpm test:domain` admin/auth and `pnpm test:db` writes; authenticated HTTP smoke.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [ ] **B03 — Add ON/OFF curated arrivals read model** [B; deps: B01, B02; GB1 pagination/empty-state approval + route/SEO parity]
  - [ ] Acceptance: **Recheck approved GB1 spec**: OFF original editorial/no data query; ON+empty editorial frame and accessible empty-list status (zero cards, no fallback/redirect); ON+selection preserves manual order and canonical pricing across bounded pages.
  - [ ] Verification: `pnpm test:domain` page bounds (N-1/N/N+1/2N+1, N = approved `pageSize`), cross-page order, hidden/no-backfill and invalid pages; `pnpm test:db` listing/query bounds; browser axe/keyboard at 390×844, 768 and 1440 for OFF/ON-empty/pagination.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [ ] **B04 — Curate homepage featured products without copying collections** [B; deps: F00; Gap/audit first]
  - [ ] Acceptance: OFF preserves auto discovery homepage edit; ON selection is ordered, bounded, persistent and independent of collections.
  - [ ] Verification: `pnpm test:db` featured product CRUD and `pnpm test:domain` home view model.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [ ] **B05 — Add optional related-products editorial override** [B; deps: F00; Fallback must be reviewed]
  - [ ] Acceptance: Manual candidates exclude self, duplicates, hidden/out-of-scope products; absent override uses documented fallback.
  - [ ] Verification: `pnpm test:domain` override/fallback + `pnpm test:db` admin operation.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [ ] **B06 — Add optional trusted media for configured size guides** [B; deps: F00; Optional/default OFF]
  - [ ] Acceptance: Unknown guide IDs and untrusted images rejected; writes require authenticated admin role.
  - [ ] Verification: `pnpm test:domain` validation, `pnpm test:db` storage; PDP browser/a11y fallback.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

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

- [ ] **B10 — Measure whether trusted image proxy is justified** [B; deps: F00; Security/performance evidence gate]
  - [ ] Acceptance: Baseline numbers, alternatives, origin/redirect/SSRF and cache-key/CPU/bandwidth budgets documented.
  - [ ] Verification: Comparable real-image measurement + security design review.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [ ] **B11 — Implement bounded image endpoint only if approved** [B; deps: B10; Conditional: only when B10 approves]
  - [ ] Acceptance: Malicious/unreviewed redirects, URLs, oversized content and unbounded variants fail safely.
  - [ ] Verification: `pnpm test:domain` limits; HTTP security smoke; `pnpm build` and browser network check.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

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

- [ ] **C03b — Edit quantity / remove a line inside the cart drawer** [C; deps: C03; Optional, not started]
  - [ ] Acceptance: reuse `useCartLine` and the canonical cart mutation; no money or stock recalculation in the drawer; stale or double mutations do not lose buyer data; focus returns sensibly after a removal.
  - [ ] Verification: `pnpm test:domain` drawer mutation rules and a browser spec for double click, stale line and removal focus.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [ ] **A10 — Implement safe upsell add-one and checkout adapter** [A; deps: A09; Canonical cart mutation; no C03]
  - [ ] Acceptance: Server-validated idempotent add-one and quote refresh use current `storefront-cart-actions`, with optional checkout adapter independent of drawer.
  - [ ] Verification: `pnpm test:domain` upsell mutation, `pnpm test:db` cart concurrency, checkout a11y regression.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [ ] **C04 — Wire gift reminder and checkout role-lines only after A1** [C; deps: A08; Canonical quote; no C03]
  - [ ] Acceptance: Existing checkout read model consumes A08-proven paid/gift totals and preserves input across stale-proof recovery; no drawer required.
  - [ ] Verification: `pnpm test:domain` checkout view model, `tests/a11y-runtime/checkout.spec.ts` keyboard/browser.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [x] **C05 — Add optional search overlay after bounded suggestions** [C; deps: B07; Optional/default OFF]
  - [x] Acceptance: Overlay consumes B07's approved bounded suggestions and keyboard/empty/error states, never blocking C02/no-JS search.
  - [x] Verification: `pnpm test:domain` overlay model and `tests/a11y-runtime/discovery.spec.ts` runtime/focus. (Browser evidence is the new `search-overlay.spec.ts`; `discovery.spec.ts` and the editorial/evergreen specs are the OFF regression.)
  - Evidence: PR #33; `src/components/headless/search-overlay-model.ts` (pure), `use-search-overlay.ts`, brand `src/components/brand/search-overlay.tsx`; flag `SEARCH_OVERLAY_ENABLED` default OFF, effective only with `SEARCH_SUGGESTIONS_ENABLED`. Local on base `main@ebe7197`: lint 0 errors, typecheck, `pnpm test`, `search-overlay.spec.ts` 10/10 in Chromium (390×844, 1440×900, axe, keyboard, Tab trap, stale-response case). Exact-head CI and merge SHA in the [slice record](../docs/verification/core-kit-a-b-c-slice-record.md).

- [ ] **R00 — Repeat quality/rollback verification for each enabled slice** [Release; deps: F00; Every implementation PR]
  - [ ] Acceptance: Each released capability has real tests/build/CI/runtime evidence and a reversible enablement plan.
  - [ ] Verification: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:db`, `pnpm build`, `pnpm release:check` and relevant browser/runtime.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

## Batch checkpoints

- [ ] CP0: Plan §2 baseline matrix reviewed now; F00 revalidated at implementation SHA and F01 approved; no unreviewed campaign/Pancake assumptions.
- [ ] CP-A0: A01/A02/A03 role proof/history and locked same-SKU resource correctness.
- [ ] CP-A1: A04 OFF-only synthetic laq2/legacy parity plus A05 frozen paid eligibility and mixed-cart shipping; real checkout integration reserved for A08 after A07.
- [ ] CP-A2: A06/A07/A08 admin/gift/POS acceptance, feature OFF and compatibility.
- [ ] CP-A3: A09/A10 read-only proof + bounded idempotent upsell (optional).
- [ ] CP-B1: **GB1 approved child spec and G3 migration review BEFORE B01 code; GB1 rechecked at B03**; finite page-size, correct manual order across page boundaries, OFF original editorial, ON + empty editorial frame with accessible empty-list status/zero cards, and ON curated listing.
- [ ] CP-B2: B04/B05/B06/B07 independent merchandising and search gates.
- [x] CP-B3: B08 owner decision accepted through ADR 0010; B09 SKIPPED (not implemented). No category schema/SEO/route changes.
- [ ] CP-B4: B10 evidence and B11 optional-only implementation.
- [x] CP-C: C01–C05 independent headless/a11y gates; C02 PLP filter no B07; C05 optional search overlay depends B07; C03 drawer never blocks A10/C04. (PRs #29–#33; C04 remains blocked on A08 and is tracked above, not here.)
- [ ] CP-R: R00 per-slice verified release/rollback, not a big-bang flag flip.

## Verification template for implementation PRs

- [ ] One cohesive concern, all related tests, ADR 0005 reviewability, no unrelated refactor.
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` passed on the exact head.
- [ ] `pnpm test:db` passed when schemas/locking/orders/admin state touched.
- [ ] `pnpm build` and `pnpm release:check` passed.
- [ ] Relevant HTTP/Playwright/axe/keyboard/390×844,768,1440 regression actually run.
- [ ] Legacy `laq1`/old orders, active `/shop` and editorial `/new-arrivals` unchanged with feature OFF.
- [ ] POS behavior verified by controlled readback or relevant capability still OFF.
- [ ] Security/input/shop scope, observability, migration and rollback reviewed.
- [ ] Approval and final CI state recorded; no checkbox marked merely because docs merged.

**Do not start B09, B11 or production flag enablement without explicit approval of their gates.**
