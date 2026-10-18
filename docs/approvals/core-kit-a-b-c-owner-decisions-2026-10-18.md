# Core Kit A/B/C — owner decisions approved 2026-10-18

**Decision state:** OWNER APPROVED — four option-A policy/design choices. This is a decision record, **not** approval of vendor behavior, SQL migrations, production deployment or feature enablement.

- **Owner confirmation:** “Duyệt A cả 4 mục” in the SON project conversation, 2026-10-18, referring to the four-item approval package immediately preceding it.
- **Normative sources:** [Spec #26](../specs/core-kit-reusable-capabilities-a-b-c-v1.md), [Plan #27](../../tasks/core-kit-reusable-a-b-c-v1-plan.md), [R00 gate record](../verification/core-kit-a-b-c-slice-record.md).
- **Scope:** F01 policy, GB1 curated-arrivals policy, G3 migration **design direction only**, and G4 / ADR 0010 taxonomy choice.

## 1. F01 / G1 — owner-approved commercial policy

- V1 applies **at most one A1 campaign in a checkout**. No implicit A1+A1 or same-paid-line A1+legacy PROMOTION/FLASH_SALE stacking; overlapping/conflicting publication is refused, and ambiguous runtime benefits fail closed without altering legacy paid checkout.
- Existing legacy pricing remains authoritative; calculate `S_basis(campaign)` using canonical effective legacy-priced eligible paid lines **before** any permitted A1 discount, with frozen eligibility. A1 must not add a second paid-line benefit to a legacy-discounted paid line. Exact conflict detection and buyer-recovery UX require child-spec technical review; ambiguous cases do **not** activate A1.
- `Q_paid_eligible(campaign)` counts only paid campaign-eligible units and can be zero. `Q_paid_cart` counts **all paid cart units** and must be positive for a submit-capable cart. Gifts and composite child resources count toward neither.
- `S_final_paid` is paid merchandise subtotal after approved benefits, without gifts/shipping; ship via `calculateGuestShippingFeeVnd({ subtotalVnd: S_final_paid, totalQuantity: Q_paid_cart })`, retaining existing `>` subtotal / `>=` quantity boundaries and no feedback into campaign eligibility.
- Each quote/order line has stable unique `lineId` and `PAID` or `GIFT` role. `laq1` remains valid **only** for legacy, `laq2` signs the new roles/money/entitlements and must not reinterpret old orders. PAID X×1 + GIFT X×1 creates two quote lines but **one summed capacity demand of 2** through existing locks; selected gifts are separate from unique paid `CartItem`.
- A1/A2 remain default OFF until accepted tests, approval of concrete migrations where relevant and vendor evidence for enabled formats.

**Artifact:** [F01 child contract](../specs/core-kit-benefit-quote-v1.md) records these approved business choices plus proposed technical acceptance. Owner selection does **not** automatically close G1 until that technical child spec is reviewed/merged.

## 2. GB1 — owner-approved Manual New Arrivals policy

- `pageSize = 24` curated slots per page (same nominal count as existing `/shop`); maximum persisted curated selection **500** items, with page count bounded by `ceil(selectionCount / 24)`.
- Routes `/new-arrivals` (page 1) and `/new-arrivals?page=N` (positive integer for subsequent pages); invalid or out-of-range pages return **404**.
- Admin's saved stable manual order is authoritative. Paginate the **saved curated positions first**, then suppress missing/hidden/unpublished products **within that page**. Do not refill holes from the next page, created-at products or collections. A page containing only excluded selections can render an empty-list status.
- Default OFF preserves current editorial route/frame/metadata and does **no curated listing reads**. ON + empty retains the editorial frame, a visible screen-reader-accessible empty state and zero cards — no redirect/backfill. ON + items reuse canonical `/shop` product visibility, effective pricing, stock projections and PDP links without creating another catalog authority.
- Required future regression coverage: N−1, N, N+1, 2N+1 stored selections (`N=24`), cross-page stable order, invalid pages, hidden/missing items, empty state, mobile/keyboard/axe.

**Artifact:** [B1 child contract](../specs/core-kit-new-arrivals-curation-v1.md). Owner chose these values; implementation remains gated on technical child-spec review **and separate per-slice G3 migration approval**.

## 3. G3 — approved direction, NOT an approved migration

**Direction accepted:** prepare **additive**, per-capability persistence/migration proposals for A02/A06, B01, B04, B05 and B06 (and any other explicitly required persistence). Keep Pancake mirrors, original `ProductContent`/`CollectionDefinition` and legacy checkout identities. Each design must cover shop-scoped authorization, bounded inputs, stable keys, unique/foreign-key constraints, transaction and concurrency rules, older/newer code coexistence, feature OFF, backfill if applicable, rollback, DB tests and operational checks.

**Important:** this grants permission to **draft schema diff + SQL + test plan for review**, not permission to write/execute a migration as implementation. The **G3 checkbox stays unchecked** until **each** actual schema diff, SQL and rollback plan has been reviewed. No shared/production migration, deployment or flag enablement is authorized.

## 4. G4 — taxonomy decision ACCEPTED

**KEEP existing collections; DEFER a separate taxonomy.** [ADR 0010](../decisions/0010-category-taxonomy-vs-collections.md) is accepted by the owner; B08's **decision** is resolved and B09 is **SKIPPED, not implemented**. No new route, schema, membership engine or sitemap rewrite. Reopen only when a specific brand has a reviewed need for hierarchical category navigation or separate editorial/category namespaces.

## 5. Gates that are NOT satisfied

| Gate | Status after this owner decision | What remains |
| --- | --- | --- |
| G1 / F01 | Owner policy **approved**; child spec review pending | Review/merge technical F01 spec, resolve exact overlap behavior |
| GB1 | Owner page/UX policy **approved**; child spec review pending | Review/merge B1 spec, plus G3 approval before B01 code |
| G3 | **Design direction approved only** | Review each concrete schema/migration SQL and rollback before relevant implementation |
| G4 / B08 | **Owner decision accepted** | Land ADR/checklist documentation; B09 remains SKIPPED |
| G2 / Pancake | **BLOCKED** | Controlled authorized create/readback for 0-VND gifts, same-variation PAID+GIFT and differently priced PAID rows, for any enabled subcase |
| G5 / image delivery | **BLOCKED** | Real-CDN measurements, agreed budgets and security review before B11 |
| G6 / release | **BLOCKED for new activation** | Exact-SHA tests/CI, security/rollback, explicit release permission |

Do not infer that owner approval of these four proposals authorizes external API writes, migrations, toggling production flags or merging implementation PRs.

## Addendum — technical review decisions (2026-10-18)

After [#37](../specs/core-kit-benefit-quote-v1-technical-review.md) the owner replied **"duyệt đề xuất 1-5, tiếp tục làm"**, approving the five decisions listed in that PR, each as recommended:

1. Legacy-discounted lines count toward an order-wide A1 basis at their effective price but receive no A1 price benefit.
2. Store-wide A1 scope skips the A1-vs-legacy publish refusal; the runtime rules apply.
3. One ambiguous legacy line refuses the whole campaign for that checkout.
4. `?page=1` is accepted and canonicalizes to `/new-arrivals`.
5. Bounds: A06 8 tiers / 5 gifts per campaign, B04 12 featured products, B05 8 related products per product.

Effect: the [F01](../specs/core-kit-benefit-quote-v1-technical-review.md) and [B1](../specs/core-kit-new-arrivals-curation-v1-technical-review.md) technical reviews are accepted, which closes **G1** and **GB1** for the code they unblock (A01, A05; B03 parser/metadata). **Not approved by this reply:** any per-slice G3 schema/SQL/rollback; G2; G5; G6; the B06 dependency on a trusted-image-host rule; verification that a hand-edited deferrable unique shows no Prisma drift (B01).
