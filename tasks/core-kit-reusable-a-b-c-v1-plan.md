# Core Kit reusable capabilities A/B/C — Implementation Plan v1

Status: **PROPOSED — PLAN ONLY**. This planning PR cannot authorize application code, migrations, production feature flags, external POS writes or launch.
Planning base: `storefront-core-kit/main@1f71d610387f1e000c89bc11732a79426fa0dfb8` (Spec PR #26 merged).
Normative source: [A/B/C umbrella spec](../docs/specs/core-kit-reusable-capabilities-a-b-c-v1.md).
Additional current authorities: [production hardening](../docs/specs/core-kit-production-hardening-v1.md), [selling modes](../docs/specs/core-kit-selling-modes-v1.md), [promotion and flash sale](../docs/specs/promotions-flash-sale-v1.md).
Companion execution tracker: [A/B/C checklist](./core-kit-reusable-a-b-c-v1-todo.md).

## 1. Goal and review boundaries

Transfer brand-reusable commerce (A), merchandising (B) and headless interactions (C) demonstrated in La.Na without transferring its brand/style/category paths, preorder 15-day policy, owner thresholds or unverified Pancake behavior. Keep Core Kit's existing money, capacity, route shell, auth, media trust and listing URL authorities. New capabilities default OFF and are delivered as small vertical, separately reviewable slices.

**Do not overwrite** `tasks/plan.md` and `tasks/todo.md`: they already own LA Clothing Productization V2. Feature-named plans/todos are the existing repository convention. Tasks should fit one focused session where feasible; PR splitting follows [ADR 0005](../docs/decisions/0005-pr-scope-reviewability.md): atomicity/effective changed lines/test cohesion, **not** a mandatory 5-file threshold. Do not split code from the tests that prove it.

## 2. Verified starting facts and provisional gap map

Base paths inspected at the exact planning SHA. F00 must pin detailed function/test ownership and resolve provisional classifications before build.

| Feature | Existing Core Kit ownership / gap | Classification |
| --- | --- | --- |
| A1 Gift/Tier | `promotion-pricing.ts` only PROMOTION/FLASH_SALE; legacy `checkout-quote.ts` rejects 0 price + repeated variation IDs | **MISSING** benefit, reuse current pricing/checkout |
| A2 Upsell | Cart/quote exist, no upsell resolver | **MISSING**, only after A1 |
| A3 Inventory | `capacity-resources.ts` + locked `capacity-reservation-repository.ts` + selling modes | **EXISTS core / PARTIAL gifts**: preserve ledger, aggregate demand |
| A4 Checkout quote | `checkout-quote-proof.ts` is `laq1`; immutable order snapshots and guest checkout exist | **PARTIAL for benefit roles**, add versioned laq2 |
| B1 New Arrivals | `src/routes/new-arrivals.ts` intentionally returns an empty editorial model | **MISSING curated listing**, new flagged read model |
| B2 Merchandising | `ProductContent`, `CollectionDefinition`, homepage automatic discovery and collection-derived related products | **PARTIAL**; add only missing website curation |
| B3 Categories | Collections and canonical `storefront-discovery.ts` exist | **DECISION**, do not copy La.Na taxonomy |
| B4 Size-guide media | `src/brand/size-guide.config.ts` text/measurements | **PARTIAL**, optional trusted artwork |
| B5 Search suggestions | Existing canonical shop/search route | **PARTIAL**, add bounded suggestions not new URL/price owner |
| B6 Images | `product-media.ts` and existing trusted media delivery | **CONDITIONAL** on measured problem |
| C1 PDP | Headless variant selection and gallery behavior already exist | **PARTIAL**, add only missing mobile behavior |
| C2 PLP | `storefront-discovery.ts`, `shop-model.ts`, no-JS GET filter form exist | **PARTIAL**, add optional interaction models |
| C3 Cart UX | Authoritative cart/checkout read model; no shared drawer model | **PARTIAL**, optional drawer and gated gift UI |

## 3. Dependency graph and execution order

```text
F00 exact SHA inventory → F01 owner decisions + POS evidence matrix
    F01 → A01 lineId/PAID-GIFT/laq2 → A02 additive history → A03 aggregated locked capacity → A04 v2 render/submit
    F01 → A05 campaign eligibility/paid-only shipping → A06 campaign lifecycle → A07 selected gifts
    [A03, A04, A06, A07, accepted POS evidence] → A08 POS/order parity
    A08 → A09 bounded read-only upsell → A10 add-one mutation (+ C03 drawer)

F00 → B01 curator persistence → B02 admin → B03 new-arrivals ON/OFF read model
F00 → B04 homepage featured; B05 related override; B06 guide images; B07 suggestions
F00 → B08 category decision → B09 only if approved
F00 → B10 image delivery measurement → B11 only if approved

F00 → C01 mobile PDP; F00 → C03 cart drawer
[F00, B07] → C02 PLP + search overlay
[A08, C03] → C04 checkout gift UI

R00 = repeatable quality/release gate for each slice (not one final mega-PR).
```

B01–B07, C01/C03 can run independently of the A money path after F00. B08/B10 are research/owner decisions, **not approval** for B09/B11. A10 must follow C03; C04 must follow A08. Shared schema, proof, flag and pricing changes require contract coordination before parallel writes.

## 4. Non-negotiable interfaces and behavior

- **Gift lines:** `PAID X×1 + GIFT X×1` is two distinct `lineId`+role lines (0-VND only for GIFT), not duplicate paid CartItem rows; laq1 remains legacy-only, laq2 signs full quote/entitlement. Historic orders without v2 fields remain readable.
- **Capacity:** existing `@@unique([orderId, variantId])` reservation stays the default; paid+gift same SKU demands a single locked reservation of **quantity 2**, including composite expansion, idempotent retry and SYNC_UNKNOWN mirror handoff.
- **Thresholds:** `Q_paid_eligible(campaign)` and `S_basis(campaign)` are scoped/frozen per campaign **before A1 discounts**. Shipping uses whole-cart paid `Q_paid_cart` and post-benefit `S_final_paid`; the current policy is strict `S_final_paid > freeShippingSubtotalVnd` OR `Q_paid_cart >= freeShippingMinQuantity`. No gift/unit fallback, quantity-0 shipping invocation, post-tier eligibility oscillation or browser-owned money.
- **New Arrivals:** default flag OFF preserves editorial-only route with no list queries; ON+empty stays empty; ON+published selection renders manually ordered cards using existing catalog/price/availability and canonical PDP URLs, not a second shop filter/sort.
- **Safety:** server-authorized admin writes, bounded data/quotes/queries, trusted sources, no La.Na-specific brand/theme, no shadow price or capacity engine, no vendor readback claims without controlled proof.
- **Optional:** B3 taxonomy and B6 image proxy are conditional. Default OFF remains in place for A1/A2 and other behavior changes.

## 5. Checkpoints (stop/go between small batches)

**CP0 (F00–F01):** Reviewed gap matrix and narrow A child spec, owner stacking decision, POS acceptance matrix; unknown vendor case => OFF.

**CP-A0 (A01–A03):** v2 role identity/history + locked demand, same-SKU stock2 passes/stock1 refuses, concurrency and legacy readers.

**CP-A1 (A04–A05):** correct laq1/laq2 authorization, no harmless stock-sync reconfirm loop, frozen campaign thresholds and mixed-cart/no-eligible free-shipping tests.

**CP-A2 (A06–A08):** admin write/auth, selected gift revalidation, exact paid/gift/money POS readback and feature-OFF rollback; without external proof A08 **blocked**.

**CP-A3 (A09–A10):** bounded read-only upsell, idempotent add-one, never reduced existing benefits; optional default OFF.

**CP-B1 (B01–B03):** atomic curated order and OFF-editorial / ON-empty / ON-curated release independent of legacy listing order.

**CP-B2 (B04–B07):** bounded feature-level acceptance for featured items, related fallback, guide media, search; admin/shop scope/security.

**CP-B3/B4 (B08–B11):** explicit human decisions; optional taxonomy/image proxy remain skipped if not justified and approved.

**CP-C (C01–C04):** headless authority, no-JS route fallback, keyboard/axe/mobile 390×844, tablet 768px and desktop 1440px; C04 only after A08.

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

**Verification for this /plan PR:** inspect two Markdown files, spec references, unique task IDs, dependency graph and GitHub-only diff. Do **not** claim application tests were run locally for documentation edits.

## 8. Detailed tasks (dependency-ordered)

| ID | Work item | Dependencies | Gate |
| --- | --- | --- | --- |
| F00 | Audit exact-main gaps and ownership | — | Required |
| F01 | Approve child contracts and POS evidence matrix | F00 | Human / external evidence gate |
| A01 | Design/test v2 role lines and laq2 proof | F01 | Approved A contract |
| A02 | Add immutable benefit order persistence | A01 | Migration review |
| A03 | Aggregate gift and paid stock through existing locks | A01, A02 | Capacity safety gate |
| A04 | Integrate versioned render, proof and order snapshot | A01, A02, A03 | Checkout correctness gate |
| A05 | Implement pure paid-only tier eligibility and shipping basis | F01 | Stacking must be approved |
| A06 | Add benefit campaign admin lifecycle and persistence | A05, F01 | Admin/schema approval |
| A07 | Persist selected gift state and enforce fresh entitlement | A01, A05, A06 | Approved gift choice contract |
| A08 | Prove POS create/readback parity and complete gated A1 | A03, A04, A06, A07 | External POS acceptance; default OFF |
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
| C02 | Expose headless PLP filters and optional search overlay | F00, B07 | Depends on bounded search model |
| C03 | Add optional accessible headless cart drawer | F00 | Independent |
| A10 | Implement safe upsell add-one transition and optional adapter | A09, C03 | Optional/default OFF |
| C04 | Wire gift reminder and checkout role-lines only after A1 | C03, A08 | Gated by A1 vendor proof |
| R00 | Repeat quality/rollback verification for each enabled slice | F00 | Every implementation PR |

### F00: Audit exact-main gaps and ownership

**Intent:** Pin source SHA and classify every A/B/C capability as EXISTS/PARTIAL/MISSING/BRAND-ONLY plus KEEP/ADAPT/REBUILD/SKIP; cite code and tests rather than names alone.

**Dependencies:** None. **Gate:** Required.

**Acceptance:**
- [ ] Every gap has an exact source and test path, a real owner, and a justified reuse decision.
- [ ] No second checkout, pricing, stock, discovery or collection authority is planned.

**Verification (future implementation, not this PR):**
- [ ] Source review and baseline `pnpm test:domain`; documented reviewer sign-off.

**Likely touched/reviewed files** (not exact diff promises):
- `docs/audits/core-kit-a-b-c-gap-matrix.md` (new)
- `docs/specs/core-kit-reusable-capabilities-a-b-c-v1.md` (read)
- `tests/domain/route-boundary.test.ts` (read)

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

### A04: Integrate versioned render, proof and order snapshot

**Intent:** Use server quote authority in render, draft snapshot and submit; reconfirm only when quote, grantability or paid/gift line facts materially change, not a harmless stock sync.

**Dependencies:** A01, A02, A03. **Gate:** Checkout correctness gate.

**Acceptance:**
- [ ] Current legacy laq1 continues unchanged; laq2 required for any benefit line, with role and total parity.
- [ ] Stock-only synchronization never creates an unnecessary reconfirmation loop; reservation still rejects insufficient stock under lock.

**Verification (future implementation, not this PR):**
- [ ] `pnpm test:domain` quote/proof and `pnpm test:db` checkout p9a/snapshot suites.

**Likely touched/reviewed files** (not exact diff promises):
- `src/commerce/guest-checkout-snapshot.ts`
- `src/commerce/guest-checkout-submit.ts`
- `tests/database/guest-checkout-p9a-quote-proof.test.ts`
- `tests/domain/checkout-quote.test.ts`

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

**Intent:** Only for cases approved by vendor evidence, send role-correct lines through the existing Pancake gateway, preserving exact quantities/totals and order-state idempotency.

**Dependencies:** A03, A04, A06, A07. **Gate:** External POS acceptance; default OFF.

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

### C02: Expose headless PLP filters and optional search overlay

**Intent:** Consume storefront-discovery/shop-model canonical filter/sort hrefs; add only reusable focus/disclosure/active-count and suggestion interaction state.

**Dependencies:** F00, B07. **Gate:** Depends on bounded search model.

**Acceptance:**
- [ ] Applying/removing filter preserves others and resets pagination; GET/no-JS search remains correct.
- [ ] Mobile drawer focus return, aria-live empty/loading/error and keyboard access proven.

**Verification (future implementation, not this PR):**
- [ ] `pnpm test:domain` discovery + filter model, `tests/a11y-runtime/discovery.spec.ts`.

**Likely touched/reviewed files** (not exact diff promises):
- `src/components/headless/plp-filter-model.ts` (new)
- `src/components/headless/search-overlay-model.ts` (new)
- `src/routes/shop-model.ts` (reuse)
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

### A10: Implement safe upsell add-one transition and optional adapter

**Intent:** Revalidate proposed benefit at cart mutation, make duplicate click idempotent, refresh quote and consume server offer facts for UI.

**Dependencies:** A09, C03. **Gate:** Optional/default OFF.

**Acceptance:**
- [ ] Stale upsell cannot submit old proof or silently change money; at most one intended unit is added.
- [ ] Flag OFF retains current cart and checkout; enabled case goes through the same server canonical pricing.

**Verification (future implementation, not this PR):**
- [ ] `pnpm test:domain` upsell action + `pnpm test:db` cart mutation; checkout browser/a11y.

**Likely touched/reviewed files** (not exact diff promises):
- `src/commerce/storefront-cart-actions.ts`
- `src/commerce/promotion-upsell-actions.ts` (new)
- `src/components/commerce/checkout-upsell.tsx` (new)
- `tests/domain/promotion-upsell-actions.test.ts` (new)

### C04: Wire gift reminder and checkout role-lines only after A1

**Intent:** Render only canonical paid/gift/discount/stock/total facts from server; preserve recipient/address across quote reconfirmation and avoid client recalculation.

**Dependencies:** C03, A08. **Gate:** Gated by A1 vendor proof.

**Acceptance:**
- [ ] OFF presents existing checkout; ON shows correct separate gift/paid lines and total before submit.
- [ ] Stale selection/amount triggers safe recovery with focus and data intact; unsupported POS benefit case remains OFF.

**Verification (future implementation, not this PR):**
- [ ] `pnpm test:domain` checkout model + `tests/a11y-runtime/checkout.spec.ts`.

**Likely touched/reviewed files** (not exact diff promises):
- `src/components/headless/checkout-gift-reminder-model.ts` (new)
- `src/components/brand/guest-checkout-form.tsx`
- `src/routes/checkout-model.ts`
- `tests/domain/checkout-gift-reminder.test.ts` (new)

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
2. Begin with F00 source audit and F01 owner-approved A child contracts; do not perform a migration or POS write from this /plan PR.
3. Split by one reviewed semantic capability. ADR 0005 governs changed-line scope; tests, migrations and rollback must accompany the behavior they prove.
4. Link task ID, parent spec section, exact base/head SHA and verification in each implementation PR. Do not infer implementation completion from merged documentation.
5. Ship and enable only the slices whose dependencies and external/production evidence are fulfilled. Deferred B3/B6 work stays deferred until separately approved.
