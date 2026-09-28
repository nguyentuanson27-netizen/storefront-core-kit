# Merchant feed ↔ U27 variant JSON-LD parity (Wave 5 convergence gate)

Two public consumers describe the same standalone variant to two different audiences. This audit
records where they publish the same truth about the facts they share, and what remains open. The
convergence launch gate is **CLOSED as of PR #216**, which completed the proof set on the runtime
contract PR #214 implemented; what remains open below is Merchant *activation*, which this audit does
not grant.

It has been written in four passes:

- **PR #199** proved the parity across identity, grouping, MPN, URL, price and the resolvable
  availability domain, and recorded one reachable divergence it deliberately did not equalize. That
  pass changed no `src/` file.
- **PR #200 (U27a)** closed that **availability** divergence in runtime code, in both the
  exact-variant and product-level paths, and aligned U27's MPN-uniqueness domain with the Merchant
  mapper's. It does change `src/`. It did **not** close the convergence launch gate, which stayed
  open on the family-collapse granularity contract.
- **PR #214** implemented the owner-approved one-survivor contract in runtime code, and proved the
  survivor's variation identity, exact U12 URL, ADR 0008 MPN and resolved availability. Merged to
  `main` as `be7e5f628f86e71f8fc9769bed210501e15e03ed`.
- **PR #216** added the missing discriminating **promotion-aware price** proof for the collapsed
  survivor and completed this reconciliation. The approved contract names an exact promotion-aware
  price, and clause 5 closes the gate only once identity, URL, MPN, **price** and availability are
  all proved; every collapse-state case before this pass asserted the base price only, so that clause
  was implemented but unproved. **The gate therefore closes with #216, resting on #214's
  implementation.**

| | PR #199 | PR #200 (U27a) | PR #214 | PR #216 |
| --- | --- | --- | --- | --- |
| Base SHA | `2d5ea84045f61fc1249076379dd0816d37499546` | `22fea2ce9e48368b7ce64fa502d45b7c03bf98d3` | `f8a0658422481412201d05a9d3519cff5a205a54` | `be7e5f628f86e71f8fc9769bed210501e15e03ed` |
| Scope | tests, docs and task reconciliation only | runtime fix plus tests and docs | runtime selection/serialization plus focused tests | missing promotion-aware price proof plus docs reconciliation |
| `src/` changed | no | yes — `storefront-product.ts`, `storefront-catalog.ts`, `storefront-product-structured-data.ts` | yes — `storefront-product-structured-data.ts`, `structured-data.ts` | no behaviour change (trailing newline only) |
| Head SHA | recorded in that PR's description | recorded in that PR's description | `5fcb7a4cda5e1def6028b30abd3bb459cdd51f5e` | recorded in that PR's description |

- **Pancake API used:** NO. **Production database used:** NO, in all four passes. Every case is
  reproducible from repository fixtures.

## Authorities

Neither consumer re-derives a fact it publishes, and this audit introduces no third authority.

| Fact | Merchant (U25/M3 → U26/M4) | Variant JSON-LD (U27) |
| --- | --- | --- |
| Variation identity | `MerchantOffer.id` = `pancakeVariationId` | the U12 `?variant=` parameter of the published URL |
| Family identity | `MerchantOffer.itemGroupId` = `pancakeProductId` | `ProductGroup.productGroupID` = `pancakeProductId` |
| Manufacturer MPN | `VariantMirror.pancakeDisplayId` (ADR 0008) | `VariantMirror.pancakeDisplayId` (ADR 0008) |
| Variant URL | `buildStandaloneVariantDeepLinkPath` (U12) | `buildStandaloneVariantDeepLinkPath` (U12) |
| Price | storefront projection, promotion-aware | storefront projection, promotion-aware |
| Availability | M1 `classifyMerchantAvailability` over `resolvePublishableVariantStock` | PDP projection `purchasable` / `unavailableReason`, gated by `isVariantAvailabilityPublishable` |

Selling modes (`docs/specs/core-kit-selling-modes-v1.md` §9) keep one rule for both sides in
`src/commerce/selling-mode-publication.ts`: under `STANDARD` (every product while `SELLING_MODES_ENABLED` is off) the
M1 row rule is unchanged; under `OVERSELL` / `PREORDER` a negative row is expected and the stated stock is the advisory
`sellableUnits`; a preorder sale is excluded from Merchant (`PREORDER_PROJECTION_PENDING`) and has no JSON-LD offer.

Merchant paths: `src/commerce/merchant-offer-mapper.ts`, `merchant-offer-repository.ts`,
`merchant-feed-serializer.ts`, `merchant-feed-service.ts`, `merchant-feed-http.ts`,
`src/app/feeds/google-merchant/route.ts`.

JSON-LD paths: `src/seo/storefront-product-structured-data.ts`, `src/seo/structured-data.ts`.

Shared addressing authority: `src/commerce/storefront-variant-deep-link.ts`.

## Method

`tests/domain/merchant-structured-data-parity.test.ts` starts every case from **one** catalog
fixture and **one** storefront projection built by the production projection builder with the
production promotion pricing rule, then hands that single source to each consumer's own entry point:

```
catalog facts → buildStorefrontProductProjection (real promotion pricing)
              ├→ mapMerchantOffers → serializeMerchantFeed → parsed RSS <item> elements
              └→ buildStorefrontProductStructuredData → ProductGroup.hasVariant
```

Neither side can be tuned independently to make a case pass. The Merchant side is read back from the
serialized bytes a vendor would actually fetch, not from the mapper's in-memory result.

### Normalization rules

The two formats are compared on meaning, never on literal strings.

- Availability: `in_stock`/`out_of_stock` and `schema.org/InStock`/`OutOfStock` both normalize to
  `IN_STOCK`/`OUT_OF_STOCK`.
- Price: `<g:price>` is split into amount and currency token; the amount is compared with
  `Offer.price`, and the currency token is asserted separately.
- Variation identity: read out of the published URL through the reviewed `VARIANT_QUERY_PARAM`
  rather than by slicing the string, so the comparison stays inside the U12 contract.
- XML entities are decoded before comparison, so an escaped `&amp;` in a link cannot read as a
  different URL from the JSON-LD one.
- Exclusion diagnostics are deliberately **not** compared: Merchant's bounded reason vocabulary is
  its own contract, and JSON-LD has no equivalent. Only the shared negative invariant — no
  standalone-variant publication — is asserted.

## Parity matrix

| Case | Result |
| --- | --- |
| A — ordinary in-stock standalone variant | MATCH (identity, group, MPN, URL, price, availability) |
| B — zero stock | MATCH: a valid offer on both sides, `out_of_stock` / `OutOfStock`, exact price retained |
| C — active promotion | MATCH: both publish 712,000 against a 890,000 base; a base-price regression fails the test |
| D — variant URL | MATCH byte-for-byte, and the published identity reopens the same option through the U12 resolver |
| E — manufacturer MPN | MATCH: `pancakeDisplayId` only; never the website-local SKU, the internal CUID, or the variation id |
| F — missing / blank / untrimmed / duplicate MPN | COMPATIBLE FAIL-CLOSED on both sides |
| G — unresolved availability | COMPATIBLE FAIL-CLOSED on both sides since U27a — see below |
| H — unresolved price | COMPATIBLE FAIL-CLOSED; no `0`, no minimum, no base-price stand-in |
| I — unaddressable variation identity | COMPATIBLE FAIL-CLOSED on both sides |
| J — composite | COMPATIBLE FAIL-CLOSED: Merchant reports `COMPOSITE_DEFERRED`, U27 publishes no `ProductGroup` |
| Grouping | MATCH: every emitted sibling groups under `pancakeProductId`, never a slug, local id, kind key, MPN or index |
| Publishable set | MATCH across a mixed fixture of eligible and ineligible variants, **including** the family-collapse state below (implemented #214, proof completed #216) |

## Closed divergence — negative mirrored warehouse quantity (U27a)

### What PR #199 found

The two consumers reduce the same warehouse rows identically wherever every quantity is usable — no
rows and an explicit zero both sum to `0` (out of stock), and a positive sum is in stock. They parted
on a **negative** mirrored quantity, and the rule is per row rather than on the total:

| Warehouse rows | Merchant (M1 `aggregateWarehouseStock`) | Storefront total | U27 before U27a |
| --- | --- | --- | --- |
| `[-3]` | `NaN` → `AVAILABILITY_UNRESOLVED`, omitted | `-3` | exact `OutOfStock` Offer |
| `[5, -3]` | `NaN` → omitted | `2` | exact **`InStock`** Offer |
| `[3, -3]` | `NaN` → omitted | `0` | exact `OutOfStock` Offer |
| `[100, -1]` | `NaN` → omitted | `99` | exact **`InStock`** Offer |

`[5, -3]` is why the total cannot decide this: it sums to an unremarkable `2`, and a fix keyed on
"the total went negative" would have closed `[-3]` while still publishing a false `InStock`.
`WarehouseStock.quantity` is a `Float` with no non-negative constraint and the mirror reflects
whatever the vendor reports, so the class was reachable rather than theoretical.

### Root cause

M1 treats any malformed row as making the whole variant's availability unstatable. The storefront
absorbs the same row into ordinary arithmetic, because for a shopper "how many can I buy" has a
usable answer either way. U27 consumed that shopper-facing verdict and published it as an exact
machine-readable claim — a claim the feed had already declined to make.

### Reconciliation

A server-only per-variant availability-resolution signal, carried the same way U27 already receives
`variantMpnById` and `galleryIndexByVariantId`:

```
storefront catalog read (still holds raw warehouse rows)
        │  resolveVariantAvailabilityFromWarehouseStocks
        ↓
variantAvailabilityResolvedById   (keyed by internal VariantMirror.id, never published)
        ↓
PDP detail repository → U27 serialization boundary
```

- The rule lives in `src/commerce/storefront-product.ts` beside the variant-fact semantics it
  belongs to, so it stays free of Prisma and usable from pure domain tests.
- It is resolved in `src/commerce/storefront-catalog.ts`, the last place holding the raw rows: one
  pass over rows already in memory, **no additional database query** and no N+1.
- `src/seo/storefront-product-structured-data.ts` gates publication on it. Unresolved is an
  **omission**, never a substitute claim — not `OutOfStock`, `InStock`, pre-order or back-order. A
  variant missing from the map is unresolved too, so a caller that forgets it publishes nothing
  rather than something unverified.
- The same filter narrows the **product-level fallback** offer. Suppressing the exact per-variant
  claim alone would have been half a fix: the fallback aggregates the standalone options, so a
  family collapsing to one sold-out survivor would still have advertised `InStock` on the strength
  of a sibling whose inventory the catalog cannot read. The filter matters in both directions — an
  unresolved sibling must not manufacture stock, and must not drag the offer into the
  price-disagreement refusal and withhold one the survivor fully supports.
- U27 still reads no database, imports nothing from the Merchant modules, and keeps the PDP
  projection as its price/addressability/resolved-availability authority. The two consumers converge
  on upstream facts; neither calls the other.
- The rule matches M1's by value, deliberately not by import, and the parity suite proves the two
  agree rather than trusting the comment.

### What did not change

- **Shopper-facing PDP behaviour is untouched.** `sumWarehouseStocks` still sums finite rows, so
  `[5, -3]` is still two units, still priced, still purchasable, and the option/cart/checkout paths
  are unchanged. `resolveVariantAvailabilityFromWarehouseStocks` answers a separate question and
  introduces no app-wide throw for a finite negative quantity.
- **Merchant was not weakened and not modified.** `merchant-offer-mapper.ts`,
  `merchant-offer-repository.ts`, `merchant-identity-audit.ts`, `merchant-feed-serializer.ts` and
  `merchant-feed-service.ts` carry no diff in U27a.
- **No client contract widening.** The signal never reaches `StorefrontSelectableOption` or the
  browser; the purchase panel has no use for it.
- **No database constraint and no sync normalization.** How the mirror should represent malformed
  upstream data is a separate design question, deliberately untouched.

### ProductGroup behaviour after exclusion

An excluded variant leaves nothing behind: no `hasVariant` entry, no `offers`, no MPN, no dangling
URL. `variesBy` is recomputed from the survivors, so dropping the only other colour leaves a
size-only family rather than a claimed colour axis. When exclusion leaves no real family, U27 never
publishes a one-member `ProductGroup`: since PR #214 a single surviving sibling is published as the
exact standalone survivor described below, and a product that only ever had one option keeps the
ordinary product-level fallback.

### Also closed — exclusion ordering around MPN uniqueness

A second, separate mismatch surfaced in review of the same PR, and it is not the family-collapse
contract.

The two consumers judged uniqueness over different sets. The Merchant mapper decides each candidate
on its own facts first and only then looks for duplicate ids and MPNs **among the survivors**
(`drafts.filter(draft => draft.offer !== null)`). U27 counted publishable MPNs across **every**
projection option before any other exclusion applied. So a variant already doomed — unresolved
availability, unresolved price, unaddressable identity — still counted as a claimant and suppressed
a perfectly good sibling that shared its part number:

```
A: MPN=DUP, stock [5]      valid
B: MPN=DUP, stock [5, -3]  availability unresolved

Merchant: B excluded before dedupe → DUP has one claimant → A publishes
U27 (before): DUP counted twice → A rejected as a duplicate → A withheld
```

`resolvePublishableVariants` now collects the candidates that survived every other check and applies
uniqueness to that set, mirroring the mapper's order. This closes the class rather than the two
instances: an unaddressable variant, one with no landing path, one with a malformed MPN, an
unresolved price and an unresolved availability are all excluded before they can claim anything.

The rule it narrows is unchanged where it matters: when two *surviving* candidates share a part
number, both are still dropped, because the catalog cannot say which one it names.

### Closed contract — the family-collapse state (implemented #214, proved #216)

This was the last open question, and it was a granularity question rather than a contradiction:
when exclusion left a single publishable sibling, Merchant published an exact offer for the survivor
while U27 fell back to a product-level `Product` carrying no exact *variant* identity. The two
statements agreed on product, price and availability, but the publishable exact-variant sets were
not equal, so the gate could not close on that evidence.

The owner approved a **narrower** variant of the exact-survivor direction discussed in the previous
pass. The difference matters and is deliberate: the option recorded earlier would have published an
exact variant `Product`/`Offer` for *any* product with a single publishable variant, including one
that only ever had one option. The approved contract applies only to a real family that collapses.
See `docs/specs/la-clothing-owner-approved-facts-and-decisions.md` §14 — and **PR #214 implements it**, with **PR #216** completing its proof set:

- Merchant continues to publish that exact survivor, unchanged;
- U27 emits a top-level standalone `Product` representing **the same** exact survivor, using the
  same U12 `?variant=` deep-link and the same verified variant facts (MPN, optional publishable SKU,
  colour/size, resolved variant image, promotion-aware price, resolved availability);
- U27 does **not** emit a one-member `ProductGroup`;
- the standalone `Product` does not invent a `productGroupID`; Merchant may still carry
  `item_group_id`, and that field is excluded from the shared-fact comparison because it is the one
  fact the two formats legitimately do not share;
- a product that started with exactly **one** option is not a collapsed family and keeps the ordinary
  product-level fallback with the canonical PDP URL;
- zero publishable exact variants still produce no exact standalone-variant claim.

Convergence is gated on the facts both consumers must agree on — bounded external offer identity,
positive price, resolved availability and exact ADR 0008 MPN — so a variant Merchant would reject
cannot authorize an exact JSON-LD survivor. Option *dimensional* validity remains U12/storefront
addressability's decision, so a valid size-only family is not rejected merely because Merchant's
apparel feed independently requires a colour.

Both sides fail closed independently at the serialization boundary: a malformed MPN cannot become
public markup even if a future caller bypasses the selection helper.

#### Evidence

| Property | Coverage |
| --- | --- |
| Exact variation identity | `merchant-structured-data-parity.test.ts` — *publishes the family-collapse survivor as the same exact standalone variant* |
| Exact U12 variant URL | same test + `merchant-structured-data-family-collapse.test.ts` (asserts `productNode.url === offer.link`) |
| ADR 0008 MPN | same tests (`productNode.mpn === offer.mpn`) |
| Promotion-aware price | `merchant-structured-data-parity.test.ts` — *publishes the promotion-aware survivor price after a family collapse* **(added by PR #216; the first case to discriminate this path — before it, every collapse-state case asserted the base price only)** |
| Resolved availability | family-collapse test asserts `schema.org/InStock` against Merchant `in_stock`; excluded sibling reports `AVAILABILITY_UNRESOLVED` on both sides |
| No one-member `ProductGroup` | family-collapse test asserts `@type === "Product"` and the absence of `hasVariant` / `productGroupID` / `variesBy` |
| Single-option product is not a collapsed family | `storefront-structured-data-boundary.test.ts` — *U27 single or non-publishable family keeps the product-level fallback* asserts the canonical PDP `Offer.url` |
| Merchant-eligibility precedence | `merchant-structured-data-family-collapse-eligibility.test.ts` — missing size, zero price and overlong offer id; plus a rejected product identity emitting no exact survivor |

The parity suite reads the Merchant side back from **serialized RSS bytes**, not the mapper's
in-memory result, so the comparison is against what a vendor would actually fetch.

### Non-finite quantities

Unchanged and still fail closed. The PDP repository throws on a non-finite quantity before a
projection exists, so no JSON-LD is published at all; the resolution rule also refuses them as
defence in depth. U27a did not broaden that behaviour.

## Checkpoint E evidence

PR #198's final exact head is `1d003dc4d917c138a2c12f93c98b4a38be487754`. All five relevant
workflows concluded `success` on that exact SHA — no stale-head evidence:

| Workflow | Run | Conclusion |
| --- | --- | --- |
| CI | #1964 | success |
| Merchant feed runtime | #27 | success |
| Catalog indexation runtime | #952 | success |
| P18 final QA runtime | #746 | success |
| VPS container verification | #889 | success |

## Runtime verification

Business-fact parity and production feed activation are separate questions, and this audit keeps
them separate.

- **U27 over real HTTP:** `scripts/structured-data-http-smoke.ts` (run from
  `tests/integrations/product-slug-http.test.ts`, inside `pnpm test`) starts the built app, requests
  a seeded PDP, parses the served JSON-LD, and asserts one `ProductGroup` with variant-specific
  names, unique manufacturer MPNs, exact per-variant `Product`/`Offer` facts, and published URLs
  that reopen the same variants at the same prices.
- **Merchant over real HTTP:** the `Merchant feed runtime` workflow requests
  `/feeds/google-merchant` on the built app and requires a bounded `503` with `retry-after: 60`,
  `x-la-merchant-feed-failure: MARKET_UNRESOLVED`, exactly one `cold_generation`, and identical
  behaviour under request query noise.

Therefore:

```
business-fact parity
  identity / grouping / MPN / URL / price  = GREEN
  availability, resolvable stock domain    = GREEN
  availability, any negative row           = COMPATIBLE FAIL-CLOSED (U27a)
  exclusion ordering vs MPN uniqueness     = GREEN (U27a)
  exact-variant set, family-collapse state = GREEN (implemented #214, proof completed #216)

feed <-> JSON-LD consistency launch gate   = CLOSED (with #216)
production feed activation                 = BLOCKED by O2 runtime authority
```

## O2 status

**The O2 owner decision is RESOLVED as Vietnam / `vi` / `VND`; its trusted runtime authority is
still unimplemented.** `APPROVED_MERCHANT_MARKET` is still `null`, `resolveMerchantMarket()` still
reports `MERCHANT_MARKET_UNRESOLVED`, and the production route still fails closed with a bounded
`503`. That is an implementation/configuration gap, not an unresolved owner decision and not a
parity failure.

The parity suite needs a currency token to render `<g:price>`, so it passes a clearly named
`TEST_ONLY_MERCHANT_MARKET` straight to the serializer. It is scoped to that one test file, nothing
under `src/` imports it, it configures nothing, and it cannot make `/feeds/google-merchant` answer
`200`. It is not an approved Vietnam market and grants no approval.

This audit approves no country, language or currency, activates no Merchant Center data source, and
changes no activation gate.

## Topology

Unchanged since PR #198: one app service, and U26's process-local cache/single-flight/backoff makes
no multi-replica claim. Nothing here adds Redis, replicas, or a deployment change.

## Remaining gates

- **Feed ↔ JSON-LD consistency launch gate:** **CLOSED** with PR #216, on the one-survivor runtime
  contract PR #214 implemented. This gate closing does not activate anything: it removes the parity
  blocker only.
- **O2 runtime authority:** OPEN — decision approved, trusted server-owned configuration not wired.
  **M5 / U41:** BLOCKED.
- Next unit: `U28 / T8`, itself blocked on **O4** and Google Tag Manager account access.
