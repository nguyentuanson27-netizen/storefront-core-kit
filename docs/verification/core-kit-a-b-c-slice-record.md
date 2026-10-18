# Core Kit reusable capabilities A/B/C — slice record (R00)

Tracker for [plan](../../tasks/core-kit-reusable-a-b-c-v1-plan.md) and [checklist](../../tasks/core-kit-reusable-a-b-c-v1-todo.md).
Normative source: [A/B/C umbrella spec](../specs/core-kit-reusable-capabilities-a-b-c-v1.md).

This file records, per slice, the exact commit evidence, the compatibility with every new flag OFF, and the
rollback. It is **evidence, not authorization**: no flag listed here is enabled, no migration is applied to any
shared environment, and no external POS write is performed by recording a slice.

## F00 — revalidation of the §2 gap matrix

- **Baseline in the plan:** `main@1f71d610387f1e000c89bc11732a79426fa0dfb8` (spec #26).
- **Revalidated at:** `main@a397e44dd6800481036e49d55fb2cfcdc885398b` (plan #27 merged).
- **Drift in code:** none. `git diff 1f71d61..a397e44 --stat` changes only
  `tasks/core-kit-reusable-a-b-c-v1-plan.md` and `tasks/core-kit-reusable-a-b-c-v1-todo.md`.
- **Path check:** all 60 distinct source/test paths named in the plan's §2 matrix exist in the tree.
- **Behavioural spot-checks against the matrix rows** (read from source at the SHA above):
  - A1/A4: `src/commerce/checkout-quote-proof.ts` has `PROOF_FORMAT = "laq1"` only; no `laq2`, no `lineId`
    anywhere under `src/`. `src/commerce/checkout-quote.ts` rejects a repeated `pancakeVariationId`
    (`seenVariationIds` in `buildRenderedCheckoutQuoteFacts`), a repeated `variantExternalId` and a non-positive
    unit price or quantity.
  - A2: no upsell, gift, benefit, arrival, merchandising, suggestion or category module under `src/commerce/`.
  - A3: `@@unique([orderId, variantId])` on `CapacityReservation` and `@@unique([cartId, variantId])` on `CartItem`
    are unchanged.
  - B1: `src/routes/new-arrivals.ts` still seals an empty view model (editorial-only).
  - B5: `src/routes/search.ts` still seals an empty view model; results are owned by `/shop`.
- **Result:** the matrix classifications and KEEP/ADAPT/REBUILD/SKIP decisions stand unchanged.
- **Local baseline on that SHA** (PostgreSQL 16, migrations deployed): `pnpm prisma:validate`, `pnpm lint`
  (0 errors, 12 pre-existing warnings), `pnpm typecheck`, `pnpm test` (1843 pass / 0 fail) and `pnpm test:db`
  (478 pass / 0 fail) all pass.
- **Reviewer acknowledgement:** recorded by the owner's instruction to the implementing agent to self-review and
  merge qualifying PRs. The owner can still contest any row; nothing downstream relies on a gate that this record
  does not grant (see below).

## Gate and blocker status

A gate is only satisfied by the artifact named in the plan. Merging planning or tracking documents satisfies none.

| Gate | Needed by | Status | What unblocks it |
| --- | --- | --- | --- |
| G1 / F01 — owner-approved child contract (stacking, `lineId`/`laq2`, paid bases, capacity, rollback) | A01–A10, C04 | **BLOCKED — owner decision** | Approved child spec (`docs/specs/core-kit-benefit-quote-v1.md`) |
| G2 — controlled Pancake readback of 0-VND gift, same-variation PAID+GIFT, differently priced PAID rows | A08 (and so A09, A10, C04) | **BLOCKED — no controlled POS evidence** | Approved test-environment readback evidence per enabled use case |
| G3 — additive migration and old/new code coexistence | A02, A06, B01, B04, B05, B06, B09 | **BLOCKED — not approved** | Reviewed migration design per slice |
| GB1 — B1 child spec (finite `pageSize`, pagination, empty state, ownership) | B01, B03 | **BLOCKED — owner decision** | Approved B1 child spec |
| G4 — category vs collections | B08 → B09 | **BLOCKED — owner decision** | Reviewed ADR |
| G5 — image delivery measurement and security decision | B10 → B11 | **BLOCKED — needs comparable real-image measurement** | Measurements plus security design review |

Tasks with no unmet gate and no schema change: **B07, C01, C02, C03, C05** (after B07). These are built first.
A05 is a pure function but its gate reads "Stacking must be approved", and the plan declares the stacking default
open, so it is held with F01 rather than guessed.

## Slice log

Each entry: task, PR, merged SHA, CI result on the exact head, flag(s) and default, OFF compatibility, rollback.

| Task | PR | Merged SHA | Exact-head CI | Flag (default) | OFF compatibility | Rollback |
| --- | --- | --- | --- | --- | --- | --- |
| F00 | #28 | `81438ef` | 13/13 checks success on `51bdd46` | — | no code change | revert the PR |
| B07 | #29 | `75e69b4` | 15/15 checks success on `fab04ba` | `SEARCH_SUGGESTIONS_ENABLED` (OFF) | flag OFF returns `DISABLED` before validation or any catalog statement (asserted at 0 statements); `/search`, `/shop` untouched | set the flag `false` and recreate `app`; no migration |
| C02 | #30 | _recorded after merge_ | _recorded after CI_ | `SHOP_FILTER_DISCLOSURE_ENABLED` (OFF) | flag OFF renders the unchanged always-open form; the unmodified `discovery.spec.ts` passes against an OFF server | set the flag `false` and recreate `app`; no migration |

## B07 — bounded search suggestions

- **What shipped:** a read model, not a UI and not a new route. `searchStorefrontSuggestions(input)` (server action,
  `src/routes/search-suggestions.ts`) returns the narrow `SearchSuggestionsModel`; nothing renders it until C05.
- **Authorities reused, none forked:** the query goes through `parseStorefrontDiscoverySearchParams` (same trimming and
  80-character bound as `/shop`), the rows come from `createStorefrontCatalogRepository().listDiscoveryPage` (same
  visibility, shop scope, effective promotional price and stock), and prices/availability/PDP links come from
  `buildProductCardModel`. "See all" is `buildStorefrontDiscoveryHref`, so it is exactly the `/shop` listing for the query.
- **Bounds:** query 2–80 characters, non-strings and control characters refused (not coerced or truncated), at most 6
  suggestions (page size and a second slice), 1,500 ms ceiling then `UNAVAILABLE`, and a fixed statement count (13
  today, asserted equal for 1 and 7 results and under a ceiling of 16).
- **Leak check:** the response carries slug, name, PDP path, trusted image, formatted price text and an availability
  word. A test asserts no internal variant id, vendor variation id, raw price or stock count is serialized.
- **Failure shape:** a thrown catalog error or a timeout becomes `{ ok: false, reason: "UNAVAILABLE" }`; the message never
  reaches the browser.
- **Verified locally** (PostgreSQL 16): `pnpm lint` 0 errors, `pnpm typecheck`, `pnpm test` 1862/1862 (19 new),
  `tests/database/search-suggestions.test.ts` 6/6, `pnpm build`.
- **Not claimed:** no browser, keyboard or axe run, because no UI changed. Those belong to C05.
- **Known residual before enabling (B07):** the suggestion action has no dedicated rate limit. It is the same read and
  the same exposure as `GET /shop?q=`, which has none either; add one when C05 puts it behind an input.

## C02 — headless PLP filter interaction

- **What shipped:** `plp-filter-model.ts` (pure reducer for a collapsible filter panel, active-filter count, chip-removal
  focus target, result announcement), `use-plp-filter-disclosure.ts` (media query, focus, Escape wiring) and a brand
  adapter `ListingFilterRegion`. Wired into `/shop` only behind `SHOP_FILTER_DISCLOSURE_ENABLED`.
- **No second authority:** the model never builds an href, parses a query, sorts or prices. Chips are the route's own
  `activeFilters` links (`buildShopActiveFilters`), so removing one keeps the others and resets the page exactly as before.
  Sort is not counted as a filter (asserted). Copy lives in the brand adapter, not the headless model.
- **Progressive enhancement:** before the client measures the viewport the panel is visible and there is no button; the
  button and the collapse appear only below the brand's breakpoint (`(min-width: 1024px)` in the default brand).
- **Verified in Chromium** (local, PostgreSQL 16, dev server with the flag ON): 390×844 collapsed → opens to the first
  field → axe clean both states; Escape returns focus to the trigger; applying closes the panel, labels `Bộ lọc, 1 đang áp dụng`
  and updates the status text; keyboard chip removal keeps other filters and focuses the next chip, and the last chip focuses
  the trigger; 768×1024 still collapsed, 1440×900 open with no trigger, no horizontal overflow; the server HTML for a
  no-script client has the open form and no `aria-expanded` button. The unmodified `discovery.spec.ts` (flag OFF) passes.
- **Finding, not caused by this change:** `/shop` streams behind `loading.tsx`, so with scripting disabled the page
  content stays in a hidden streaming container until a script reveals it. That is true with this flag off or on. The
  no-script check therefore asserts the HTML the server sends, not a script-disabled render. It is worth its own task.
- **Not claimed:** no real-device or screen-reader run; the live region and focus order are exercised with Playwright and axe only.
