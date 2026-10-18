# Core Kit reusable capabilities A/B/C — Execution checklist v1

Status: **PROPOSED / NOT STARTED**. This plan-only PR creates no features. Check boxes only after actual implementation and exact-head verification.

Planning base: `main@1f71d610387f1e000c89bc11732a79426fa0dfb8`; spec: [A/B/C umbrella spec](../docs/specs/core-kit-reusable-capabilities-a-b-c-v1.md); tasks: [detailed plan](./core-kit-reusable-a-b-c-v1-plan.md).

## Approval and evidence gates (all unchecked by default)

- [ ] G0 F00 exact source gap inventory reviewed.
- [ ] G1 F01 child spec approved: stacking, role+lineId/laq2, paid quantities, order audit, capacity and rollback.
- [ ] G2 Controlled Pancake acceptance/readback proves 0-VND gift, same-variation PAID+GIFT and differently-priced PAID rows **for each enabled use case**, or case remains OFF.
- [ ] G3 Additive DB migration and old/new code coexistence approved.
- [ ] G4 Category/collections decision before B09 (otherwise SKIP).
- [ ] G5 Image proxy measurements/security decision before B11 (otherwise SKIP).
- [ ] G6 Human review + exact-head tests/runtime + release gate before enabling any new capability.

## Dependency-ordered task checklist

- [ ] **F00 — Audit exact-main gaps and ownership** [Foundation; deps: none; Required]
  - [ ] Acceptance: Every gap has an exact source and test path, a real owner, and a justified reuse decision.
  - [ ] Verification: Source review and baseline `pnpm test:domain`; documented reviewer sign-off.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [ ] **F01 — Approve child contracts and POS evidence matrix** [Foundation; deps: F00; Human / external evidence gate]
  - [ ] Acceptance: Owner signs off on stacking/priority, paid/eligible/shipping bases, lineId, role, laq2 compatibility, reservation and rollback constraints.
  - [ ] Verification: Human design review plus controlled POS evidence plan; no API mutation in plan-only PR.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [ ] **A01 — Design/test v2 role lines and laq2 proof** [A; deps: F01; Approved A contract]
  - [ ] Acceptance: PAID X + GIFT X are distinct signed lines; invalid duplicate IDs/roles/prices fail closed.
  - [ ] Verification: `pnpm test:domain` quote/proof regressions, bounds, tamper and legacy vectors.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [ ] **A02 — Add immutable benefit order persistence** [A; deps: A01; Migration review]
  - [ ] Acceptance: Same-variation role lines round-trip with stable audit facts; legacy rows with no v2 data remain readable.
  - [ ] Verification: `pnpm prisma:validate` and `pnpm test:db` snapshot schema/rollback/legacy readback.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [ ] **A03 — Aggregate gift and paid stock through existing locks** [A; deps: A01, A02; Capacity safety gate]
  - [ ] Acceptance: PAID X×1 + GIFT X×1 holds quantity 2 in one order/variant reservation; stock 1 refuses all atomically.
  - [ ] Verification: `pnpm test:db` capacity-reservation/mirror-handoff/concurrency and `pnpm test:domain` capacity resources.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [ ] **A04 — Integrate versioned render, proof and order snapshot** [A; deps: A01, A02, A03; Checkout correctness gate]
  - [ ] Acceptance: Current legacy laq1 continues unchanged; laq2 required for any benefit line, with role and total parity.
  - [ ] Verification: `pnpm test:domain` quote/proof and `pnpm test:db` checkout p9a/snapshot suites.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [ ] **A05 — Implement pure paid-only tier eligibility and shipping basis** [A; deps: F01; Stacking must be approved]
  - [ ] Acceptance: A×1 eligible + B×2 ineligible => campaign count 1, shipping count 3; no eligible units => campaign 0 but shipping count positive.
  - [ ] Verification: `pnpm test:domain` benefit/guest-shipping-policy tests including all threshold boundaries.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [ ] **A06 — Add benefit campaign admin lifecycle and persistence** [A; deps: A05, F01; Admin/schema approval]
  - [ ] Acceptance: Non-admin or invalid campaign write fails closed; enabled conflicting rules resolve per approved contract.
  - [ ] Verification: `pnpm test:domain` admin validation/auth and `pnpm test:db` lifecycle/concurrency/migration.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [ ] **A07 — Persist selected gift state and enforce fresh entitlement** [A; deps: A01, A05, A06; Approved gift choice contract]
  - [ ] Acceptance: Stale/invalid selected gift blocks affected checkout without silent substitution or paid-cart corruption.
  - [ ] Verification: `pnpm test:domain` gift-choice validation and `pnpm test:db` concurrency/revalidation.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [ ] **A08 — Prove POS create/readback parity and complete gated A1** [A; deps: A03, A04, A06, A07; External POS acceptance; default OFF]
  - [ ] Acceptance: Controlled readback proves all accepted paid+gift rows and money; unsupported formats remain OFF and fail closed.
  - [ ] Verification: Approved Pancake live/test-environment readback; `pnpm test:db` order/capacity and existing integration tests.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [ ] **A09 — Build bounded read-only promotion upsell evaluator** [A; deps: A05, A08; Optional/default OFF]
  - [ ] Acceptance: Suggest only a proved increment that does not lose existing grants; no viable candidate/timeout yields no offer.
  - [ ] Verification: `pnpm test:domain` upsell proof/timeout/bounds and `pnpm test:db` candidate visibility.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [ ] **B01 — Persist curated new-arrivals membership and order** [B; deps: F00; Required for B1]
  - [ ] Acceptance: Atomic bounded add/remove/reorder; empty set is durable and never inferred from mirrored creation date.
  - [ ] Verification: `pnpm prisma:validate`, `pnpm test:db` curation/reorder/concurrency.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [ ] **B02 — Expose admin-only arrivals curator** [B; deps: B01; Admin auth review]
  - [ ] Acceptance: Only admins change selection, with reliable validation feedback and persisted ordering.
  - [ ] Verification: `pnpm test:domain` admin/auth and `pnpm test:db` writes; authenticated HTTP smoke.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [ ] **B03 — Add ON/OFF curated arrivals read model** [B; deps: B01, B02; Route/SEO parity]
  - [ ] Acceptance: OFF keeps current empty/editorial page; ON+empty renders no product cards; ON+selection keeps saved valid order without fallback.
  - [ ] Verification: `pnpm test:domain` route-boundary/manifest and `pnpm test:db` listing parity; browser a11y at 390/1440.
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

- [ ] **B07 — Add bounded search suggestion read model** [B; deps: F00; Independent]
  - [ ] Acceptance: Hidden/stale products omitted; suggestions count, input length, latency and DB query volume bounded.
  - [ ] Verification: `pnpm test:domain` discovery/search and `pnpm test:db` suggestions visibility/price tests.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [ ] **B08 — Decide category taxonomy versus current collections** [B; deps: F00; Owner/architecture gate]
  - [ ] Acceptance: Reviewed ADR chooses KEEP collections or ADD separate taxonomy, with exact ownership, keys, indexation and orphan rules.
  - [ ] Verification: Owner/SEO architecture review; inspect route manifest, sitemap and current collection tests.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [ ] **B09 — Implement category identity and membership if approved** [B; deps: B08; Conditional: only when B08 approves]
  - [ ] Acceptance: Taxonomy consistency enforced across config, route and sitemap; invalid or orphaned data fails closed.
  - [ ] Verification: `pnpm test:domain` taxonomy/SEO; `pnpm test:db` membership; indexation runtime.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [ ] **B10 — Measure whether trusted image proxy is justified** [B; deps: F00; Security/performance evidence gate]
  - [ ] Acceptance: Baseline numbers, alternatives, origin/redirect/SSRF and cache-key/CPU/bandwidth budgets documented.
  - [ ] Verification: Comparable real-image measurement + security design review.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [ ] **B11 — Implement bounded image endpoint only if approved** [B; deps: B10; Conditional: only when B10 approves]
  - [ ] Acceptance: Malicious/unreviewed redirects, URLs, oversized content and unbounded variants fail safely.
  - [ ] Verification: `pnpm test:domain` limits; HTTP security smoke; `pnpm build` and browser network check.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [ ] **C01 — Extract portable PDP/mobile selection interaction models** [C; deps: F00; Independent]
  - [ ] Acceptance: Selection/not chosen/out of stock/loading/preorder use existing business truth without parallel pricing.
  - [ ] Verification: `pnpm test:domain` PDP models and `tests/a11y-runtime/pdp-promotion.spec.ts`.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [ ] **C02 — Expose headless PLP filters and optional search overlay** [C; deps: F00, B07; Depends on bounded search model]
  - [ ] Acceptance: Applying/removing filter preserves others and resets pagination; GET/no-JS search remains correct.
  - [ ] Verification: `pnpm test:domain` discovery + filter model, `tests/a11y-runtime/discovery.spec.ts`.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [ ] **C03 — Add optional accessible headless cart drawer** [C; deps: F00; Independent]
  - [ ] Acceptance: Keyboard focus trap/restore and Escape work; stale/double mutations do not lose buyer data.
  - [ ] Verification: `pnpm test:domain` cart models + `tests/a11y-runtime/checkout.spec.ts` and mobile keyboard.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [ ] **A10 — Implement safe upsell add-one transition and optional adapter** [A; deps: A09, C03; Optional/default OFF]
  - [ ] Acceptance: Stale upsell cannot submit old proof or silently change money; at most one intended unit is added.
  - [ ] Verification: `pnpm test:domain` upsell action + `pnpm test:db` cart mutation; checkout browser/a11y.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [ ] **C04 — Wire gift reminder and checkout role-lines only after A1** [C; deps: C03, A08; Gated by A1 vendor proof]
  - [ ] Acceptance: OFF presents existing checkout; ON shows correct separate gift/paid lines and total before submit.
  - [ ] Verification: `pnpm test:domain` checkout model + `tests/a11y-runtime/checkout.spec.ts`.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

- [ ] **R00 — Repeat quality/rollback verification for each enabled slice** [Release; deps: F00; Every implementation PR]
  - [ ] Acceptance: Each released capability has real tests/build/CI/runtime evidence and a reversible enablement plan.
  - [ ] Verification: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:db`, `pnpm build`, `pnpm release:check` and relevant browser/runtime.
  - Evidence: PR #___ / head SHA ___ / CI or runtime evidence ___

## Batch checkpoints

- [ ] CP0: F00/F01 reviewed, no unapproved promotion/Pancake assumptions.
- [ ] CP-A0: A01/A02/A03 role proof/history and locked same-SKU resource correctness.
- [ ] CP-A1: A04/A05 checkout quote parity, no stock-only proof churn, campaign-eligible vs whole-cart shipping tests.
- [ ] CP-A2: A06/A07/A08 admin/gift/POS acceptance, feature OFF and compatibility.
- [ ] CP-A3: A09/A10 read-only proof + bounded idempotent upsell (optional).
- [ ] CP-B1: B01/B02/B03 curated manual ordering OFF/empty/ON route truth.
- [ ] CP-B2: B04/B05/B06/B07 independent merchandising and search gates.
- [ ] CP-B3: B08 decision and B09 optional-only implementation.
- [ ] CP-B4: B10 evidence and B11 optional-only implementation.
- [ ] CP-C: C01/C02/C03/C04 no duplicate money, keyboard/browser/a11y and brand discardability.
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
