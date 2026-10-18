# Core Kit benefit quote v1 — F01 technical review (ACCEPTED by owner 2026-10-18)

**Status:** **ACCEPTED.** The owner approved proposals 1–5 on 2026-10-18 ("duyệt đề xuất 1-5"; see [decision addendum](../approvals/core-kit-a-b-c-owner-decisions-2026-10-18.md#addendum--technical-review-decisions-2026-10-18)). This satisfies **G1** for A01 and A05. It does **not** satisfy G2 (Pancake readback) or any per-slice G3.
**Child of:** [F01 child spec](./core-kit-benefit-quote-v1.md) §7 ("Review-required technical decisions"). **Owner policy** (single A1 campaign per checkout, no same-paid-line legacy stacking, `laq2` beside `laq1`) is taken as given from the [decision record](../approvals/core-kit-a-b-c-owner-decisions-2026-10-18.md) and is **not** reopened here.

Everything below is grounded in code on `main`: `src/commerce/promotion-pricing.ts` (`resolvePromotionPricing`), `src/commerce/checkout-quote-proof.ts` (`laq1`), `OrderLineSnapshot` and `CapacityReservation` in `prisma/schema.prisma`. No code, schema or flag changes accompany this document.

## 1. Exact legacy-overlap predicate

### 1.1 What the code already gives us

`resolvePromotionPricing` is the single legacy authority and already fails closed. Per variant it returns exactly one of:

| Legacy outcome | Detected as | Meaning |
| --- | --- | --- |
| `LEGACY_NONE` | `isDiscounted === false && reason === null` | No applicable legacy campaign; effective price = base price |
| `LEGACY_DISCOUNTED` | `isDiscounted === true` | One legacy campaign applies; effective price < base price |
| `LEGACY_AMBIGUOUS` | `reason === "PROMOTION_CONFLICT"` or `"PROMOTION_INVALID"` | Legacy could not decide; the line is sold at base price **today** |
| `BASE_UNAVAILABLE` | `reason === "BASE_PRICE_UNAVAILABLE"` | Not purchasable; irrelevant to A1 |

The predicate is therefore defined **only over that result** — A1 never re-derives legacy eligibility, windows or targets, so there cannot be a second, drifting definition of "is this line legacy-discounted".

### 1.2 Per-line classification (runtime, per campaign `C`, per paid line `L`)

1. `L` is **in scope** of `C` if its product/variant matches `C`'s targets (A06) and it is a `PAID` line. `GIFT` lines are never in scope.
2. **Basis line:** `L` counts toward `Q_paid_eligible(C)` and `S_basis(C)` at its **effective legacy price** — exactly the owner wording ("canonical effective legacy-priced eligible paid lines before any permitted A1 discount"). This holds for `LEGACY_NONE` and `LEGACY_DISCOUNTED`.
3. **Benefit line:** `L` may *receive* an A1 price benefit (tier discount) only if its outcome is `LEGACY_NONE`. A `LEGACY_DISCOUNTED` line is a basis line that receives **no** A1 price benefit — this is the owner's "no second benefit on a legacy-discounted paid line".
4. **Fail-closed rule:** if any in-scope paid line is `LEGACY_AMBIGUOUS`, campaign `C` is **not granted for this checkout** (reason `A1_LEGACY_AMBIGUOUS`). Rationale: an ambiguous line is priced at base only because legacy refused to choose; granting A1 there could double-discount the moment legacy becomes decidable (owner: "ambiguous cases do not activate A1").
5. **Single campaign:** if more than one A1 campaign is active *and* has at least one in-scope paid line in this cart, **none** is granted (reason `A1_MULTIPLE_CAMPAIGNS`). There is no ranking or priority, mirroring the legacy `PROMOTION_CONFLICT` choice. This is the runtime backstop for §1.3.
6. **Gifts (`GIFT_ITEM`):** the threshold is evaluated on the basis (rule 2); a gift is a separate `GIFT` role line at unit price 0 and is not a "benefit on a paid line", so rule 3 does not block it. Rules 4–5 still apply.

All three outcomes of rules 3–5 are **non-blocking**: checkout proceeds at legacy prices with the A1 benefit absent. Nothing in a refusal path may change legacy money.

### 1.3 Publish-time detection (A06, admin)

Detectable overlap is refused at publish, with the conflicting campaign named in the admin error:

- **A1 vs A1:** enabled windows intersect (half-open `[startsAt, endsAt)`, `null` = unbounded on that side) **and** target sets intersect (same product, same variant, or product ⊇ variant). Two campaigns that satisfy both cannot be enabled together.
- **A1 vs legacy:** an enabled legacy `PromotionCampaign` whose windows intersect and whose explicit targets intersect the A1 targets. Refused with the legacy campaign named. (Legacy stays authoritative; the A1 campaign must be scoped around it or scheduled after it.)
- Publish and legacy-write paths take one transaction-scoped advisory lock so two admins cannot publish conflicting campaigns concurrently (precedent: the single-row `PromotionPricingRevision`).

### 1.4 Buyer recovery

- **Not granted at render:** a neutral line note on affected cart/checkout lines ("Ưu đãi … không áp dụng cùng giá khuyến mãi hiện có"), no error state, no reconfirm.
- **Granted at render, ungrantable at submit** (e.g. legacy campaign started in between): this is a *material* quote change → existing reconfirm path (`PRICE_CHANGED`-style), buyer sees the new total before submitting. Stock-only refresh stays non-material.

### 1.5 Decisions (all ACCEPTED as recommended)

1. **Basis rule (§1.2 rule 2) — ACCEPTED.** Confirm that a legacy-discounted line should count toward an order-wide tier basis at its effective price (this is the literal owner text). The stricter alternative — exclude legacy-discounted lines from the basis too — is simpler to explain but makes tier eligibility depend on which products are on legacy sale. Recommendation: keep the literal reading.
2. **Store-wide A1 scope vs. §1.3 — ACCEPTED.** A store-wide tier campaign intersects *every* legacy target. Refusing publish for that would make store-wide tiers impossible whenever any legacy sale is on. Proposal: for store-wide scope, skip the A1-vs-legacy publish refusal and rely on the §1.2 runtime rules. 
3. **Rule 4 granularity — ACCEPTED (whole-campaign).** Whole-campaign refusal on one ambiguous line is conservative. Per-line exclusion would grant partial benefits and re-open the double-discount risk. Recommendation: whole-campaign.

## 2. `laq2` encoding and key separation

`laq1` is unchanged and remains the only accepted format for legacy paid-only quotes.

- **MAC:** HMAC-SHA256 as today. **Key:** derived from the same validated server secret with a **new context string** `la-clothing:checkout-quote-proof-key:v2` — a different derived key, so an `laq1` MAC can never verify as `laq2` or the reverse, and neither can verify as a session/client-identity value (same derivation shape as `deriveProofKey`).
- **Cart identity:** length-prefixed MAC context, never payload (unchanged rule).
- **Envelope:** `<payload>.<mac>` base64url, same `MAX_RENDERED_QUOTE_PROOF_BYTES` (16 KiB) bound; issuing returns `null` (caller fails closed) when exceeded. Line and gift counts are additionally bounded by A06/A07 limits so a valid benefit quote always fits.
- **Canonical bytes** (deterministic, self-delimiting; every free-form string length-prefixed):

```
laq2|{Q_paid_cart}|{S_final_paid}|{shippingFeeVnd}|{totalVnd}|{lineCount}
  per line, sorted by lineId (UTF-8 bytewise):
  |{len(lineId)}:{lineId}:{PAID|GIFT}:{len(variantId)}:{variantId}:{quantity}:{unitPriceVnd}:{lineTotalVnd}:{len(campaignId)}:{campaignId}:{len(entitlementKey)}:{entitlementKey}
|{grantCount}
  per grant, sorted by campaignId:
  |{len(campaignId)}:{campaignId}:{Q_paid_eligible}:{S_basis}:{tierIndexOrMinus1}:{giftLineCount}
```

  `campaignId`/`entitlementKey` are the empty string (length `0`) for lines without a benefit.
- **Verification** recomputes the expected canonical bytes for the quote *the server rebuilt*, then compares bytes and MAC. The version is chosen by the rebuilt quote (benefit quote → `laq2`, legacy quote → `laq1`), never by the token, so a token cannot choose its own, weaker verifier. No parse-back of token bytes into money (the existing "never price authority" rule).
- **Validity rules enforced before issue:** `lineId` unique and non-empty; `PAID` unit > 0; `GIFT` unit = 0 and line total = 0; positive safe-integer quantities; all money bounded by `isUsableVnd`; the same variant may appear once per role.

### Required test vectors (A01)

Vectors must be produced by an **independent reference computation** (e.g. a short Python `hmac` script committed beside the test, with fixed secret/cart id/inputs), not by the code under test, so the test cannot confirm its own bug. Minimum set:

1. PAID X×1 + GIFT X×1 (same variant, two `lineId`s) → two distinct canonical lines, deterministic bytes.
2. Input line order permuted → identical token.
3. `lineId`/`variantId`/`campaignId` containing `|`, `:`, digits → no boundary ambiguity.
4. Tamper each of: role, quantity, unit price, line total, campaign id, shipping, total → `PRICE_CHANGED`/`PROOF_UNVERIFIED`.
5. `laq1` token presented for a benefit quote, and `laq2` for a legacy quote → rejected; `laq2` MAC recomputed under the v1 key → rejected.
6. Duplicate `lineId`, `GIFT` with price > 0, `PAID` with price 0 → issue throws (programming error), oversize → `null`.
7. Round-trip with a persisted-line rebuild (order snapshot) equals the render-time token bytes.

## 3. Capacity and legacy-order readability (confirming constraints, no change proposed)

- `CapacityReservation` has `@@unique([orderId, variantId])`: PAID X×1 + GIFT X×1 **must** be summed into one reservation of quantity 2 *before* the existing locked reservation. This matches the spec; A03 must add the aggregation step and a test that two role lines never produce two reservation rows.
- `OrderLineSnapshot` has no unique on `(orderId, variantId)` — same-variation role lines already round-trip; A02 only adds columns (see the [G3 proposals](../proposals/g3-additive-migration-proposals.md)).

## 4. What this review closes

| Item | After this proposal is accepted |
| --- | --- |
| Overlap predicate (spec §7 bullet 1) | **Accepted**; A05/A06 acceptance |
| `laq2` encoding / key separation / vectors (spec §7 bullet 3) | **Accepted**; vectors produced in A01 |
| Schema (spec §7 bullet 2) | **Not closed** — per-slice [G3 proposals](../proposals/g3-additive-migration-proposals.md) |
| G2 Pancake readback | **Not closed** — controlled readback still required before A08 |
| A1/A2 enablement | Remains OFF; no production activation |
