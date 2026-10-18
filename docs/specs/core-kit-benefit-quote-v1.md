# Core Kit benefit quote v1 — F01 child specification

**Status:** OWNER BUSINESS POLICY APPROVED on 2026-10-18; **technical child-spec review pending**. G1 is not automatically satisfied by this draft. A01–A10 and C04 implementation continue to respect their approval/dependency gates.
**Parents:** [A/B/C umbrella spec](./core-kit-reusable-capabilities-a-b-c-v1.md) (`4/A1–A4), [implementation plan](../../tasks/core-kit-reusable-a-b-c-v1-plan.md) (F01, A01–A10), [owner decision record](../approvals/core-kit-a-b-c-owner-decisions-2026-10-18.md).

## 1. Purpose and boundaries

Add opt-in `GIFT_ITEM` and `QUANTITY_TIER` benefits without replacing canonical legacy promotion pricing, cart, quote proof, capacity locks, POS gateway or checkout state. Feature is default **OFF**. Admin only may create/preview/publish/disable campaigns with validated shop scope and bounded limits.

**Owner-approved v1 conflict policy:** at most **one active/eligible A1 campaign applies per checkout**. Do not stack separate A1 campaigns, and do not double-discount the same paid line with A1 plus legacy `PROMOTION`/`FLASH_SALE`. Reject publish of detectably conflicting campaign scopes; on ambiguous runtime overlap, do not grant an unproven A1 benefit and preserve safe legacy checkout. The technical review must freeze the exact predicate used to detect same-paid-line conflicts and the visible buyer recovery message before any activation; no silent campaign ranking/priority rule is introduced here.

## 2. Paid basis and shipping (owner approved)

| Symbol | Meaning | Rules |
| --- | --- | --- |
| `Q_paid_cart` | Paid purchase units across **the whole cart** | Composite set counts as 1; no gift/component units; > 0 before shipping |
| `Q_paid_eligible(campaign)` | Eligible paid units for a specific campaign | Can be zero; respects exclusions; NEVER shipping quantity |
| `S_basis(campaign)` | Eligible-scope paid subtotal after existing canonical legacy price resolver, before A1 tier benefits | Frozen for tier eligibility; excludes gifts/shipping |
| `S_final_paid` | Whole-cart paid subtotal after accepted A1 discount steps | Excludes gifts/shipping; evaluated only once for shipping |

`calculateGuestShippingFeeVnd({ subtotalVnd: S_final_paid, totalQuantity: Q_paid_cart })` remains the only shipping authority; free when `S_final_paid > freeShippingSubtotalVnd` **OR** `Q_paid_cart >= freeShippingMinQuantity`. Do not recalculate campaign eligibility after applying discounts. Legacy pricing is the source for `S_basis`, **not** permission to grant a second A1 discount on a line already discounted by legacy. Ambiguous mixed-policy scope remains A1-ineligible until the precise overlap test has passed review.

## 3. Line identity, proof, snapshots

- Rendered/server-owned quote lines have distinct stable `lineId`, `role: PAID | GIFT`, variant identity, positive safe integer quantity, deterministic order, role-appropriate amount (PAID unit > 0, GIFT unit = 0), campaign/entitlement identity and bounded money values. Same variation can appear in multiple role-distinct quote lines; duplicate `lineId` is invalid.
- `laq1` format and historical readers remain valid for legacy paid-only orders. New `laq2` uses a separate version/MAC context binding line IDs, roles, discounted payable lines, eligibility/grants, shipping and final totals. No client-provided prices or gifts. A `laq1` proof cannot authorize gift/discount fields.
- Store selected gifts **separately** from paid `CartItem`. Versioned order snapshots keep immutable paid/gift identities and totals; old rows without v2 fields remain legacy and are never backfilled with fake gifts.
- Reconfirm only when material signed quote/grantability facts change. Harmless stock synchronization alone is not an invalidation reason; final locked capacity may still deny submit.

## 4. Capacity and POS safety

- Aggregate every paid + gift role line by VariantMirror/resource demand **before** existing locked reservation. `PAID X ×1 + GIFT X ×1` reserves one order/variant row for **2** units, not two rows and not one unit. Preserve composite expansion, selling floors, idempotent retry, `SYNC_UNKNOWN` holds and mirror handoff.
- **G2 is NOT approved.** Before enabling a specific POS shape, a controlled authorized create **and order readback** must prove: (a) 0-VND gift line, (b) paid+gift with the same variation ID, (c) same variation repeated at different PAID prices. Capture request/response/result IDs, expected versus readback quantities and totals, sanitized evidence and the owner-approved test environment. Mock-only success is insufficient.
- Unproven/unsupported shapes stay OFF or the affected benefit path rejects safely. Never merge/drop distinct gift rows, fake POS acceptance or write corrected stock to the mirror.

## 5. Planned implementation split

- **A01:** role IDs and `laq2` pure proof with legacy vectors.
- **A02/A06:** additive storage and admin publication, each independently blocked on detailed G3 review.
- **A03:** aggregated locked demand + concurrency DB parity.
- **A04:** OFF-only synthetic v2 quote adapters; NOT real live-benefit checkout.
- **A05:** frozen eligible paid basis, cross-campaign conflict rule and post-discount shipping.
- **A07:** server-owned selected gift revalidation; stale gift safely blocks benefit checkout.
- **A08:** real buyer render/submit and POS parity only after A05/A07 and G2 readback for enabled cases; **A09/A10 and C04** follow their gates.

## 6. Minimum future verification

- Mixed cart eligible A×1 + ineligible B×2: campaign count 1, shipping quantity 3; no eligible A => 0 eligible but positive cart quantity; gift never changes shipping count.
- Campaign threshold just below/at/above; paid subtotal and strict shipping thresholds at 999,999 / 1,000,000 / 1,000,001 VND, paid quantity 2 / 3; one-pass threshold evaluation, no benefit oscillation.
- Legacy promo + A1 line overlap, two eligible A1 campaigns, ambiguous campaign priority => no unsupported stacking/benefit; flag OFF preserves legacy money/checkout.
- `PAID X×1 + GIFT X×1`: unique role lines but reservation quantity 2; stock 2 success, stock 1 rejects atomically, concurrent checkouts and retried/unknown POS calls do not overhold/double-submit.
- Cross-version `laq1`/`laq2` signature/role/amount tampering, old order snapshots, immutable digest/order/POS parity and stock-only non-material refresh.
- Admin auth, input bounds/shop ownership, successful OFF rollback, actual DB and controlled POS evidence on exact commits when required.

## 7. Review-required technical decisions (still not cleared)

- Specify and test the **exact** campaign-scope overlap predicate and its buyer-facing failure/recovery, including legacy-discounted lines that contribute to an order-wide tier basis. Until then reject ambiguous A1 benefits, keeping legacy checkout unaffected.
- Review concrete campaign/gift/snapshot schema and rollback under **G3**; decide allowed history/version fields without breaking existing unique constraints.
- Review `laq2` canonical binary/text encoding and HMAC key separation, grant representation and signature vectors as part of A01. Do not claim an untested wire format is implemented.

**No production feature enabled. No migration design or Pancake readback is approved by this document.**
