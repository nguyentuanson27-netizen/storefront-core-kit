# Core Kit A/B/C — remaining La.Na ports (2026-10-19)

**Scope:** Transfer only behaviour already present on [La.Na main at `01eb7ca`](https://github.com/nguyentuanson27-netizen/la.na_design_storefront/tree/01eb7ca24bda63c4eb40208160083763412da68a) that Core Kit still lacks. This is a **port**, not a new feature programme. Do not copy brand UI, invent pricing/POS policies, build new routes/endpoints, or replace Core Kit's canonical cart, promotion, quote, reservation, authentication or order services.

**History:** [Original PR #27 plan and 13-capability matrix](https://github.com/nguyentuanson27-netizen/storefront-core-kit/blob/5af3fb826e5838fcfff451f5370ce4fc02ed5fc1/tasks/core-kit-reusable-a-b-c-v1-plan.md), [completed slices and CI](../docs/verification/core-kit-a-b-c-slice-record.md), [current checklist](./core-kit-reusable-a-b-c-v1-todo.md). F00/F01, A01–A07, B01–B08, C01/C02/C03/C05 are recorded as delivered; **do not rebuild or re-test them just to close the old plan**. A06 corrective [PR #53](https://github.com/nguyentuanson27-netizen/storefront-core-kit/pull/53) remains separately reviewable; resolve its safety findings before relying on A06 for benefit checkout.

## 1. Vendor evidence and boundaries (G2)

- [La.Na's live create/readback report](https://github.com/nguyentuanson27-netizen/la.na_design_storefront/blob/main/docs/integrations/pancake-gift-quantity-acceptance.md) records **PASS** on shop `715077776` for (1) repeated PAID variation at different prices and (2) PAID+GIFT of the same variation, with adapter-flow verification on **2026-10-15** after the **2026-10-14** probe. Test orders were canceled and read back as status 7.
- Adopt the **existing** [La.Na D-08 projection](https://github.com/nguyentuanson27-netizen/la.na_design_storefront/blob/main/docs/decisions/0016-gift-quantity-promotions-v1-decisions.md): the buyer-facing quote and immutable snapshot keep each GIFT at **0 VND**; the outbound Pancake line is **1,000 VND per gift unit**, offset from PAID lines so the merchandise total does not change. Fail closed if the paid units cannot absorb the offset. **Direct POS 0-VND gift was not tested and is not an output of D-08.**
- This evidence **is not proof for another shop**. Core Kit's P10 acceptance refers to shop `1635185058`, not the La.Na test shop. Reuse La.Na evidence to **port without another live POS test**; keep the feature **OFF**. Production activation needs a distinct G6 owner/operational decision acknowledging the target-shop evidence boundary. Do not claim that shop was tested.

## 2. Only remaining implementation tasks

| Order | Task | Port boundary | Acceptance |
| --- | --- | --- | --- |
| 1 | **A08 — benefit checkout** | Adapt existing La.Na benefit render/submit, deterministic D-08 outbound projection and readback into Core Kit's existing `laq2`, snapshot, lock, order and Pancake gateway | Exact PAID/GIFT roles and amounts; same-variation lines preserved; uncertain writes and unsupported configurations fail safely; legacy checkout unchanged when OFF |
| 2 | **C04 — checkout gift picker/reminder** | Adapt La.Na's existing gift selection/repair and one-time reminder into Core Kit's single checkout form, after A08 | No automatic gift selection; invalid choice repairable; input fields retained through re-quote; totals server-owned; OFF unchanged |

**Not part of these tasks:** a new benefit/promotion engine, new campaign policy, alternate checkout, image proxy, category taxonomy, new POS contract, new visual design or general-purpose abstraction.

**Optional / skip:** A09 is **SKIP for now**: current La.Na checkout upsell is a read-only link to `/sale` (owner OD-01/A), and Core Kit has no `/sale`; do not create the route or silently substitute `/flash-sale`. Reconsider only if an existing *semantically equivalent* destination becomes available, without developing a new feature. C03b drawer quantity/remove exists in La.Na but is **deferred**, not a dependency. A10 (obsolete inline checkout add), B09 (taxonomy), B10/B11 (image proxy/measurements) are **SKIPPED**.

## 3. Minimal verification (only for changed code)

1. **Before editing:** inspect the corresponding La.Na source/tests at the pinned main SHA and the Core Kit integration seam. Reuse code and documented evidence, not La.Na's business/brand ownership.
2. **A08:** run existing affected Core Kit domain/DB/integration tests for quote, paid+gift money, order snapshot, inventory holds, retry/unknown outcome and flag-OFF regression; port **only** a missing regression needed to expose an actual adapter defect.
3. **C04:** run affected checkout/gift domain and targeted browser/keyboard/accessibility checks for the changed UI. Do not create another entire browser suite or retest unrelated viewports.
4. **Every code PR:** normal required **exact-head CI**, including lint/typecheck/build and existing mandated checks. Record the OFF fallback, affected test results and known gaps. **No repeat Pancake create/readback, new performance benchmark or broad manual test matrix.**
5. **Docs-only PR:** verify links, statements and diff; no application/DB/POS test needed.

## 4. Release is separate (G6 / R00)

A08/C04 code ports keep flags **OFF**, do not write to a live POS or deploy. Before production ON, separately confirm the target shop's accepted-risk/compatibility decision, any **actually changed** migrations, security and checkout rollback, runtime monitoring, exact-head CI and owner go/no-go. **Passing the La.Na source probe does not itself authorize another shop or an ON flag.**

**Done for this plan:** A08 and C04 are ported with documented compatibility and required CI, or remain explicitly pending. Optional/skipped work must not be generated to clear a checkbox.
