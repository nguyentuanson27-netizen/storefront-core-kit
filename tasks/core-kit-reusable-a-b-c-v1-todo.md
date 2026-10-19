# Core Kit A/B/C — remaining port checklist (2026-10-19)

**Current scope:** Only transfer already-implemented La.Na functionality missing from Core Kit. See [short plan](./core-kit-reusable-a-b-c-v1-plan.md), [completed PR/CI evidence](../docs/verification/core-kit-a-b-c-slice-record.md) and [archived original PR #27 checklist](https://github.com/nguyentuanson27-netizen/storefront-core-kit/blob/5af3fb826e5838fcfff451f5370ce4fc02ed5fc1/tasks/core-kit-reusable-a-b-c-v1-todo.md). Checked **SKIPPED** decisions do not mean implementation was delivered.

## Gate disposition — no redundant tests

- [x] **G0/F00, G1/F01:** Original source matrix revalidated (#28); F01 technical review approved. No re-audit.
- [x] **G2 — La.Na source evidence recorded for porting:** [live create/readback](https://github.com/nguyentuanson27-netizen/la.na_design_storefront/blob/main/docs/integrations/pancake-gift-quantity-acceptance.md) passed the two relevant split-line cases on shop `715077776` (14–15 Oct 2026). [D-08](https://github.com/nguyentuanson27-netizen/la.na_design_storefront/blob/main/docs/decisions/0016-gift-quantity-promotions-v1-decisions.md) keeps gift **0 VND in the website** and sends **1,000 VND in Pancake**, offset from paid items. Direct POS 0-VND was **not tested** and is not required by D-08. **This is not target-shop certification or permission to turn A1 ON.**
- [x] **G3, G4, GB1:** Merged slices have recorded review/CI. Existing collections retained; B09 SKIPPED. Only review a new migration if an actual port diff introduces one.
- [x] **G5:** Resolved by SKIPPING B10/B11; Core Kit's existing media remains.
- [ ] **G6 — production activation only:** Separate owner go/no-go, target-shop risk/compatibility decision (Core Kit's P10 test shop `1635185058` differs from La.Na's), security, rollback, exact-head CI and required runtime checks. **Does not block an OFF-only port PR.**

## Open work (in order)

- [ ] **A08 — Port benefit checkout** from La.Na. Reuse existing Core Kit `laq2`, order snapshot, capacity locks and Pancake gateway; adapt La.Na's D-08 projection and readback/submit. No new POS format or benefit engine. Resolve known A06 correctness fixes ([PR #53](https://github.com/nguyentuanson27-netizen/storefront-core-kit/pull/53)) before relying on A06 for enabled checkout.
  - Acceptance: PAID/GIFT role and amount parity, preserved vendor total, safe unknown-write handling, correct reservations; legacy checkout unchanged with flag OFF.
  - Verification: existing affected Core Kit quote/order/capacity/adapter domain and DB tests + required exact-head CI; **no live Pancake probe**.
- [ ] **C04 — Port checkout gift picker and one-time reminder** after A08. Reuse La.Na's repair/reminder models and Core Kit's current single checkout form.
  - Acceptance: invalid gifts repairable without auto-selection; receiving fields retained on re-quote; valid server-owned totals; legacy OFF unchanged.
  - Verification: affected checkout/gift tests and a focused keyboard/browser/accessibility check + required exact-head CI.

## Out of scope / not blockers

- [x] **A09 SKIPPED for now:** current La.Na upsell is a read-only link to `/sale`; Core Kit has no matching `/sale` route. Do not invent one or silently substitute `/flash-sale`. Only reconsider if a semantically equivalent **existing** destination is available.
- [x] **A10 SKIPPED:** obsolete inline checkout add-one UI; La.Na owner decision OD-01/A replaced it.
- [x] **B09 SKIPPED:** existing collections remain authoritative.
- [x] **B10/B11 SKIPPED:** no image proxy, measurement programme or new endpoint.
- [ ] **C03b DEFERRED (optional):** La.Na already has quantity/removal in the drawer; no work unless separately selected, no dependency for A08/C04.

## Verification checklist per future code PR (not a new test project)

- [ ] Inspect pinned La.Na source and affected Core Kit owners; port only missing behaviour and keep flag OFF.
- [ ] Required exact-head Core Kit CI is green (including lint/typecheck/build). Reuse **relevant existing** domain/DB/UI tests for changed seams; add a test only for an uncovered port-specific defect.
- [ ] Review money/capacity/auth/unknown outcome, legacy-OFF parity and rollback in the affected code. No duplicate suite, broad manual-device matrix or repeat live POS create/readback.
- [ ] Record head SHA, affected test/CI evidence and gaps; **do not deploy or enable production as part of the port PR**.

**Checkpoints:** CP0/CP-A0/CP-A1/CP-B1/CP-B2/CP-B3 and independent C01/C02/C03/C05 are historically complete. CP-A2 waits for A08; C04 follows it. CP-A3/CP-B4 are resolved by the SKIP decisions above. CP-R/G6 applies only if production activation is requested.
