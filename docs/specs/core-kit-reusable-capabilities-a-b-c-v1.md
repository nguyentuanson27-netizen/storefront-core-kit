# Spec — Core Kit reusable capabilities A / B / C v1

Status: **PROPOSED — spec-only PR; human review required before planning, migrations, implementation or enablement.**
Owner repository: **storefront-core-kit** (target: `main`).
Source of implementation evidence: **la.na_design_storefront** (not a policy or brand authority for Core Kit).
Written: 2026-10-18. This is an **umbrella capability spec**, not an approval to implement all capabilities in one PR.

## 1. Objective and success definition

**Goal:** make `storefront-core-kit` a stronger brand-reusable commerce foundation by selectively adopting the **portable capabilities** demonstrated in La.Na Design, without copying the La.Na brand, storefront composition, product policy, or unverified Pancake assumptions.

The three scope groups are:
- **A — Commerce Engine:** benefit promotions, verified upsell, compatibility with existing capacity/selling modes, and immutable checkout quote integrity.
- **B — Merchandising / Admin:** curated new arrivals, website-owned product merchandising, configurable category semantics, size-guide media, bounded search and trusted product-image delivery.
- **C — Headless Commerce UX:** portable interaction/state contracts for product detail, filtering/search and cart/checkout; brand visuals stay replaceable.

**Intended users:** (1) engineers forking Core Kit for a new brand, (2) store administrators configuring the resulting shop, and (3) shoppers whose price, stock, purchase and UI states must remain consistent.

**Product-level success:**
1. A new brand can use each adopted capability by configuration and/or an optional adapter, without importing La.Na copy, paths or owner decisions.
2. With new capability flags OFF, Core Kit's current cart, checkout, price, stock, routes, Merchant and order states retain their existing behavior.
3. With each capability ON, the same canonical server authority decides facts presented in storefront, cart, checkout, order snapshot and POS projection; invalid/unverified cases fail closed.
4. A brand can replace `src/app/**/page.tsx`, `src/app/globals.css` and `src/components/brand/**` without changing shared commerce or headless decisions.
5. Every accepted implementation slice has focused tests, database/browser checks as relevant, safe rollout/rollback and evidence. This spec PR itself is documentation only.

## 2. Current Core Kit baseline (do not rebuild what already exists)

The following were observed in Core Kit's `main` tree and code; implementation planning must **re-check at an exact commit SHA**:
- Central effective-price authority: `src/commerce/promotion-pricing.ts`; current campaign kinds are `PROMOTION` and `FLASH_SALE`. Multiple applicable legacy campaigns do **not** silently stack.
- Rendered checkout facts/proof and guest order lifecycle: `src/commerce/checkout-quote.ts`, `src/commerce/checkout-quote-proof.ts`, `src/commerce/guest-checkout-submit.ts`.
- Resource-based composite capacity, reservations and mirror handoff: `src/commerce/capacity-resources.ts`, `src/commerce/capacity-reservation-repository.ts`; governed by `docs/specs/core-kit-production-hardening-v1.md`.
- `STANDARD` / `OVERSELL` / `PREORDER` selling policy is already specified and implemented behind gates: `docs/specs/core-kit-selling-modes-v1.md`. Production PREORDER enablement remains subject to that spec's separate truth/evidence gate.
- Canonical listing URL parsing/building and route view models: `src/commerce/storefront-discovery.ts`, `src/routes/shop-model.ts`.
- Existing brand/headless/page boundary documented in `README.md` and checked by `tests/domain/route-boundary.test.ts`.
- Existing collections, product content, cart and admin flows must be inventoried before defining new persistence.

**Required first output of /plan:** a source-and-test gap matrix for each A/B/C item: `EXISTS / PARTIAL / MISSING / BRAND-ONLY` and `KEEP / ADAPT / REBUILD / SKIP`. Same filename does not establish behavioral equivalence. Do not fork a second authority when Core Kit already owns the invariant.

## 3. Scope map and adoption intent

| ID | Capability | Evidence in La.Na | Core Kit target / adoption stance |
| --- | --- | --- | --- |
| A1 | Gift item + quantity-tier benefits | `src/commerce/gift-quantity-*`, `cart-gift-selection.ts`, `benefit-checkout-quote.ts` | New opt-in benefit policy integrated with existing promotion, cart and checkout authorities; **ADAPT** |
| A2 | Smart checkout upsell | `src/commerce/promotion-upsell-*` | New opt-in read-only candidate/proof contract using A1 and canonical quote; **ADAPT** |
| A3 | Inventory/capacity convergence | `capacity-*`, `availability-*`, `pancake-inventory-signals.ts` | **KEEP existing** ledger/locks/selling floors; only add verified missing signals/rules; **GAP AUDIT + ADAPT** |
| A4 | Benefit-aware immutable order quote | `order-quote-snapshot.ts`, `order-quote-rules.ts`, `checkout-attempt-key.ts` | Extend current proof/snapshot rather than introducing a competing checkout; **ADAPT** |
| B1 | Manual new arrivals | `new-arrivals-selection.ts`, `new-arrivals-repository.ts` | Admin-owned curated ordering over existing `/new-arrivals` route; **ADAPT** |
| B2 | Website-owned merchandising | `merchandising-admin.ts`, `merchandising-repository.ts` | Homepage/category product order and related overrides where gaps are proven; **ADAPT** |
| B3 | Configurable category taxonomy | `category-taxonomy.ts`, `src/brand/category.config.ts` | Brand-config keys + optional persisted membership; only after category-vs-collection decision; **RE-DESIGN** |
| B4 | Admin size-guide artwork | `size-guide-media.ts` | Optional trusted image per brand-defined guide; existing tables remain the fallback; **ADAPT** |
| B5 | Bounded search + suggestions | `storefront-search-repository.ts`, `search-overlay-model.ts` | Extend canonical discovery, not create a second search URL/price authority; **ADAPT** |
| B6 | Product image delivery | `product-image-delivery.ts`, `integrations/pancake/product-image-*` | Optional reviewed image delivery with security/performance proof; **ADAPT ONLY IF NEEDED** |
| C1 | Mobile PDP headless behavior | `components/headless/*`, mobile-commerce UX spec | Gallery/selection/sticky purchase *behavior*, not La.Na visual layout; **ADAPT** |
| C2 | PLP filter/search interactions | `plp-filter-model.ts`, `search-overlay-model.ts` | Typed interaction models consuming Core Kit route/discovery URL authority; **ADAPT** |
| C3 | Cart drawer + checkout UX | `cart-drawer-model.ts`, `cart-summary-store.ts`, `checkout-gift-reminder-model.ts` | Reusable focus/state/summary contracts above existing cart/quote authority; **ADAPT** |

No item is a promise to copy a folder or all La.Na migrations. The Core Kit implementation and compatibility contract are authoritative.

## 4. Group A — Commerce Engine

### A1. Gift item and quantity-tier benefits

**Outcome:** a shop admin can configure reusable `GIFT_ITEM` and `QUANTITY_TIER` benefits, with quantity and/or order-subtotal thresholds, while the buyer gets exactly the benefit the server proves and the POS can represent.

**Minimum shared contract:**
- Admin-only lifecycle (draft, validate, preview, publish, disable); validate scope, limits, time, stacking and exclusion at the server boundary.
- Eligibility counts paid units only; gift units never contribute toward purchase thresholds. Product/variant identities and composite counting are explicit.
- One canonical deterministic pricing/entitlement pipeline owns campaign priority, conflicts, safe integer VND amounts and resulting line roles. Existing `PROMOTION` / `FLASH_SALE` behavior remains unchanged with A1 disabled.
- A gift is an entitlement/selection, **not** automatically an arbitrary substituted SKU. Persisted selection is revalidated against current stock/campaign before checkout; stale or impossible grants fail closed and lead to an explicit buyer recovery state.
- All selected gifts, paid discount steps, dropped benefits and totals must agree across rendered cart/checkout, order snapshot and the allowed Pancake submission format.
- Separate server-side feature gate, default **OFF**, independent of existing legacy promotion and selling-mode gates. No client input can enable it.

**Evidence gate:** before enabling any benefit that needs it, verify actual Pancake create/readback support for 0-VND gifts, paid+gift rows sharing a variation ID, and same-variation paid rows with different unit prices. La.Na's source contract is **not** evidence of acceptance for a new Core Kit deployment. If unsupported or unknown, do not send a lossy order; the applicable feature/subcase stays OFF pending an approved safe alternative.

**Acceptance examples:** two overlapping promotions resolve deterministically or refuse; quantity crossing a threshold changes a benefit exactly once; an unavailable chosen gift blocks that checkout without silent replacement; toggling A1 OFF preserves old orders, current prices and legacy checkout.

### A2. Smart promotion upsell

**Outcome:** optionally show a shopper **one provable** opportunity to add one eligible paid unit at checkout without losing existing benefits or entered checkout data.

- Candidate eligibility and ranking are server-owned, bounded and shop-scoped; no suggestion for a product already in the paid cart if that policy is selected for the Core Kit contract.
- Simulate `cart +1` **read-only** through A1 + canonical price/stock/quote authorities; never infer benefit from a progress bar or browser price.
- Offer only when a real incremental benefit is proven and previous applicable benefits remain valid; otherwise render no offer. Bound candidate count, quote simulations, time and cost.
- Recheck inventory/quote at mutation; reject stale intents, ensure idempotent cart mutation and refresh the displayed quote. No independent upsell pricing engine.
- Separate default-OFF gate; A2 may be ON only when A1 and its POS/evidence gates satisfy the chosen rule. Checkout without an offer behaves normally.

**Decision pending:** La.Na's quantity-near-1 and subtotal-near-80% thresholds are **shop decisions**, not Core Kit defaults. Choose configurable conditions and default behavior explicitly in a follow-up implementation spec.

### A3. Inventory, atomic capacity and selling-mode integration

**Outcome:** benefit/gift/upsell demand can never bypass Core Kit's current capacity authority.

- Reuse resource planning, deterministic locks, post-lock topology recheck, immutable reservation resources, `SYNC_UNKNOWN` hold, mirror handoff and existing mode-specific floor rules.
- Every **paid and granted gift** resource demand is accounted for atomically before POS create; partial holds or double counting are forbidden. The exact reservation extension is an ask-first schema/contract change.
- Mirror stock remains an external Pancake fact; never write local adjusted stock back into the mirror to "fix" capacity.
- Evaluate whether La.Na's inventory webhook/freshness signals address a concrete Core Kit gap; only add verified source data with safe stale/unknown handling. An unproven inventory signal is not permission to sell.
- Preserve current composite component floor 0, policy locking, accepted-order accounting and idempotency. Do not copy La.Na's different capacity schema over the Core Kit ledger.
- Do **not** port the La.Na-specific 15-day Vietnam preorder availability cycle or enable `PREORDER` by this spec.

**Acceptance examples:** two concurrent checkouts cannot consume the same last unit/gift; a composite consumes child capacity; retry/unknown outcome keeps holds safe; unchanged modes pass current DB parity tests.

### A4. Immutable benefit-aware checkout quote and order audit

**Outcome:** the buyer confirms the exact server-resolved paid items, gifts, discounts, shipping and final total sent to the POS, and that fact remains auditable after the order is accepted.

- Extend current checkout proof/version contract rather than issue a second incompatible proof. Invalidate proof when paid cart, gift choice, campaign/stock authority or computed money changes.
- Snapshot bounded quote facts/digest and each paid/gift line at an explicit safe order lifecycle boundary; final snapshots are immutable. Old legacy orders without new fields remain readable without fabricated data.
- Final POS projection and reconciled order totals must represent the same accepted quote or refuse submission; no browser-derived price, unsigned quote or post-submit "fix" to money.
- Use additive schema/backfill only when required; provide explicit old/new coexistence, downgrade/rollback and error semantics.

**Acceptance examples:** stale proof rejects with a refreshed **display-only** quote; tampering a line/discount fails validation; retry is idempotent; order/Pancake amount parity is asserted by DB/integration tests.

## 5. Group B — Merchandising and administration

### B1. Curated new arrivals
- Provide admin-only add/remove/reorder with server validation, maximum bounds, atomic writes and durable manual ordering.
- Keep published-product checks and effective-price rules from existing Core Kit listing. Hidden/unavailable products are omitted according to the approved listing contract.
- Empty manual selection is a legitimate **empty** state, not an implicit backfill from `createdAt`.
- Existing `/new-arrivals` behavior stays available until the curated mode is explicitly enabled/migrated. Brand owns customer-facing text and layout.

### B2. Website-owned merchandising
- Reuse existing `ProductContent` / `CollectionDefinition` responsibilities; do not duplicate collection editorial ownership.
- Provide shop-scoped admin operations for featured products, ordered category membership (if B3 approved) and related-product overrides, only where not already supported.
- Atomic membership/order writes, stable product IDs, deterministic ordering and protected admin authorization. Do not trust client-submitted category or product identities.
- A missing configuration yields a defined empty/fallback read model, **never** arbitrary merchandise presented as an administrator's curated decision.

### B3. Configurable category taxonomy (decision-gated)
- Preserve the distinction between editorial collections and navigable product categories. First decide if a separate taxonomy is required for the new-brand template; **do not** silently promote La.Na categories or overwrite collections.
- If approved: identity, labels, paths and hierarchy come from brand configuration; membership/order are website-owned data keyed by stable category key (not URL text).
- Validate duplicate keys/paths, hierarchy changes, orphaned membership and route/sitemap consistency. Any addition of dynamic category pages must respect Next.js route manifestation and existing SEO owners.
- Nothing may assume `/ao-dai`, `/set-do`, gender or a fixed number of category levels.

### B4. Size-guide media
- Optional per-guide artwork, selected from the brand's already-defined size-guide IDs; invalid guide/media URL rejected server-side.
- No artwork => existing text/table guide remains usable. Media is presentation, not an override of approved measurements.
- Admin write permission, safe URL policy and image failure/fallback tested.

### B5. Search and suggestion improvements
- Extend existing discovery parser/query builder and shop-scoped product repository; do not duplicate canonical URL/filter/pagination logic.
- Bounded query/input length, fixed result limits, predictable sort, safe empty/error/loading, and no non-indexable/hidden product leaks.
- Suggestions may expose product/category matches only from authorized published catalog facts. Displayed money uses the canonical effective-price read model, **not** arbitrary mirrored discount fields.
- Search overlay is optional UI; standard search route must remain functional without JavaScript.

### B6. Trusted product-image delivery (conditional)
- Keep existing media trust contract and responsive hero improvements unless a measured source-delivery need justifies a proxy/transcoding endpoint.
- If required, constrain accepted origin/host, redirects, content type, source/output bytes, pixels, dimensions, cache-key space and execution cost. No user-controlled arbitrary outbound fetch (SSRF).
- Preserve placeholder/fallback states, browser-supported formats and existing `next/image` correctness. Require comparative runtime measurements before claiming a performance improvement.

**Group B acceptance:** a fresh brand can configure products/categories/guides without La.Na data; unauthorized or malformed admin writes are rejected; empty/hidden states are deterministic; data persists after reload and migrations do not destroy current collection/content semantics.

## 6. Group C — Portable headless commerce UX

### C1. Product detail and mobile purchase
- Extract interaction state/typed contracts for swipe/gallery/lightbox, product/variant selection and mobile sticky CTA from La.Na patterns **only where Core Kit lacks them**.
- Existing `src/components/headless/variant-selection-model.ts` and `use-variant-selection.ts` remain canonical; never add a competing stock, price or eligibility resolver inside a brand component.
- Variant not-selected, unavailable, preorder (only when allowed by existing contract), loading and validation states are visually and accessibly distinct.
- New brand may implement its own photo ratio, typography, panel composition and breakpoint presentation. La.Na's 2:3 images/desktop gallery choreography are not Core Kit requirements.

### C2. Product-list filtering and search interactions
- Provide composable headless filter state/active-count/chips/disclosure behavior that consumes `src/commerce/storefront-discovery.ts` and route-model canonical links.
- Applying/removing any filter keeps other valid filters and resets page appropriately; sort/search share the same URL authority.
- Keyboard, focus restoration, accessible labels, mobile drawer state, loading/empty and no-JS navigation must work.
- Do not duplicate category pricing/search query semantics from Group B.

### C3. Cart drawer and checkout interactions
- Optional cart drawer/focus/return-focus behaviors with semantic controls, correct close/escape handling and usable mobile touch targets.
- Display cart quantities/discounts/gifts and checkout totals from server-resolved cart/quote, never from a second front-end money calculator.
- Add/remove/quantity and optional gift selection handle pending, error, retry, stale inventory, double click and quote refresh without losing recipient/address input.
- Checkout shows the confirmed order total before final submit; gift reminder/upsell UI only appears when its corresponding Group A server feature is enabled and proved.

**Group C acceptance:** at **390 × 844**, **768px** and **1440px**, core behaviors work in a default brand and in a changed presentation; no horizontal overflow or focus trap, and desktop behavior does not regress. Browser runtime/axe/keyboard verification is required for actual implementation, not for this docs-only PR.

## 7. Architecture, interfaces and security boundaries

- **Shared authorities:** `src/commerce` (money, eligibility, inventory, writes), `src/integrations` (Pancake/media boundaries), `src/routes` (read models and canonical URLs), `src/components/headless` (presentation-independent interactions). Admin actions require server-side authentication **and per-operation authorization**.
- **Replaceable:** `src/brand/*.config.ts`, `src/components/brand/**`, `src/app/**/page.tsx`, `src/app/globals.css`. No La.Na identity, colors, product copy, paths, owner-approved threshold or shipping/return policy in shared modules.
- **App boundary:** preserve Core Kit's existing allowed-import roots and `createStorefrontRoute`/route-shell checks; no new page-to-database or page-to-Pancake imports.
- **Contracts first:** define typed success/error and empty/loading/unavailable shapes, idempotency, versioned checkout proofs and backward-compatibility strategy before a dependent module is changed.
- **External inputs:** validate browser, admin, Pancake and image source data at trust boundaries; protect sessions, CSRF where applicable, pricing, resource authorization, SSRF and rate-limited endpoints. Never log secrets, customer PII or full order bodies.
- **Feature gates:** new behavioral features default OFF. When disabled, no new mutation/read prerequisite may break legacy checkout or existing storefront. Configure each gate server-side; document dependency between A1/A2 and relevant B/C presentation.
- **Persistence:** website-owned curated/editorial data is distinct from Pancake mirrors; new tables/columns are additive first, compatible with old writers, with explicit rollout and rollback. Do not replay La.Na migrations verbatim.
- **Performance:** bounded database queries, N+1 checks, bounded quote-simulation work and image-processing quotas. Any performance claim requires comparable before/after measurements.

## 8. Tech context, commands and code conventions

Current checked-in stack per Core Kit README/package: Next.js 16.2.11, React 19.2, TypeScript, Tailwind CSS v4, PostgreSQL + Prisma 7.9.1, Better Auth, Pancake POS, pnpm 11.4.0, Node.js >=22.14.

Use the repository's real scripts (revalidate against `package.json` at implementation time):

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm lint
pnpm typecheck
pnpm test
pnpm test:db
pnpm build
pnpm release:check
```

For new domain behavior use explicit, typed outcomes and a single owning resolver. Example **style only, not a frozen new API**:

```ts
type SelectionResult =
  | Readonly<{ ok: true; productIds: readonly string[] }>
  | Readonly<{ ok: false; reason: "INVALID_SELECTION" | "LIMIT_EXCEEDED" }>;
```

Use existing `tests/domain`, `tests/database`, `tests/integrations`, `tests/a11y-runtime` and existing CI/Playwright tooling. Changes to framework/dependency versions are separate work and require official version-specific documentation checks.

## 9. Delivery slices and verification gates (after spec approval)

**Dependency order:**
1. **P0 / foundation:** pin base SHA and complete gap matrix; reconcile `production-hardening`, `selling-modes`, current promotions and quote ownership. Resolve interface and POS contract decisions.
2. **A3 + A4 / integrity first:** prove any missing capacity integration and quote/snapshot extension in narrow, independently reversible slices.
3. **A1 / benefits:** admin rules -> read-only quote -> gift choice -> accepted order/POS path, each default-OFF until verified.
4. **A2 / upsell:** only after A1's canonical quote, inventory and accepted-order proof are stable.
5. **B1/B2/B4 and B5:** independently reviewable merchandising/search/guide slices; **B3** only after taxonomy decision; **B6** only after measured need/security review.
6. **C1/C2/C3:** headless models first, presentation adapter second, browser accessibility/responsive evidence last. C3 gift/upsell presentation depends on corresponding A contract.

**Definition of Done for each implementation PR:**
- Tests written for new behavior/edge cases, focused + relevant full test suites pass, lint/typecheck/build pass.
- DB concurrency/migration tests for stock, promotions, order snapshots and admin persistence; live Pancake acceptance or explicit **blocked** state for external assumptions.
- Feature OFF regression proven; enabled behavior tested; old orders and existing brand remain compatible.
- Browser/keyboard/axe checks for UI changes, including loading/error/empty and mobile/desktop regression.
- Security review, data ownership, telemetry for new critical writes, and documented rollout/rollback gate.
- Small scoped PRs, source links, explicit evidence and no unrelated refactor.

**Spec-only PR acceptance:** this PR adds one Markdown document, defines objective + A/B/C boundaries + non-goals + decisions + verification; it changes no schema, app code, env default or CI. Documentation review is the gate; running application tests is **not claimed** for a docs-only change.

## 10. Explicit non-goals and boundaries

**Do not:**
- Clone La.Na design, branding, hero treatments, 2:3 image rule, Vietnamese womenwear taxonomy, legal facts, owner policies or storefront routes.
- Enable `PREORDER` or port its owner-approved 15-day availability assumption; change selling-mode floors/reservation ownership as an unreviewed side effect.
- Introduce `CLEARANCE` solely because La.Na has it; Core Kit's current promotion kinds and contracts remain the default.
- Add Vertex/Google Flow Try-On, Meta CAPI, Zalo Ads, ChatGPT Ads, live chat widgets or unrelated advertising integrations in A/B/C scope (separate optional specs).
- Replace existing collections, route-shell, pricing, capacity or auth with a parallel framework; create a general-purpose rule builder or theme engine.
- Auto-accept unknown POS money/line formats; invent product stock, discounts, media provenance or historical order snapshots.
- Modify or deploy `la.na_design_storefront`, merge this PR automatically, or ship features as part of this spec PR.

**Ask first / separate reviewed follow-up spec before code:** new POS order-line format or capability; promotion stacking/business defaults; schema/migration changes; category taxonomy vs collections; new fetchable media proxy; auth/session changes; feature enablement in production.

## 11. Open review decisions (not silently filled in)

1. **A1:** which benefits and stacking combinations should Core Kit support by default, given legacy single-campaign conflict behavior? What POS proof is available per scenario?
2. **A2:** which configurable near-threshold/eligibility policy should be the template default? Keep La.Na's fixed 1-item/80% settings **out** until explicitly approved.
3. **A3/A4:** what verified integration gaps remain after baseline audit, and what is the smallest compatible snapshot/reservation extension? How will old orders and clients coexist?
4. **B2/B3:** should a fresh Core Kit brand get a distinct navigable category taxonomy, or can its current collections/filters meet the requirement? What is the owner of a category key and its routes?
5. **B6:** what measured product-image delivery problem cannot be solved by existing trusted media/Next.js facilities?
6. **C:** which interaction contracts should ship as optional headless primitives versus a default brand example? No brand-specific desktop/mobile composition is frozen here.

Any answer that changes a public interface, commerce semantics, schema or security boundary must be recorded in this spec (or an approved narrower child spec) **before implementation**.

## 12. Evidence and related authorities

**Core Kit (current contract):**
- [README — shared vs replaceable layer](../../README.md)
- [Production hardening v1](./core-kit-production-hardening-v1.md)
- [Selling modes v1](./core-kit-selling-modes-v1.md)
- [Promotions / Flash Sale v1](./promotions-flash-sale-v1.md)
- [Existing discovery](../../src/commerce/storefront-discovery.ts)
- [Existing checkout quote](../../src/commerce/checkout-quote.ts)

**La.Na (implementation evidence only; transfer by adaptation):**
- [Gift Quantity v1](https://github.com/nguyentuanson27-netizen/la.na_design_storefront/blob/main/docs/specs/gift-quantity-promotions-v1.md)
- [Smart Promotion Upsell v1](https://github.com/nguyentuanson27-netizen/la.na_design_storefront/blob/main/docs/specs/smart-promotion-upsell-v1.md)
- [Manual New Arrivals](https://github.com/nguyentuanson27-netizen/la.na_design_storefront/blob/main/docs/specs/manual-new-arrivals.md)
- [Merchandising persistence ADR](https://github.com/nguyentuanson27-netizen/la.na_design_storefront/blob/main/docs/decisions/0013-website-owned-merchandising-persistence.md)
- [Mobile commerce UX](https://github.com/nguyentuanson27-netizen/la.na_design_storefront/blob/main/docs/specs/storefront-mobile-commerce-ux.md)

**Precedence:** approved Core Kit code/specs and its versioned contracts outrank La.Na's owner-specific decisions. Conflicts are review questions, not permission to replace Core Kit behavior.
