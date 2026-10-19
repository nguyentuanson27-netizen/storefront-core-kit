# Core Kit reusable capabilities A/B/C — Implementation Plan v1

Status: **HISTORICAL PLAN (#27); remaining work narrowed 2026-10-19**. This document does not authorize POS writes, production deployment or feature activation.
Planning base: `storefront-core-kit/main@1f71d610387f1e000c89bc11732a79426fa0dfb8` (Spec PR #26 merged).
Normative source: [A/B/C umbrella spec](../docs/specs/core-kit-reusable-capabilities-a-b-c-v1.md).
Additional current authorities: [production hardening](../docs/specs/core-kit-production-hardening-v1.md), [selling modes](../docs/specs/core-kit-selling-modes-v1.md), [promotion and flash sale](../docs/specs/promotions-flash-sale-v1.md).
Companion execution tracker: [A/B/C checklist](./core-kit-reusable-a-b-c-v1-todo.md).

## Remaining scope — lean La.Na port (2026-10-19)

**This section overrides the unfinished task descriptions, dependency gates and test lists below.** Completed PRs and their recorded CI remain historical evidence, not tasks to redo. The goal is to transfer existing behaviour from [La.Na main](https://github.com/nguyentuanson27-netizen/la.na_design_storefront/tree/01eb7ca24bda63c4eb40208160083763412da68a) into Core Kit, not invent a new benefit engine, route, POS contract, image service or test program.

- **Source POS evidence (G2 for porting):** [La.Na's 2026-10-14 probe and 2026-10-15 production-adapter create/readback](https://github.com/nguyentuanson27-netizen/la.na_design_storefront/blob/main/docs/integrations/pancake-gift-quantity-acceptance.md) passed same-variation differing PAID prices and PAID+GIFT on shop `715077776`. [ADR 0016 D-08](https://github.com/nguyentuanson27-netizen/la.na_design_storefront/blob/main/docs/decisions/0016-gift-quantity-promotions-v1-decisions.md): quote/snapshot GIFT is 0 VND; outbound Pancake gift is **1,000 VND**, offset from PAID lines. Direct 0-VND POS create/readback was **not run and is not needed for this projection**. Reuse these artifacts; **do not re-run a Pancake probe for this port**.
- **Evidence boundary:** Core Kit P10 was on a **different shop** (`1635185058`); La.Na's run does not prove that shop supports all shapes. The recorded evidence is enough to *start porting*, not permission to turn a Core Kit shop ON. Keep A1 default OFF; a separate G6 owner/operational decision controls real orders. Do not label another shop “live-verified”.
- **A08 — priority 1:** Adapt La.Na's existing benefit checkout + [vendor projection](https://github.com/nguyentuanson27-netizen/la.na_design_storefront/blob/main/src/commerce/pancake-gift-projection.ts) and readback/submit integration into Core Kit's already-owned cart, quote, `laq2`, stock locks, order snapshot and gateway. Port only missing seams; do not copy La.Na pricing, stock ledger, campaigns or branded UI wholesale. The Core Kit child spec's older direct-0-VND POS test wording must be reconciled with D-08 before implementation, **without introducing a new POS shape**.
- **C04 — priority 2, after A08:** Adapt La.Na's [existing checkout gift picker/reminder](https://github.com/nguyentuanson27-netizen/la.na_design_storefront/blob/main/src/components/headless/checkout-gift-reminder-model.ts) and distinct PAID/GIFT display. Reuse the current checkout form; preserve its entered recipient/address on re-quote.
- **A09 — optional, not blocking:** La.Na's *current* checkout upsell is a **read-only banner linking to `/sale`** (owner OD-01/A), not inline add. Core Kit currently has **no `/sale` route**; do not add a route or substitute `/flash-sale` without equivalent semantics. Port only if an appropriate existing destination and canonical read model can be reused; otherwise **SKIP**.
- **SKIP / out of current scope:** A10 (old inline upsell add), B09 (taxonomy), B10/B11 (new image proxy/measurements). C03b (drawer quantity/removal) is **deferred/non-blocking**: La.Na already has it; copy the existing interaction only if explicitly needed later, not as prerequisite for A08/C04. No fresh feature work.
- **Verification budget:** Reuse La.Na tests/evidence and Core Kit's existing CI. For changed code, run existing *affected* tests plus normal CI lint/typecheck/build; database tests only for modified persistence/order/money/locking, targeted browser/axe only for modified UI. Add a regression only for a **port-specific defect**. No duplicate suites, repeat POS writes, performance experiment or exhaustive device matrix for every slice. Never waive safe money, authorization, capacity, legacy-OFF or real checkout compatibility checks.
- **Release (G6/R00) is separate:** review exact-head CI, shop configuration, rollback and owner approval **only before production ON**. Porting PRs keep flags OFF; no live POS order, shared DB migration or deployment is approved here.

## 1. Goal and review boundaries

Transfer brand-reusable commerce (A), merchandising (B) and headless interactions (C) demonstrated in La.Na without transferring its brand/style/category paths, preorder 15-day policy, owner thresholds or unverified Pancake behavior. Keep Core Kit's existing money, capacity, route shell, auth, media trust and listing URL authorities. New capabilities default OFF and are delivered as small vertical, separately reviewable slices.

**Do not overwrite** `tasks/plan.md` and `tasks/todo.md`: they already own LA Clothing Productization V2. Feature-named plans/todos are the existing repository convention. Tasks should fit one focused session where feasible; PR splitting follows [ADR 0005](../docs/decisions/0005-pr-scope-reviewability.md): atomicity/effective changed lines/test cohesion, **not** a mandatory 5-file threshold. Do not split code from the tests that prove it.

## 2. Audited baseline gap matrix — delivered in this /plan PR

**Pinned evidence:** `main@1f71d610387f1e000c89bc11732a79426fa0dfb8` (squash-merged spec #26). All **13** capability entries below name existing Core Kit **source and test** paths, checked against the full pinned tracked Git tree and inspected in the owning code/tests. Paths are repository-root-relative. These characterization tests validate **existing** behavior, not the proposed feature. No local runtime test is claimed.

Classification: **EXISTS** = requested baseline authority exists; **PARTIAL** = related authority exists but portable behavior is incomplete; **MISSING** = equivalent capability not found in the inspected Core Kit tree; **BRAND-ONLY** = La.Na-specific composition/vocabulary excluded from shared code. Adoption decision: **KEEP**, **ADAPT**, **REBUILD**, **SKIP**. Compound rows describe shared adoption; the explanation explicitly marks existing subcomponents that must remain authoritative.

| Capability | Classification | Decision | Verified Core Kit source paths | Existing test paths (baseline-only) | Gap / reuse boundary |
| --- | --- | --- | --- | --- | --- |
| **A1 — Gift / Quantity Tier** | **PARTIAL** | **ADAPT** | `src/commerce/promotion-pricing.ts`; `src/commerce/checkout-quote.ts` | `tests/domain/promotion-pricing.test.ts`; `tests/domain/checkout-quote.test.ts`; `tests/domain/guest-shipping-policy.test.ts` | Legacy PROMOTION/FLASH_SALE and paid quote exist; no benefit resolver and duplicate variation rejected. Extend canonical pricing. |
| **A2 — Smart Upsell** | **MISSING** | **ADAPT** | `src/commerce/storefront-cart-actions.ts`; `src/commerce/checkout-quote.ts` | `tests/database/storefront-cart-update-concurrency.test.ts`; `tests/domain/checkout-quote.test.ts` | Canonical cart/quote exist, no upsell module in the pinned tree. Adapt read-only proof semantics after A1. |
| **A3 — Gift-aware Capacity** | **PARTIAL** | **ADAPT** | `src/commerce/capacity-resources.ts`; `src/commerce/capacity-reservation-repository.ts`; `prisma/schema.prisma` | `tests/domain/capacity-resources.test.ts`; `tests/database/capacity-reservation.test.ts`; `tests/database/capacity-mirror-handoff-sync.test.ts` | KEEP existing locks/ledger, ADAPT paid+gift demand aggregation under unique (orderId,variantId) reservation. |
| **A4 — Benefit-aware Quote/Proof** | **PARTIAL** | **ADAPT** | `src/commerce/checkout-quote-proof.ts`; `src/commerce/guest-checkout-snapshot.ts` | `tests/domain/checkout-quote-proof.test.ts`; `tests/database/guest-checkout-p9a-quote-proof.test.ts`; `tests/database/guest-checkout-snapshot-schema.test.ts` | laq1 and legacy snapshot exist; missing role/lineId/laq2. Stage OFF-only adapters, real checkout after gift/eligibility. |
| **B1 — Curated New Arrivals** | **MISSING** | **ADAPT** | `src/routes/new-arrivals.ts`; `src/app/new-arrivals/page.tsx`; `src/routes/shop.ts` | `tests/a11y-runtime/editorial.spec.ts`; `tests/domain/route-manifest.test.ts` | MISSING applies **only to curated selection/listing**, not the existing route. ADAPT the current editorial route: OFF preserves its page and view model; ON adds an ordered curated read model reusing `/shop` catalog, pricing and availability, without a second search/filter authority. |
| **B2 — Merchandising/Admin** | **PARTIAL** | **ADAPT** | `src/commerce/collection-definition-repository.ts`; `src/routes/home.ts`; `src/commerce/storefront-related-products.ts` | `tests/database/collection-definition-repository.test.ts`; `tests/a11y-runtime/homepage-taxonomy.spec.ts`; `tests/a11y-runtime/related-products.spec.ts` | Collection homepage positions and related fallback already exist; adopt only missing product-level curation. |
| **B3 — Category Taxonomy** | **PARTIAL** | **KEEP** | `src/commerce/collection-definition.ts`; `src/routes/collection.ts`; `src/commerce/storefront-discovery.ts` | `tests/domain/collection-definition.test.ts`; `tests/domain/collection-discovery-url.test.ts`; `tests/domain/route-manifest.test.ts` | **KEEP only the baseline collections/discovery authority.** This is **not** the decision for or against a distinct taxonomy; B08 must independently approve/defer a generic taxonomy before B09, with no La.Na brand keys copied. |
| **B4 — Size-guide Media** | **PARTIAL** | **ADAPT** | `src/brand/size-guide.config.ts`; `src/routes/size-guide.ts` | `tests/a11y-runtime/evergreen-pages.spec.ts` | Size tables and approved measurements exist, optional media absent; tables must remain the fallback. |
| **B5 — Search Suggestions** | **PARTIAL** | **ADAPT** | `src/routes/search.ts`; `src/app/search/page.tsx`; `src/commerce/storefront-discovery.ts`; `src/commerce/storefront-catalog.ts` | `tests/domain/storefront-discovery.test.ts`; `tests/database/shop-effective-price-discovery.test.ts`; `tests/a11y-runtime/editorial.spec.ts` | /search form delegates results to /shop. Add bounded suggestions; never fork canonical URLs or prices. |
| **B6 — Product-image Delivery** | **EXISTS** | **KEEP** | `src/commerce/product-media.ts`; `src/components/brand/product-gallery.tsx` | `tests/domain/product-media.test.ts`; `tests/a11y-runtime/storefront-media.spec.ts` | Trusted HTTPS media/gallery already exists; proxy SKIP unless B10 evidence warrants B11. |
| **C1 — PDP Mobile Headless** | **PARTIAL** | **ADAPT** | `src/components/headless/variant-selection-model.ts`; `src/components/headless/resolve-gallery-model.ts`; `src/components/brand/product-detail.tsx` | `tests/domain/variant-selection-model.test.ts`; `tests/domain/gallery-model.test.ts`; `tests/a11y-runtime/pdp-promotion.spec.ts` | Selection and gallery decisions exist; add only missing interaction and accessibility contracts, not La.Na layout. |
| **C2 — PLP Filters/Search UX** | **PARTIAL** | **ADAPT** | `src/commerce/storefront-discovery.ts`; `src/routes/shop-model.ts`; `src/components/brand/listing-refine-form.tsx` | `tests/domain/storefront-discovery.test.ts`; `tests/a11y-runtime/discovery.spec.ts` | Canonical filters/chips/GET form exist. C02 filter behavior independent of B07; C05 overlay consumes B07. |
| **C3 — Cart/Checkout Headless** | **PARTIAL** | **ADAPT** | `src/routes/cart-model.ts`; `src/routes/checkout-model.ts`; `src/commerce/storefront-cart-actions.ts` | `tests/domain/cart-route-model.test.ts`; `tests/domain/checkout-route-model.test.ts`; `tests/a11y-runtime/checkout.spec.ts` | Existing server cart/checkout models; optional C03 drawer not a prerequisite for A10 or C04. |

**Explicit BRAND-ONLY / SKIP parts** (La.Na reference paths verified present; none is a Core Kit business requirement):

| Scope | Classification | Decision | La.Na source evidence | Core Kit seam and regression |
| --- | --- | --- | --- | --- |
| B3 fashion-specific category vocabulary/paths | **BRAND-ONLY** | **SKIP** | `la.na_design_storefront/src/brand/category.config.ts` | `src/commerce/collection-definition.ts` / `tests/domain/collection-definition.test.ts`; B08 decides independently whether generic categories are needed |
| C1 La.Na imagery/gallery art direction | **BRAND-ONLY** | **SKIP** | `la.na_design_storefront/src/components/brand/product-media-stage.tsx` | `src/components/headless/resolve-gallery-model.ts` / `tests/domain/gallery-model.test.ts` |
| C3 La.Na drawer visuals, copy and CSS | **BRAND-ONLY** | **SKIP** | `la.na_design_storefront/src/components/brand/cart-drawer.tsx` | `src/routes/cart-model.ts` / `tests/domain/cart-route-model.test.ts` |

**Additional verified La.Na implementation evidence (not authority):** `src/commerce/gift-quantity-gate.ts`, `src/commerce/promotion-upsell.ts`, `src/commerce/new-arrivals-selection.ts`, `src/commerce/merchandising-admin.ts`, `src/components/headless/plp-filter-model.ts`. Do not transplant La.Na owner decisions, stock ledger, price resolver or migrations into Core Kit.

**/plan gap-matrix gate:** source/test traceability + classification + adoption intent are **complete for this pinned baseline**. Open decisions (stacking, POS readback, schema, categories, image proxy) remain explicit gates before implementation. **F00 is revalidation of this existing matrix at the future /build SHA, not the deferred first gap-matrix deliverable.**

## 3. Remaining dependency order

```text
Completed: F00/F01, A01-A07, B01-B08, C01/C02/C03/C05
Port A08 (La.Na benefit quote -> Core Kit submit/Pancake adapter, OFF)
    -> Port C04 (La.Na gift choice/reminder on the existing checkout, OFF)
    -> A09 only if existing destination supports La.Na's current read-only banner; else SKIP
No A10 inline-add. B09 and B10/B11 SKIP. C03b deferred; no dependency on C03 for A08/C04.
G6/R00 only when choosing to activate in production.
```

The earlier A01-A07 and B/C implementation paths are done and do not need rebuilding. Carry forward their recorded tests; only fix a proven compatibility defect in a future port diff.

## 4. Non-negotiable interfaces and behavior

- **Gift lines:** `PAID X×1 + GIFT X×1` remain distinct `lineId`/role quote lines (GIFT=0 VND to buyer, `laq2`/history unchanged). Port La.Na D-08 **only in the outbound Pancake projection**: each gift unit=1,000 VND, offset from paid units while preserving the total. Do not send direct 0-VND lines as a new POS experiment.
- **Capacity:** existing `@@unique([orderId, variantId])` reservation stays the default; paid+gift same SKU demands a single locked reservation of **quantity 2**, including composite expansion, idempotent retry and SYNC_UNKNOWN mirror handoff.
- **Thresholds:** `Q_paid_eligible(campaign)` and `S_basis(campaign)` are scoped/frozen per campaign **before A1 discounts**. Shipping uses whole-cart paid `Q_paid_cart` and post-benefit `S_final_paid`; the current policy is strict `S_final_paid > freeShippingSubtotalVnd` OR `Q_paid_cart >= freeShippingMinQuantity`. No gift/unit fallback, quantity-0 shipping invocation, post-tier eligibility oscillation or browser-owned money.
- **New Arrivals:** default flag OFF preserves the editorial-only route, its view model, and zero curated-listing queries; ON+empty preserves the editorial frame and renders a clearly announced, accessible empty-list state with zero product cards and no backfill/redirect; ON+published selection renders manually ordered cards using existing catalog/price/availability and canonical PDP URLs, not a second shop filter/sort.
- **GB1 — B1 approval before implementation:** review/approve a dedicated B1 child spec **before B01 writes a Prisma schema/migration or any curated repository code** and recheck it before B03. The child spec must decide a **positive finite page-size limit** (named `pageSize`), maximum page/selection bounds, pagination mechanism and canonical page URLs, stable manual order across pages, handling of hidden/unpublished items without substitution/backfill, invalid/out-of-range pages, empty-state accessibility, data ownership, and additive schema/old-writer rollout/rollback. **G3 migration approval also applies before schema/SQL changes.** This plan does not select a default `pageSize` or approve any migration.
- **Safety:** server-authorized admin writes, bounded data/quotes/queries, trusted sources, no La.Na-specific brand/theme, no shadow price or capacity engine, no vendor readback claims without controlled proof.
- **Optional:** B3 taxonomy and B6 image proxy are conditional. Default OFF remains in place for A1/A2 and other behavior changes.

## 5. Minimal checkpoints

- **CP0/CP-A0/CP-A1/CP-B1/CP-B2/CP-B3:** Already backed by F00/F01 and merged PR evidence; no re-audit.
- **CP-A2:** A08 ports an actual benefit checkout on top of A01-A07. Keep OFF and verify only changed quote/order/POS seams using existing tests. G2 is *source evidence*, not proof of Core Kit's target shop.
- **CP-C:** C01/C02/C03/C05 already delivered. Finish C04 after A08 with a focused checkout gift/keyboard/quote regression. No drawer prerequisite.
- **CP-A3:** A09 optional and only with an existing destination; A10 SKIPPED. Neither blocks A08/C04.
- **CP-B4:** B10/B11 SKIPPED; no new media proxy.
- **CP-R:** Production activation, if requested, retains separate G6 approval and rollback; no per-slice bespoke release ceremony when flags remain OFF.

## 6. Boundaries that still matter

| Risk | Smallest safe handling |
| --- | --- |
| Vendor behaviour differs across shops | Carry La.Na's **shop-scoped** evidence forward; do not claim Core Kit shop verification or enable feature automatically |
| Different POS gift representation | Keep gift at 0 VND in website quote; use La.Na D-08 1,000-VND outbound projection; retain exact vendor/website total parity |
| Port changes existing checkout money, capacity or auth | Reuse Core Kit's canonical owners, targeted existing regression coverage and feature-OFF fallback |
| Stale La.Na UX plan | Follow latest merged La.Na main/OD-01/A, not obsolete inline upsell proposals; do not create `/sale` |
| Unnecessary new capabilities | B09/A10/B10/B11 SKIPPED; C03b optional; no new engine, API, route, proxy or generalized abstraction |
| Production readiness | G6 remains a separate human activation decision; no deployment or POS writes in port-planning PRs |

## 7. Focused verification, not another test project

Use existing Core Kit CI on the **exact changed head** (lint, typecheck, build and the repository's required checks). Reuse La.Na's source tests and documented Pancake results as input, not as a mandate to generate fresh duplicate suites.

- A08 order/proof/reservation changes: relevant existing domain/DB/integration regressions, especially legacy-OFF and money parity.
- C04 UI changes: relevant existing checkout/gift keyboard/axe/browser checks, not every viewport and flow unrelated to the diff.
- Docs-only changes: review consistency and PR diff; no application/POS test is required.
- **Not planned:** another Pancake create/readback, live shop probe, repeated full manual QA, new image benchmark or additional functionality.

Before production ON only: existing release/rollback/security review and explicit owner approval (G6).

## 8. Detailed tasks (dependency-ordered)

| ID | Work item | Dependencies | Gate |
| --- | --- | --- | --- |
| F00 | Revalidate audited matrix and ownership at implementation SHA | — | Revalidation gate |
| F01 | Approve child contracts and POS evidence matrix | F00 | Human / external evidence gate |
| A01 | Design/test v2 role lines and laq2 proof | F01 | Approved A contract |
| A02 | Add immutable benefit order persistence | A01 | Migration review |
| A03 | Aggregate gift and paid stock through existing locks | A01, A02 | Capacity safety gate |
| A04 | Stage laq2 proof/render adapters with synthetic fixtures (OFF) | A01, A02, A03 | OFF-only infrastructure |
| A05 | Implement pure paid-only tier eligibility and shipping basis | F01 | Stacking must be approved |
| A06 | Add benefit campaign admin lifecycle and persistence | A05, F01 | Admin/schema approval |
| A07 | Persist selected gift state and enforce fresh entitlement | A01, A05, A06 | Approved gift choice contract |
| A08 | Port La.Na benefit checkout/Pancake D-08 projection | A03-A07 (done) | La.Na evidence reused; Core Kit OFF |
| A09 | Optional: port current La.Na read-only banner if an existing destination fits | A08 | Otherwise SKIP; no new `/sale` route |
| B01 | Persist curated new-arrivals membership and order | F00 | BLOCKED: GB1 child spec + G3 migration approval before /build |
| B02 | Expose admin-only arrivals curator | B01 | Admin auth review |
| B03 | Add ON/OFF curated arrivals read model | B01, B02 | GB1 pagination/empty-state approval + route/SEO parity |
| B04 | Curate homepage featured products without copying collections | F00 | Gap/audit first |
| B05 | Add optional related-products editorial override | F00 | Fallback must be reviewed |
| B06 | Add optional trusted media for configured size guides | F00 | Optional/default OFF |
| B07 | Add bounded search suggestion read model | F00 | Independent |
| B08 | Decide category taxonomy versus current collections | F00 | Owner/architecture gate |
| B09 | Implement category identity and membership if approved | B08 | Conditional: only when B08 approves |
| B10 | SKIPPED: no new image proxy or measurement | — | Existing Core Kit media kept |
| B11 | SKIPPED: no new image endpoint | — | No implementation |
| C01 | Extract portable PDP/mobile selection interaction models | F00 | Independent |
| C02 | Add headless PLP filter interaction | F00 | Canonical discovery; no B07 |
| C03 | Add optional accessible headless cart drawer | F00 | Independent |
| A10 | SKIPPED: obsolete inline checkout add (La.Na OD-01/A) | — | No implementation |
| C04 | Port La.Na checkout gift picker/reminder into existing Core Kit checkout | A08 | Default OFF; no C03 dependency |
| C05 | Add optional search overlay after bounded suggestions | B07 | Optional/default OFF |
| R00 | Release/rollback verification if feature is activated | G6 | No production ON without owner approval |

### F00: Revalidate audited matrix and ownership at implementation SHA

**Intent:** The initial 13-capability gap matrix, verified code/test paths and KEEP/ADAPT/REBUILD/SKIP decisions are **already delivered in §2** for this /plan PR. At each /build SHA, compare that review baseline against current code/test owners, record drift and resolve any contract-breaking differences before applying implementation tasks. This is not another postponed initial audit.

**Dependencies:** None. **Gate:** Revalidation gate; approve the matrix **now** while reviewing this plan.

**Acceptance:**
- [ ] Compare every existing matrix row against the chosen implementation SHA; update only changed source paths, tests and reuse decisions with evidence.
- [ ] Pin the new SHA and reviewer acknowledgement, with no parallel pricing, stock, checkout, collection or URL authority introduced.

**Verification (future implementation, not this PR):**
- [ ] Review current tree and owner modules versus §2; run relevant focused characterization tests only when required, recording their real exact-head CI evidence.

**Likely touched/reviewed files** (not exact diff promises):
- `tasks/core-kit-reusable-a-b-c-v1-plan.md` (§2 baseline matrix)
- `docs/specs/core-kit-reusable-capabilities-a-b-c-v1.md` (approved source)
- `tests/domain/route-boundary.test.ts` (boundary verification)

### F01: Approve child contracts and POS evidence matrix

**Intent:** Write and review the A1/A3/A4 child contract before touching money or schema; enumerate Pancake same-variation PAID+GIFT, 0-VND and multi-price acceptance/readback tests.

**Dependencies:** F00. **Gate:** Human / external evidence gate.

**Acceptance:**
- [ ] Owner signs off on stacking/priority, paid/eligible/shipping bases, lineId, role, laq2 compatibility, reservation and rollback constraints.
- [ ] Unknown or rejected vendor capabilities stay OFF; no invented order-line fallback or production probing.

**Verification (future implementation, not this PR):**
- [ ] Human design review plus controlled POS evidence plan; no API mutation in plan-only PR.

**Likely touched/reviewed files** (not exact diff promises):
- `docs/specs/core-kit-benefit-quote-v1.md` (proposed)
- `docs/integrations/pancake.md` (read)

### A01: Design/test v2 role lines and laq2 proof

**Intent:** Introduce unique lineId and explicit PAID/GIFT for signed canonical quote facts; preserve existing laq1 proof on legacy checkouts.

**Dependencies:** F01. **Gate:** Approved A contract.

**Acceptance:**
- [ ] PAID X + GIFT X are distinct signed lines; invalid duplicate IDs/roles/prices fail closed.
- [ ] laq1 cannot authorize benefit quotes; laq2 binds paid/gift roles, money, shipping, entitlements and buyer cart.

**Verification (future implementation, not this PR):**
- [ ] `pnpm test:domain` quote/proof regressions, bounds, tamper and legacy vectors.

**Likely touched/reviewed files** (not exact diff promises):
- `src/commerce/checkout-quote-proof.ts`
- `src/commerce/checkout-quote.ts`
- `src/commerce/benefit-quote-lines.ts` (new)
- `tests/domain/checkout-quote-proof.test.ts`

### A02: Add immutable benefit order persistence

**Intent:** Extend order-line snapshots and quote digest additively for role/lineId without replacing old orders or changing paid CartItem identity.

**Dependencies:** A01. **Gate:** Migration review.

**Acceptance:**
- [ ] Same-variation role lines round-trip with stable audit facts; legacy rows with no v2 data remain readable.
- [ ] Rollback/old writer coexistence and expand-first migration are documented and tested before enabling.

**Verification (future implementation, not this PR):**
- [ ] `pnpm prisma:validate` and `pnpm test:db` snapshot schema/rollback/legacy readback.

**Likely touched/reviewed files** (not exact diff promises):
- `prisma/schema.prisma`
- `prisma/migrations/<approved-additive>/migration.sql` (new)
- `src/commerce/guest-checkout-snapshot.ts`
- `tests/database/guest-checkout-snapshot-schema.test.ts`

### A03: Aggregate gift and paid stock through existing locks

**Intent:** Map distinct role lines to summed VariantMirror resource demand and reuse current deterministic row locks, composite expansion, mirror handoff and SYNC_UNKNOWN semantics.

**Dependencies:** A01, A02. **Gate:** Capacity safety gate.

**Acceptance:**
- [ ] PAID X×1 + GIFT X×1 holds quantity 2 in one order/variant reservation; stock 1 refuses all atomically.
- [ ] Concurrent checkout, retry and mirror handoff cannot double reserve, release or consume components incorrectly.

**Verification (future implementation, not this PR):**
- [ ] `pnpm test:db` capacity-reservation/mirror-handoff/concurrency and `pnpm test:domain` capacity resources.

**Likely touched/reviewed files** (not exact diff promises):
- `src/commerce/capacity-resources.ts`
- `src/commerce/capacity-reservation-repository.ts`
- `tests/database/capacity-reservation.test.ts`
- `tests/domain/capacity-resources.test.ts`

### A04: Stage laq2 proof/render adapters with synthetic fixtures (OFF)

**Intent:** Prepare typed `laq2` quote/render/draft adapters using **synthetic server-owned PAID/GIFT role-line fixtures** and approved versioned proof. Keep the A1 gate OFF. This task does **not** enable or integrate real benefit eligibility, selected gifts or the buyer submit path. **A08** will connect A05 eligibility and A07 gift selection into the real render/submit flow and POS order mapping.

**Dependencies:** A01, A02, A03. **Gate:** OFF-only infrastructure; legacy checkout remains the only live path.

**Acceptance:**
- [ ] Legacy `laq1` remains unchanged and never signs benefits; bounded synthetic `laq2` fixtures preserve signed role/lineId, amount and shipping parity through adapters.
- [ ] Material synthetic quote/entitlement changes require new proof; harmless stock-sync metadata does not. No benefit-enabled buyer submit is reachable until A08.

**Verification (future implementation, not this PR):**
- [ ] `pnpm test:domain` fixture-based quote/proof; `pnpm test:db` legacy snapshot/version readback and A1 flag-OFF checkout regression.

**Likely touched/reviewed files** (not exact diff promises):
- `src/commerce/guest-checkout-snapshot.ts`
- `src/commerce/checkout-quote.ts`
- `src/commerce/checkout-quote-proof.ts`
- `tests/database/guest-checkout-p9a-quote-proof.test.ts`

### A05: Implement pure paid-only tier eligibility and shipping basis

**Intent:** Resolve Q_paid_eligible(campaign), S_basis(campaign) once per campaign, then post-benefit whole-cart S_final_paid and Q_paid_cart for shipping only.

**Dependencies:** F01. **Gate:** Stacking must be approved.

**Acceptance:**
- [ ] A×1 eligible + B×2 ineligible => campaign count 1, shipping count 3; no eligible units => campaign 0 but shipping count positive.
- [ ] Gift/composite units never inflate paid quantity; strict shipping amount > threshold and paid quantity >= min; discounts never oscillate eligibility.

**Verification (future implementation, not this PR):**
- [ ] `pnpm test:domain` benefit/guest-shipping-policy tests including all threshold boundaries.

**Likely touched/reviewed files** (not exact diff promises):
- `src/commerce/benefit-eligibility.ts` (new)
- `src/commerce/benefit-quote.ts` (new)
- `tests/domain/benefit-eligibility.test.ts` (new)
- `tests/domain/guest-shipping-policy.test.ts`

### A06: Add benefit campaign admin lifecycle and persistence

**Intent:** Add optional campaign draft/preview/publish/disable with bounded scope, conflict, exclusion and time rules; reuse existing admin/server auth and legacy promotion pricing.

**Dependencies:** A05, F01. **Gate:** Admin/schema approval.

**Acceptance:**
- [ ] Non-admin or invalid campaign write fails closed; enabled conflicting rules resolve per approved contract.
- [ ] Default OFF preserves PROMOTION/FLASH_SALE behavior; publication is atomic and shop-scoped.

**Verification (future implementation, not this PR):**
- [ ] `pnpm test:domain` admin validation/auth and `pnpm test:db` lifecycle/concurrency/migration.

**Likely touched/reviewed files** (not exact diff promises):
- `prisma/schema.prisma` and approved migration
- `src/commerce/benefit-campaign-service.ts` (new)
- `src/app/admin/promotions/actions.ts`
- `tests/database/benefit-campaign-lifecycle.test.ts` (new)

### A07: Persist selected gift state and enforce fresh entitlement

**Intent:** Store gift selection separately from the unique paid CartItem and revalidate source campaign, variation, stock and entitlement at checkout.

**Dependencies:** A01, A05, A06. **Gate:** Approved gift choice contract.

**Acceptance:**
- [ ] Stale/invalid selected gift blocks affected checkout without silent substitution or paid-cart corruption.
- [ ] PAID X + GIFT X retains two immutable role identities but paid count and shipping exclude gift.

**Verification (future implementation, not this PR):**
- [ ] `pnpm test:domain` gift-choice validation and `pnpm test:db` concurrency/revalidation.

**Likely touched/reviewed files** (not exact diff promises):
- `src/commerce/cart-gift-selection.ts` (new)
- `src/commerce/storefront-cart-actions.ts`
- `tests/domain/cart-gift-selection.test.ts` (new)
- `tests/database/cart-gift-selection.test.ts` (new)

### A08: Port existing La.Na benefit checkout (priority 1)

**Dependencies:** A03-A07 already completed. Keep Core Kit's canonical price/cart/proof/capacity/order code and flag-OFF path. Adapt only La.Na's missing benefit render/submit, deterministic D-08 vendor projection and readback comparison; no new engine or POS contract.

**Acceptance:** Paid/gift role lines, quote, vendor projection, snapshot and total remain consistent; uncertain writes and unsupported shop configurations fail safely; legacy checkout remains unchanged when OFF.

**Verification:** Reuse La.Na's [live adapter evidence](https://github.com/nguyentuanson27-netizen/la.na_design_storefront/blob/main/docs/integrations/pancake-gift-quantity-acceptance.md) and existing affected Core Kit domain/DB/integration tests. Run exact-head CI. **No new live POS probe.**

### A09: Optional port of the current La.Na upsell (not blocking)

La.Na now displays a [read-only checkout invitation to `/sale`](https://github.com/nguyentuanson27-netizen/la.na_design_storefront/blob/main/src/components/commerce/checkout-upsell.tsx), not an inline add-one action. Core Kit has no `/sale` route. **SKIP** unless the same invitation can point to an already-existing, semantically correct product destination; do not build a new route, simulation engine, add-one action or backend workflow.

**Verification only if ported:** Existing relevant checkout/quote and link/focus regressions; normal CI. No new upsell test program.

### B01: Persist curated new-arrivals membership and order

**Intent:** Persist stable website-owned ordered product selection, independent of ProductMirror.createdAt, collections and shop sort.

**Dependencies:** F00. **Gate:** **BLOCKED until GB1 and G3 are approved before /build.** F00 completion alone does not authorize code.

**Acceptance:**
- [ ] **Before any schema, migration SQL or repository implementation:** B1 child spec has recorded owner/reviewer approval of selection identity, stable manual order, bounded pagination and `pageSize`, visibility/empty semantics, auth/data ownership and additive migration/old-writer/rollback plan; the actual Prisma schema/migration design is separately reviewed under G3. Neither gate is waived by approving this umbrella plan.
- [ ] Atomic bounded add/remove/reorder; empty selection is durable, independent of `ProductMirror.createdAt`; persistence does not overwrite current collections or mirror ownership.
- [ ] Pancake sync cannot overwrite ordered selection; concurrent edits/invalid input are safe, old writers and migration coexist, and a selected item removed/hidden is never replaced from unrelated products.

**Verification (future implementation, not this PR):**
- [ ] Record **GB1 child spec and G3 schema review links before /build**; only then run `pnpm prisma:validate`, `pnpm test:db` for curation, ordering, concurrency, migration and backwards-compatibility.

**Likely touched/reviewed files** (not exact diff promises):
- `prisma/schema.prisma`
- `prisma/migrations/<new-arrivals-additive>/migration.sql` (new)
- `src/commerce/new-arrivals-repository.ts` (new)
- `tests/database/new-arrivals-selection.test.ts` (new)

### B02: Expose admin-only arrivals curator

**Intent:** Use server-authorized search/add/remove/reorder with validated shop scope and bounded inputs; keep edit operations transactional.

**Dependencies:** B01. **Gate:** Admin auth review.

**Acceptance:**
- [ ] Only admins change selection, with reliable validation feedback and persisted ordering.
- [ ] Cross-shop/hidden/invalid products and unbounded lists are rejected; unrelated collections untouched.

**Verification (future implementation, not this PR):**
- [ ] `pnpm test:domain` admin/auth and `pnpm test:db` writes; authenticated HTTP smoke.

**Likely touched/reviewed files** (not exact diff promises):
- `src/app/admin/new-arrivals/actions.ts` (new)
- `src/app/admin/new-arrivals/page.tsx` (new)
- `src/commerce/new-arrivals-admin.ts` (new)
- `tests/domain/new-arrivals-admin.test.ts` (new)

### B03: Add ON/OFF curated arrivals read model

**Intent:** Extend the current editorial-only /new-arrivals route with flagged manual-order product cards using shop catalog, price, stock, publication and route shell authority.

**Dependencies:** B01, B02. **Gate:** **GB1 approved pagination/empty-state contract**, plus route/SEO parity. B01/B02 completion alone cannot bypass GB1.

**Acceptance:**
- [ ] **GB1 child spec approval is recorded before this read-model implementation.** It defines a positive, finite `pageSize` limit and bounded pages, pagination/query/canonical-URL behavior, and whether visibility filtering precedes/follows pagination without backfill; no default `pageSize` is silently invented by this plan.
- [ ] **Flag OFF:** the current editorial frame, empty route view model and metadata/route shell remain unchanged, with no curated data queries. **Flag ON + zero curated products:** preserve the editorial frame and render a **visible, screen-reader-accessible empty-list status** with zero product cards; no redirect, created-at fallback or automatic backfill.
- [ ] **Flag ON + selections:** canonical `/shop` catalog/price/availability and PDP links, published/valid products only, saved manual order preserved **across every page** with no duplicate/missing valid items; hidden/stale IDs are skipped without replacement; existing `/shop` filters/ranking unaffected. Handle invalid and out-of-range page requests according to the approved GB1 contract.

**Verification (future implementation, not this PR):**
- [ ] `pnpm test:domain` for route/manifest, **pagination boundaries at N-1/N/N+1/2N+1 items (N = approved finite `pageSize`)**, stable manual order across page transitions, missing/hidden selection, invalid/out-of-range page requests and no backfill; `pnpm test:db` query bounds/listing parity; browser/axe/keyboard checks for **OFF editorial**, **ON + empty accessible status with editorial frame**, ON nonempty and page links at 390×844, 768 and 1440px.

**Likely touched/reviewed files** (not exact diff promises):
- `src/routes/new-arrivals.ts`
- `src/routes/new-arrivals-model.ts` (new)
- `src/app/new-arrivals/page.tsx`
- `tests/domain/new-arrivals-route.test.ts` (new)

### B04: Curate homepage featured products without copying collections

**Intent:** Add only missing admin-owned ordered homepage featured relation, distinct from CollectionDefinition.homepagePosition and collection pinning, under a feature flag.

**Dependencies:** F00. **Gate:** Gap/audit first.

**Acceptance:**
- [ ] OFF preserves auto discovery homepage edit; ON selection is ordered, bounded, persistent and independent of collections.
- [ ] Hidden/unpublished products do not leak or silently backfill.

**Verification (future implementation, not this PR):**
- [ ] `pnpm test:db` featured product CRUD and `pnpm test:domain` home view model.

**Likely touched/reviewed files** (not exact diff promises):
- `src/commerce/homepage-featured-repository.ts` (new)
- `src/routes/home.ts`
- `src/routes/home-model.ts`
- `tests/database/homepage-featured.test.ts` (new)

### B05: Add optional related-products editorial override

**Intent:** Keep existing collection-derived fallback unless separately changed by approved spec, with only a bounded admin manual override layered on top.

**Dependencies:** F00. **Gate:** Fallback must be reviewed.

**Acceptance:**
- [ ] Manual candidates exclude self, duplicates, hidden/out-of-scope products; absent override uses documented fallback.
- [ ] No accidental writes to Pancake, collection pins or product pricing/stock authority.

**Verification (future implementation, not this PR):**
- [ ] `pnpm test:domain` override/fallback + `pnpm test:db` admin operation.

**Likely touched/reviewed files** (not exact diff promises):
- `src/commerce/storefront-related-products.ts`
- `src/commerce/related-products-repository.ts` (new)
- `src/routes/product.ts`
- `tests/domain/related-products-override.test.ts` (new)

### B06: Add optional trusted media for configured size guides

**Intent:** Allow admin to attach a trusted image to a brand guide ID while leaving published measurement tables canonical and always available.

**Dependencies:** F00. **Gate:** Optional/default OFF.

**Acceptance:**
- [ ] Unknown guide IDs and untrusted images rejected; writes require authenticated admin role.
- [ ] Missing/broken image always falls back to the original tables without altering measurements.

**Verification (future implementation, not this PR):**
- [ ] `pnpm test:domain` validation, `pnpm test:db` storage; PDP browser/a11y fallback.

**Likely touched/reviewed files** (not exact diff promises):
- `src/commerce/size-guide-media.ts` (new)
- `src/app/admin/size-guides/page.tsx` (new)
- `src/brand/size-guide.config.ts` (read)
- `tests/domain/size-guide-media.test.ts` (new)

### B07: Add bounded search suggestion read model

**Intent:** Search only published shop-scoped catalog using canonical effective price and approved images, without adding another search URL or price authority.

**Dependencies:** F00. **Gate:** Independent.

**Acceptance:**
- [ ] Hidden/stale products omitted; suggestions count, input length, latency and DB query volume bounded.
- [ ] Existing /search and /shop with no JavaScript continue working, with truthful prices/availability.

**Verification (future implementation, not this PR):**
- [ ] `pnpm test:domain` discovery/search and `pnpm test:db` suggestions visibility/price tests.

**Likely touched/reviewed files** (not exact diff promises):
- `src/commerce/storefront-search-suggestions.ts` (new)
- `src/routes/search.ts`
- `src/commerce/storefront-discovery.ts` (read)
- `tests/database/search-suggestions.test.ts` (new)

### B08: Decide category taxonomy versus current collections

**Intent:** Evaluate whether current collections/filter routes suffice. If not, approve a brand-config identity, route/SEO and membership plan without inheriting La.Na category keys.

**Dependencies:** F00. **Gate:** Owner/architecture gate.

**Acceptance:**
- [ ] Reviewed ADR chooses KEEP collections or ADD separate taxonomy, with exact ownership, keys, indexation and orphan rules.
- [ ] If KEEP/deferred, B09 is SKIPPED; no brand-specific paths or category migrations added.

**Verification (future implementation, not this PR):**
- [ ] Owner/SEO architecture review; inspect route manifest, sitemap and current collection tests.

**Likely touched/reviewed files** (not exact diff promises):
- `docs/decisions/<category-decision>.md` (proposed)
- `src/brand/navigation.config.ts` (read)
- `src/routes/collection.ts` (read)

### B09: Implement category identity and membership if approved

**Intent:** Build stable config keys plus website-owned membership/order and reviewed routes, with duplicate-path/orphan checks; split further by ADR 0005 if required.

**Dependencies:** B08. **Gate:** Conditional: only when B08 approves.

**Acceptance:**
- [ ] Taxonomy consistency enforced across config, route and sitemap; invalid or orphaned data fails closed.
- [ ] Existing collections and canonical shop URL authority preserved; no hardcoded La.Na paths.

**Verification (future implementation, not this PR):**
- [ ] `pnpm test:domain` taxonomy/SEO; `pnpm test:db` membership; indexation runtime.

**Likely touched/reviewed files** (not exact diff promises):
- `src/brand/category.config.ts` (new)
- `src/commerce/category-taxonomy.ts` (new)
- `src/commerce/category-membership-repository.ts` (new)
- `tests/domain/category-taxonomy.test.ts` (new)

### B10/B11: SKIPPED — no image proxy project

Core Kit already owns trusted media and responsive rendering. La.Na has an image endpoint, but **this port does not require copying it**. No new endpoint, CDN experiment, performance baseline or security review for a feature not being built. Existing media checks remain as they are.

### C01: Extract portable PDP/mobile selection interaction models

**Intent:** Extend existing variant-selection/gallery state only where missing; leave brand component layout, image ratio and typography disposable.

**Dependencies:** F00. **Gate:** Independent.

**Acceptance:**
- [ ] Selection/not chosen/out of stock/loading/preorder use existing business truth without parallel pricing.
- [ ] Swipe, focus, keyboard, sticky mobile purchase and no overflow checked at 390×844/768/1440.

**Verification (future implementation, not this PR):**
- [ ] `pnpm test:domain` PDP models and `tests/a11y-runtime/pdp-promotion.spec.ts`.

**Likely touched/reviewed files** (not exact diff promises):
- `src/components/headless/resolve-gallery-model.ts`
- `src/components/headless/variant-selection-model.ts` (reuse)
- `src/components/brand/product-detail.tsx`
- `tests/domain/pdp-mobile-interaction.test.ts` (new)

### C02: Add headless PLP filter interaction

**Intent:** Implement only the missing reusable filter drawer/disclosure/chip/focus behavior atop **existing** `src/commerce/storefront-discovery.ts` and `src/routes/shop-model.ts`. Current URL parsing, filter/sort truth and GET/no-JS submission already work; **B07 bounded search suggestions are not required** for this task.

**Dependencies:** F00. **Gate:** Canonical discovery authority, independent of B07/C05.

**Acceptance:**
- [ ] Applying/removing any filter retains the other valid criteria and resets page; existing GET/no-JS filtering still works.
- [ ] Mobile disclosure/focus restoration, active-count labels and keyboard behavior are accessible without a second sort, URL or price engine.

**Verification (future implementation, not this PR):**
- [ ] `pnpm test:domain` discovery + filter model; `tests/a11y-runtime/discovery.spec.ts` at mobile and desktop.

**Likely touched/reviewed files** (not exact diff promises):
- `src/components/headless/plp-filter-model.ts` (new)
- `src/routes/shop-model.ts` (reuse)
- `src/components/brand/listing-refine-form.tsx` (optional adapter)
- `tests/domain/plp-filter-model.test.ts` (new)

### C03: Add optional accessible headless cart drawer

**Intent:** Use current authoritative cart mutation and route view model for totals/availability; expose overlay/focus/close/return-focus behavior with brand adapter.

**Dependencies:** F00. **Gate:** Independent.

**Acceptance:**
- [ ] Keyboard focus trap/restore and Escape work; stale/double mutations do not lose buyer data.
- [ ] OFF retains existing cart page; drawer never recalculates item money or stock.

**Verification (future implementation, not this PR):**
- [ ] `pnpm test:domain` cart models + `tests/a11y-runtime/checkout.spec.ts` and mobile keyboard.

**Likely touched/reviewed files** (not exact diff promises):
- `src/components/headless/cart-drawer-model.ts` (new)
- `src/components/brand/cart-drawer.tsx` (optional)
- `src/routes/cart-model.ts` (reuse)
- `tests/domain/cart-drawer-model.test.ts` (new)

### A10: SKIPPED — inline checkout add is obsolete

Latest La.Na owner decision OD-01/A removes direct add-one UI from checkout. Do not implement an older plan's add-one action or route just to close a checkbox.

### C04: Port La.Na gift picker/reminder (priority 2, after A08)

Reuse existing [La.Na gift-repair/reminder models](https://github.com/nguyentuanson27-netizen/la.na_design_storefront/blob/main/docs/verification/storefront-gift-picker-checkout-reminder.md) against Core Kit's single checkout form and authoritative benefit quote. No new eligibility rule, alternate checkout, UI redesign or duplicate cart drawer.

**Acceptance:** Paid/gift lines are distinct and totals authoritative; invalid/unavailable selection is repairable without auto-picking a gift; reconfirmation preserves receiving fields. OFF remains the existing checkout.

**Verification:** Existing focused gift/checkout model tests plus the relevant browser/keyboard check on the changed UI. No duplicate end-to-end suite.

### C05: Add optional search overlay after bounded suggestions

**Intent:** Supply an independent search overlay open/close/focus/result state over B07's **bounded** and server-priced suggestions. The existing search entry form sending GET to `/shop` remains usable without JavaScript. C02 PLP filters neither depend on this overlay nor require B07.

**Dependencies:** B07. **Gate:** Optional/default OFF until suggestions are bounded and approved.

**Acceptance:**
- [ ] Approved suggestion results alone are displayed; stale responses, loading/empty/error states and canonical PDP/`/shop` links behave correctly.
- [ ] Escape/focus return, keyboard/aria behavior and no-JS fallback pass; disabling overlay does not alter C02 filtering or canonical money.

**Verification (future implementation, not this PR):**
- [ ] `pnpm test:domain` search overlay model; `tests/a11y-runtime/discovery.spec.ts` keyboard/mobile/no-JS assertions.

**Likely touched/reviewed files** (not exact diff promises):
- `src/components/headless/search-overlay-model.ts` (new)
- `src/components/brand/search-overlay.tsx` (optional adapter)
- `src/routes/search.ts` (reuse)
- `tests/domain/search-overlay-model.test.ts` (new)

### R00: Release only, not a blocker for porting with flags OFF

For each port PR, record exact head, relevant existing CI and the OFF rollback. Do **not** repeat vendor probes or broad manual test matrices. Only when choosing to activate in production, review target-shop configuration/known evidence boundary, security, data migration if changed, rollback, monitoring and owner go/no-go (G6).

## 9. Handoff and merge discipline

1. Review/approve this plan separately from the already merged umbrella spec.
2. F00/F01 and their baseline review are already completed; the 2026-10-19 remaining-scope section governs unstarted work. No new migration or POS write is authorized by this plan.
3. Split by one reviewed semantic capability. ADR 0005 governs changed-line scope; tests, migrations and rollback must accompany the behavior they prove.
4. Link task ID, parent spec section, exact base/head SHA and verification in each implementation PR. Do not infer implementation completion from merged documentation.
5. Ship and enable only the slices whose dependencies and external/production evidence are fulfilled. Deferred B3/B6 work stays deferred until separately approved.
