# Core Kit reusable capabilities A/B/C — Implementation Plan v1

Status: **PROPOSED — PLAN ONLY**. This planning PR cannot authorize application code, migrations, production feature flags, external POS writes or launch.
Planning base: `storefront-core-kit/main@1f71d610387f1e000c89bc11732a79426fa0dfb8` (Spec PR #26 merged).
Normative source: [A/B/C umbrella spec](../docs/specs/core-kit-reusable-capabilities-a-b-c-v1.md).
Additional current authorities: [production hardening](../docs/specs/core-kit-production-hardening-v1.md), [selling modes](../docs/specs/core-kit-selling-modes-v1.md), [promotion and flash sale](../docs/specs/promotions-flash-sale-v1.md).
Companion execution tracker: [A/B/C checklist](./core-kit-reusable-a-b-c-v1-todo.md).

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
| **B1 — Curated New Arrivals** | **MISSING** | **REBUILD** | `src/routes/new-arrivals.ts`; `src/app/new-arrivals/page.tsx`; `src/routes/shop.ts` | `tests/a11y-runtime/editorial.spec.ts`; `tests/domain/route-manifest.test.ts` | Route is editorial-only; add flagged curated read model, reuse /shop catalog, never add second price/filter owner. |
| **B2 — Merchandising/Admin** | **PARTIAL** | **ADAPT** | `src/commerce/collection-definition-repository.ts`; `src/routes/home.ts`; `src/commerce/storefront-related-products.ts` | `tests/database/collection-definition-repository.test.ts`; `tests/a11y-runtime/homepage-taxonomy.spec.ts`; `tests/a11y-runtime/related-products.spec.ts` | Collection homepage positions and related fallback already exist; adopt only missing product-level curation. |
| **B3 — Category Taxonomy** | **PARTIAL** | **KEEP** | `src/commerce/collection-definition.ts`; `src/routes/collection.ts`; `src/commerce/storefront-discovery.ts` | `tests/domain/collection-definition.test.ts`; `tests/domain/collection-discovery-url.test.ts`; `tests/domain/route-manifest.test.ts` | KEEP website-owned collections; separate taxonomy requires B08 approval, otherwise skip B09. |
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

## 3. Dependency graph and execution order

```text
F00 revalidate the /plan gap matrix at implementation SHA → F01 owner contracts + POS evidence
    F01 → A01 role lineId/laq2 → A02 additive history → A03 combined locked capacity → A04 OFF-only laq2 adapters (synthetic fixtures)
    F01 → A05 frozen campaign eligibility + paid-only shipping → A06 admin lifecycle → A07 gift selection
    [A03, A04, A05, A06, A07, POS evidence] → A08 real A1 checkout render/submit + POS parity
    A08 → A09 read-only upsell → A10 canonical add-one checkout action (no cart drawer)

F00 → B01 selection storage → B02 admin → B03 flagged New Arrivals
F00 → B04 homepage featured; B05 related override; B06 size media; B07 suggestions
F00 → B08 category decision → B09 only if approved
F00 → B10 image measurement → B11 only if approved

F00 → C01 PDP; C02 PLP filters; C03 optional cart drawer
B07 → C05 optional search overlay (not a C02 prerequisite)
A08 → C04 checkout gift UI (not a C03 prerequisite)

R00 repeats release/verification for each independently enabled slice.
```

B01–B07, C01/C02/C03 can proceed independently after F00. B08/B10 research does not authorize B09/B11. A04 creates **OFF-only** versioned quote plumbing with synthetic data and is not a live A1 checkout integration; A08 completes real buyer render/submit after A05 and A07. A10 consumes existing canonical `src/commerce/storefront-cart-actions.ts` and checkout quote authority, with **no C03 dependency**. C04 consumes A08's server quote/`src/routes/checkout-model.ts`, with **no C03 dependency**. A separate adapter may depend on C03 only if it actually embeds the drawer. B07 is required only by C05's optional search overlay, not C02 filtering. Parallel schema, checkout and shared-interface work must coordinate reviewed contracts.

## 4. Non-negotiable interfaces and behavior

- **Gift lines:** `PAID X×1 + GIFT X×1` is two distinct `lineId`+role lines (0-VND only for GIFT), not duplicate paid CartItem rows; laq1 remains legacy-only, laq2 signs full quote/entitlement. Historic orders without v2 fields remain readable.
- **Capacity:** existing `@@unique([orderId, variantId])` reservation stays the default; paid+gift same SKU demands a single locked reservation of **quantity 2**, including composite expansion, idempotent retry and SYNC_UNKNOWN mirror handoff.
- **Thresholds:** `Q_paid_eligible(campaign)` and `S_basis(campaign)` are scoped/frozen per campaign **before A1 discounts**. Shipping uses whole-cart paid `Q_paid_cart` and post-benefit `S_final_paid`; the current policy is strict `S_final_paid > freeShippingSubtotalVnd` OR `Q_paid_cart >= freeShippingMinQuantity`. No gift/unit fallback, quantity-0 shipping invocation, post-tier eligibility oscillation or browser-owned money.
- **New Arrivals:** default flag OFF preserves editorial-only route with no list queries; ON+empty stays empty; ON+published selection renders manually ordered cards using existing catalog/price/availability and canonical PDP URLs, not a second shop filter/sort.
- **Safety:** server-authorized admin writes, bounded data/quotes/queries, trusted sources, no La.Na-specific brand/theme, no shadow price or capacity engine, no vendor readback claims without controlled proof.
- **Optional:** B3 taxonomy and B6 image proxy are conditional. Default OFF remains in place for A1/A2 and other behavior changes.

## 5. Checkpoints (stop/go between small batches)

**CP0 (F00–F01):** The complete source/test/reuse gap matrix is already supplied in §2 of this /plan. F00 revalidates it at the /build SHA; F01 reviews child contracts, stacking and POS acceptance evidence. Unknown vendor cases stay OFF.

**CP-A0 (A01–A03):** v2 role identity/history + locked demand, same-SKU stock2 passes/stock1 refuses, concurrency and legacy readers.

**CP-A1 (A04–A05):** A04 tests laq1/laq2 adapters **OFF with synthetic role-line fixtures**; A05 proves frozen campaign thresholds and mixed/no-eligible shipping. **A08**, after A05/A07, owns actual benefit-enabled render/submit; no harmless stock-sync reconfirm loop.

**CP-A2 (A06–A08):** admin write/auth, selected gift revalidation, exact paid/gift/money POS readback and feature-OFF rollback; without external proof A08 **blocked**.

**CP-A3 (A09–A10):** bounded read-only upsell, idempotent add-one, never reduced existing benefits; optional default OFF.

**CP-B1 (B01–B03):** atomic curated order and OFF-editorial / ON-empty / ON-curated release independent of legacy listing order.

**CP-B2 (B04–B07):** bounded feature-level acceptance for featured items, related fallback, guide media, search; admin/shop scope/security.

**CP-B3/B4 (B08–B11):** explicit human decisions; optional taxonomy/image proxy remain skipped if not justified and approved.

**CP-C (C01–C05):** C02 filter UX independent of B07; C05 optional overlay requires B07; C03 drawer optional; C04 checkout quote UX requires A08 not C03. Verify no-JS, keyboard/axe/mobile 390×844, tablet 768px and desktop 1440px.

**CP-R (R00 repeated):** exact-head tests, migrations, security, observability, feature-OFF compatibility, rollback and owner activation approval for every enabled slice.

## 6. Principal risks and decisions pending approval

| Risk | Stop condition or mitigation |
| --- | --- |
| Pancake drops/merges 0-VND or repeated variation rows | Controlled create **and readback** proof required for that case; otherwise gate remains OFF |
| Legacy laq1 cannot distinguish same-SKU roles | Explicit role+lineId and laq2 format; never reinterpret legacy proof/history |
| Ledger unique order+variant permits only one hold | Sum paid and gift demand before existing locked reservation; prove concurrency/handoff |
| Gift discounts make free shipping appear/disappear incorrectly | Frozen pre-A1 eligible basis; shipping after benefits with whole-cart paid quantity |
| Migration breaks old orders/writers | Additive schema first; compatibility and rollback tests with flags OFF |
| Admin or suggestion leaks tenant/product state | Server authorization and shop scope; bounded inputs, queries and trusted projections |
| B1 becomes second search/price owner | Only manual order differs; route consumes shop price/stock/card authority |
| B3/B6 over-generalize the kit | B08/B10 decision gates before code; may be skipped |
| C client code recalculates purchase values | Use routes/headless and server facts; keyboard/browser/accessibility checks |

**Not pre-decided:** A1 stacking and tier semantics beyond normative frozen bases, POS line support, additive migration shape, new category tree, delivery proxy, brand copy/layout and production enablement. Record owner approval in child spec/ADR before applicable /build.

## 7. Verification commands and runtime gates

Use the actual `package.json` and the pinned runtime at implementation time; no new install/test runner invented.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm prisma:validate
pnpm prisma:generate
pnpm lint
pnpm typecheck
pnpm test:domain
pnpm test
pnpm test:db
pnpm build
pnpm release:check
```

Pure contracts: `tests/domain/*.test.ts` (RED/GREEN). Database/migrations/concurrency: `tests/database/*.test.ts` (especially capacity/quote/order). Pancake: existing `tests/integrations/*` plus controlled actual readback. UI: `tests/a11y-runtime/*` and browser keyboard/axe/regression. Next.js/Prisma/Better Auth integration must use current official/version-specific source docs when implementation begins. Each implementation PR must meet the task acceptance **and** the project's full Definition of Done, with exact-head CI and operational rollback.

**Verification for this /plan PR:** source/test paths for all 13 capability rows in §2 checked against the pinned Git tree and relevant source/tests inspected; verify unique task IDs, dependencies and both Markdown files against the final GitHub-only diff. Do **not** claim local application tests/build/browser runs for docs-only edits.

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
| A08 | Prove POS create/readback parity and complete gated A1 | A03, A04, A05, A06, A07 | External POS acceptance; default OFF |
| A09 | Build bounded read-only promotion upsell evaluator | A05, A08 | Optional/default OFF |
| B01 | Persist curated new-arrivals membership and order | F00 | Required for B1 |
| B02 | Expose admin-only arrivals curator | B01 | Admin auth review |
| B03 | Add ON/OFF curated arrivals read model | B01, B02 | Route/SEO parity |
| B04 | Curate homepage featured products without copying collections | F00 | Gap/audit first |
| B05 | Add optional related-products editorial override | F00 | Fallback must be reviewed |
| B06 | Add optional trusted media for configured size guides | F00 | Optional/default OFF |
| B07 | Add bounded search suggestion read model | F00 | Independent |
| B08 | Decide category taxonomy versus current collections | F00 | Owner/architecture gate |
| B09 | Implement category identity and membership if approved | B08 | Conditional: only when B08 approves |
| B10 | Measure whether trusted image proxy is justified | F00 | Security/performance evidence gate |
| B11 | Implement bounded image endpoint only if approved | B10 | Conditional: only when B10 approves |
| C01 | Extract portable PDP/mobile selection interaction models | F00 | Independent |
| C02 | Add headless PLP filter interaction | F00 | Canonical discovery; no B07 |
| C03 | Add optional accessible headless cart drawer | F00 | Independent |
| A10 | Implement safe upsell add-one and checkout adapter | A09 | Canonical cart mutation; no C03 |
| C04 | Wire gift reminder and checkout role-lines only after A1 | A08 | Canonical quote; no C03 |
| C05 | Add optional search overlay after bounded suggestions | B07 | Optional/default OFF |
| R00 | Repeat quality/rollback verification for each enabled slice | F00 | Every implementation PR |

### F00: Revalidate audited matrix and ownership at implementation SHA

**Intent:** The initial 13-capability gap matrix, verified code/test paths and KEEP/ADAPT/REBUILD/SKIP decisions are **already delivered in `2** for this /plan PR. At each /build SHA, compare that review baseline against current code/test owners, record drift and resolve any contract-breaking differences before applying implementation tasks. This is not another postponed initial audit.

**Dependencies:** None. **Gate:** Revalidation gate; approve the matrix **now** while reviewing this plan.

**Acceptance:**
- [ ] Compare every existing matrix row against the chosen implementation SHA; update only changed source paths, tests and reuse decisions with evidence.
- [ ] Pin the new SHA and reviewer acknowledgement, with no parallel pricing, stock, checkout, collection or URL authority introduced.

**Verification (future implementation, not this PR):**
- [ ] Review current tree and owner modules versus `2; run relevant focused characterization tests only when required, recording their real exact-head CI evidence.

**Likely touched/reviewed files** (not exact diff promises):
- `tasks/core-kit-reusable-a-b-c-v1-plan.md` (`2 baseline matrix)
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

### A08: Prove POS create/readback parity and complete gated A1

**Intent:** After A05 canonical eligibility and A07 gift selection exist, connect the **real buyer** benefit-aware render/quote, checkout DRAFT/submit and accepted order to A04's OFF-only adapters and the existing Pancake gateway. Only vendor-evidenced role combinations may be enabled; preserve exact quantities, totals and idempotency.

**Dependencies:** A03, A04, A05, A06, A07. **Gate:** External POS acceptance; default OFF.

**Acceptance:**
- [ ] Controlled readback proves all accepted paid+gift rows and money; unsupported formats remain OFF and fail closed.
- [ ] Proof, immutable snapshot, locked holds, Pancake mapping and retry outcome remain consistent.

**Verification (future implementation, not this PR):**
- [ ] Approved Pancake live/test-environment readback; `pnpm test:db` order/capacity and existing integration tests.

**Likely touched/reviewed files** (not exact diff promises):
- `src/commerce/pancake-order-submit.ts`
- `src/integrations/pancake/order-create.ts`
- `tests/database/pancake-order-capacity.test.ts`
- `tests/integrations/pancake-order-create.test.ts` (proposed)

### A09: Build bounded read-only promotion upsell evaluator

**Intent:** Simulate a server-owned cart +1 through the canonical A1 quote and capacity advisory; bound query/simulation cost, latency and product count.

**Dependencies:** A05, A08. **Gate:** Optional/default OFF.

**Acceptance:**
- [ ] Suggest only a proved increment that does not lose existing grants; no viable candidate/timeout yields no offer.
- [ ] No simulation mutates cart, order, reserve ledger or pricing facts; shop scope and no-client-price rules hold.

**Verification (future implementation, not this PR):**
- [ ] `pnpm test:domain` upsell proof/timeout/bounds and `pnpm test:db` candidate visibility.

**Likely touched/reviewed files** (not exact diff promises):
- `src/commerce/promotion-upsell.ts` (new)
- `src/commerce/promotion-upsell-policy.ts` (new)
- `tests/domain/promotion-upsell.test.ts` (new)

### B01: Persist curated new-arrivals membership and order

**Intent:** Persist stable website-owned ordered product selection, independent of ProductMirror.createdAt, collections and shop sort.

**Dependencies:** F00. **Gate:** Required for B1.

**Acceptance:**
- [ ] Atomic bounded add/remove/reorder; empty set is durable and never inferred from mirrored creation date.
- [ ] Pancake sync cannot overwrite ordered selection; old writer/migration compatibility proven.

**Verification (future implementation, not this PR):**
- [ ] `pnpm prisma:validate`, `pnpm test:db` curation/reorder/concurrency.

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

**Dependencies:** B01, B02. **Gate:** Route/SEO parity.

**Acceptance:**
- [ ] OFF keeps current empty/editorial page; ON+empty renders no product cards; ON+selection keeps saved valid order without fallback.
- [ ] Published/valid products link to canonical PDP; hidden/stale entries skipped; shop filtering and ranking unchanged.

**Verification (future implementation, not this PR):**
- [ ] `pnpm test:domain` route-boundary/manifest and `pnpm test:db` listing parity; browser a11y at 390/1440.

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

### B10: Measure whether trusted image proxy is justified

**Intent:** Compare current trusted media/Next image behavior to a specific verified delivery bottleneck before considering a request-fetching endpoint.

**Dependencies:** F00. **Gate:** Security/performance evidence gate.

**Acceptance:**
- [ ] Baseline numbers, alternatives, origin/redirect/SSRF and cache-key/CPU/bandwidth budgets documented.
- [ ] If existing responsive delivery suffices, B11 is SKIPPED without any code.

**Verification (future implementation, not this PR):**
- [ ] Comparable real-image measurement + security design review.

**Likely touched/reviewed files** (not exact diff promises):
- `docs/audits/image-delivery-decision.md` (proposed)
- `src/commerce/product-media.ts` (read)
- `next.config.ts` (read)

### B11: Implement bounded image endpoint only if approved

**Intent:** Create narrow verified-origin image delivery with URL, redirect, type, input/output byte, dimension, pixel, format and cache-key limits; never generic SSRF fetch.

**Dependencies:** B10. **Gate:** Conditional: only when B10 approves.

**Acceptance:**
- [ ] Malicious/unreviewed redirects, URLs, oversized content and unbounded variants fail safely.
- [ ] Measured actual improvement and feature-OFF fallback retain existing media correctness.

**Verification (future implementation, not this PR):**
- [ ] `pnpm test:domain` limits; HTTP security smoke; `pnpm build` and browser network check.

**Likely touched/reviewed files** (not exact diff promises):
- `src/commerce/product-image-delivery.ts` (new)
- `src/app/api/product-image/route.ts` (proposed)
- `tests/domain/product-image-delivery.test.ts` (new)

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

### A10: Implement safe upsell add-one and checkout adapter

**Intent:** Revalidate a server-proven A09 opportunity through the **existing canonical cart mutation** in `src/commerce/storefront-cart-actions.ts`, ensuring an idempotent add-one transition and refreshed checkout quote. A checkout upsell adapter may render this offer **without** the optional C03 cart drawer; only a future drawer-specific adapter needs C03.

**Dependencies:** A09. **Gate:** Optional/default OFF; canonical cart and quote owners already exist.

**Acceptance:**
- [ ] Stale upsell cannot submit old proof or silently change buyer money; double click/retry adds only the intended unit.
- [ ] Upsell feature OFF preserves legacy cart/checkout; enabled mutations use server-owned prices and refreshed proof, with no C03 requirement.

**Verification (future implementation, not this PR):**
- [ ] `pnpm test:domain` upsell action and `pnpm test:db` cart concurrency plus checkout browser/a11y.

**Likely touched/reviewed files** (not exact diff promises):
- `src/commerce/storefront-cart-actions.ts`
- `src/commerce/promotion-upsell-actions.ts` (new)
- `src/components/commerce/checkout-upsell.tsx` (new)
- `tests/domain/promotion-upsell-actions.test.ts` (new)

### C04: Wire gift reminder and checkout role-lines only after A1

**Intent:** Use A08's canonical benefit quote and existing `src/routes/checkout-model.ts` to render paid/gift/discount/stock/total facts at checkout. Preserve recipient/address across quote reconfirmation. **Do not depend on C03**: an optional drawer adapter may separately reuse the model only if its UI actually includes a drawer.

**Dependencies:** A08. **Gate:** Approved A1 POS acceptance and canonical checkout read model, not cart drawer.

**Acceptance:**
- [ ] A1 OFF shows current checkout. A1 ON shows server-proven distinct paid/gift rows and total before final submit.
- [ ] Stale gift/amount returns safe focused recovery, keeping customer form input; unsupported POS combinations remain OFF.

**Verification (future implementation, not this PR):**
- [ ] `pnpm test:domain` checkout model and `tests/a11y-runtime/checkout.spec.ts` plus role/keyboard tests.

**Likely touched/reviewed files** (not exact diff promises):
- `src/components/headless/checkout-gift-reminder-model.ts` (new)
- `src/components/brand/guest-checkout-form.tsx`
- `src/routes/checkout-model.ts`
- `tests/domain/checkout-gift-reminder.test.ts` (new)

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

### R00: Repeat quality/rollback verification for each enabled slice

**Intent:** Record exact SHA, versioned compatibility, migration status, enabled/disabled behavior, security, telemetry and rollback after each slice; do not treat merged docs as implementation.

**Dependencies:** F00. **Gate:** Every implementation PR.

**Acceptance:**
- [ ] Each released capability has real tests/build/CI/runtime evidence and a reversible enablement plan.
- [ ] No unverified POS case, unauthorized admin operation or category/proxy decision is enabled.

**Verification (future implementation, not this PR):**
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:db`, `pnpm build`, `pnpm release:check` and relevant browser/runtime.

**Likely touched/reviewed files** (not exact diff promises):
- `docs/operations/release-and-rollback.md`
- `docs/verification/core-kit-a-b-c-slice-record.md` (proposed)
- `tasks/core-kit-reusable-a-b-c-v1-todo.md`

## 9. Handoff and merge discipline

1. Review/approve this plan separately from the already merged umbrella spec.
2. This /plan already contains the source/test/reuse matrix in §2. Before /build, F00 **revalidates** it at the implementation SHA, then F01 gates owner-approved A child contracts; no migration or POS write is authorized by this plan.
3. Split by one reviewed semantic capability. ADR 0005 governs changed-line scope; tests, migrations and rollback must accompany the behavior they prove.
4. Link task ID, parent spec section, exact base/head SHA and verification in each implementation PR. Do not infer implementation completion from merged documentation.
5. Ship and enable only the slices whose dependencies and external/production evidence are fulfilled. Deferred B3/B6 work stays deferred until separately approved.
