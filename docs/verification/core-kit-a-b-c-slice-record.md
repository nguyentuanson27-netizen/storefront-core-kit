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
| G1 / F01 — benefit quote contract | A01–A10, C04 | **Owner option A policy APPROVED; technical child-spec review PENDING** | [Owner decision](../approvals/core-kit-a-b-c-owner-decisions-2026-10-18.md), [F01 draft](../specs/core-kit-benefit-quote-v1.md). Exact legacy-overlap predicate and technical review still block implementation |
| G2 — controlled Pancake readback of 0-VND gift, same-variation PAID+GIFT, differently priced PAID rows | A08 (and so A09, A10, C04) | **BLOCKED — no controlled POS evidence** | Approved test-environment readback evidence per enabled use case |
| G3 — additive migration and old/new code coexistence | A02, A06, B01, B04, B05, B06; B09 only if reopened | **Additive DESIGN DIRECTION approved; concrete migrations remain BLOCKED** | [Owner decision](../approvals/core-kit-a-b-c-owner-decisions-2026-10-18.md). Each real schema/SQL diff, rollback, coexistence and tests require separate review |
| GB1 — curated arrivals contract | B01, B03 | **Owner option A accepted (`pageSize=24`, max 500); technical child-spec review and G3 still BLOCKED** | [B1 draft](../specs/core-kit-new-arrivals-curation-v1.md); [owner decision](../approvals/core-kit-a-b-c-owner-decisions-2026-10-18.md) |
| G4 — category vs collections | B08 → B09 | **OWNER ACCEPTED 2026-10-18: KEEP collections, B09 SKIPPED** | [ADR 0010](../decisions/0010-category-taxonomy-vs-collections.md); no new taxonomy implementation |
| G5 — image delivery measurement and security decision | B10 → B11 | **BLOCKED — needs comparable real-image measurement** | Measurements plus security design review |

Tasks with no unmet gate and no schema change: **B07, C01, C02, C03, C05** (after B07). These are built first.
A05 pure eligibility now has an **owner-approved v1 stacking direction**, but the precise conflict predicate and the F01 technical child-spec review remain pending. A05 therefore stays gated on G1; policy approval alone is not a verified implementation.

## Owner approval record — 2026-10-18

The owner explicitly selected **option A for all four choices**. [Approval record](../approvals/core-kit-a-b-c-owner-decisions-2026-10-18.md) keeps these scopes distinct: F01 and GB1 owner policies are accepted but technical child-spec review is pending; G3 approved drafting additive designs **only**, not specific migration SQL; G4 accepts [ADR 0010](../decisions/0010-category-taxonomy-vs-collections.md) and skips B09. G2 (Pancake readback) and G5 (real-CDN measurements/security) remain BLOCKED. This is a documentation update — no runtime test, POS write, DB migration or production flag enablement was performed for these approvals.

## Slice log

Each entry: task, PR, merged SHA, CI result on the exact head, flag(s) and default, OFF compatibility, rollback.

| Task | PR | Merged SHA | Exact-head CI | Flag (default) | OFF compatibility | Rollback |
| --- | --- | --- | --- | --- | --- | --- |
| F00 | #28 | `81438ef` | 13/13 checks success on `51bdd46` | — | no code change | revert the PR |
| B07 | #29 | `75e69b4` | 15/15 checks success on `fab04ba` | `SEARCH_SUGGESTIONS_ENABLED` (OFF) | flag OFF returns `DISABLED` before validation or any catalog statement (asserted at 0 statements); `/search`, `/shop` untouched | set the flag `false` and recreate `app`; no migration |
| C02 | #30 | `26bce5a` | 15/15 checks success on `aa6d6c5` | `SHOP_FILTER_DISCLOSURE_ENABLED` (OFF) | flag OFF renders the unchanged always-open form; the unmodified `discovery.spec.ts` passes against an OFF server | set the flag `false` and recreate `app`; no migration |
| C01 | #31 | `ca8dceb` | 15/15 checks success on `9c82d26` | `PDP_MOBILE_INTERACTIONS_ENABLED` (OFF) | flag OFF renders the unchanged gallery and detail; unmodified `pdp-promotion`, `storefront-media`, `variant-deep-link` specs pass against an OFF server | set the flag `false` and recreate `app`; no migration |
| C03 | #32 | `ebe7197` | 15/15 checks success on `05215fd` | `CART_DRAWER_ENABLED` (OFF) | flag OFF renders the plain header link; the server action answers `null` without a database read; unmodified cart/footer/not-found specs pass against an OFF server | set the flag `false` and recreate `app`; no migration |
| C05 | #33 | `ec57980` | 15/15 checks success on `31c67f3` | `SEARCH_OVERLAY_ENABLED` (OFF; needs `SEARCH_SUGGESTIONS_ENABLED`) | flag OFF renders plain `/search` links; unmodified `editorial` and `evergreen-pages` specs pass against an OFF server | set either flag `false` and recreate `app`; no migration |
| Review fixes (#29–#32) | #36 | _recorded after merge_ | _recorded after CI_ | none new | all five flags still default OFF; no migration; flag-OFF specs unchanged | revert the PR; the fixes are independent of each other |

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

## C01 — mobile PDP interactions

- **What shipped:** `pdp-mobile-interaction-model.ts` (pure): non-wrapping gallery step, key map (arrows/Home/End), swipe
  classifier (48px, 1.5× horizontal dominance, 800ms), purchase CTA state (`none|pending|choose|unavailable|preorder|ready`
  with `missing` options in the panel's own order) and sticky-bar visibility. Hooks wire pointer/key/media-query/IntersectionObserver.
  Brand: previous/next buttons and a polite "Ảnh n trên N" status on the carousel, and `PdpStickyPurchaseBar` below 1024px.
- **No parallel business truth:** price text is the panel's `priceDisplay`; the bar's action is the panel's own `addToBag`; the CTA
  state reads `resolveVariantSelectionView` output (`canAdd`, `selectedUnavailableReason`, `preorderMessage`). Nothing computes money.
- **Server never sends the bar** (asserted on the HTML); it appears after the client measures the viewport and the panel has left it.
  The bar's add feedback is `aria-hidden`; the panel's live region is the single announcement (asserted: exactly one status carries it).
- **Finding:** the default panel disables combinations that cannot be bought (Black+L at stock 0), so the `unavailable` CTA state is
  unreachable through the default UI; it is covered at the model level and stays for brands whose panels allow selecting them.
- **Known tradeoff:** the fixed bar covers ~70px at the bottom while it is showing, including over the footer after the panel is scrolled past.
- **Verified in Chromium** (local, PostgreSQL 16): axe clean with the bar showing at 390×844 and 768×1024 and without it at 1440×900;
  no horizontal overflow; "Chọn màu" moves focus to the first colour and hides the bar over the real panel; adding from the bar adds via
  the panel's action; Home/End/arrow keys and a touch swipe move the gallery without wrapping and a vertical drag does not.
- **Not claimed:** no real touch device or screen reader; swipe is synthesized pointer events.

## C03 — cart drawer (read-only)

- **Scope decision:** v1 is a read-only summary. The plan's "stale/double mutations do not lose buyer data" is met by not mutating:
  quantity edits stay on `/cart`, where the canonical cart mutation and its feedback live. Editing in the drawer would be a separate
  slice and must reuse `useCartLine`.
- **No money recalculation:** `buildCartDrawerView(buildCartViewModel(lines))` passes the route's own line prices, availability words,
  subtotal and `canCheckout` through (asserted equal to the cart model's), and drops the internal `variantId` and the tracking flag.
- **State rules** (`cart-drawer-model.ts`, pure): every open starts `loading` with no view, so the previous contents are never shown as
  current; a response for an older open or after close is dropped; a second open while loading is ignored; a failed read retries in
  place; a `null` result (capability off) is an error state, not an empty cart.
- **Findings from the browser run, both fixed in this PR:** (1) the dialog rendered inside the header's utility `<nav>` and inherited
  `.utility-nav a:not(:last-child){display:none}` on narrow viewports, hiding its own links — it is now portaled to `document.body`;
  (2) axe flagged the black "Thanh toán" button (global `a` colour beat the Tailwind utility; contrast 1.11:1) — fixed with `text-white!`.
- **Verified in Chromium** (local, PostgreSQL 16, dev server flag ON): server HTML has a plain `/cart` link and no dialog; empty cart opens
  focused on the dialog, Escape closes and returns focus to the link, page scroll restored; a cart line shows the same subtotal digits the
  `/cart` HTML contains; Tab and Shift+Tab cycle 8 presses each without leaving the dialog; close restores focus and a link inside closes
  the drawer; Ctrl-click opens a new tab and no dialog; 390×844 and 1440×900 axe clean with no horizontal overflow.
- **Not claimed:** no screen reader; the drawer is not opened automatically after add-to-cart.

## C05 — search overlay

- **What shipped:** `search-overlay-model.ts` (pure): open/close, input status (`short|loading|ready|empty|error`), request-id and
  text sequencing, arrow-key map between the field and the suggestions, announcement. `use-search-overlay.ts`: 200 ms debounce, the
  B07 server action, focus, Escape, Tab trap, scroll lock. Brand `SearchOverlayTrigger` (dialog portaled to `document.body`).
- **Consumes B07 unchanged:** the overlay renders `SearchSuggestionsModel` as given (card price text, availability, PDP path, true
  total, canonical see-all href) and decides no price or URL. The field is a real `<form action="/shop" method="get">`.
- **Stale-answer rule, proven in the browser:** the first server action is delayed 2 s while a second, shorter query is answered
  immediately; after the slow answer arrives the list still shows the second query's single result.
- **Entry points:** the utility bar link is hidden below 1024px by the existing header CSS, so the trigger is also wired into the
  Menu disclosure's search link; both are plain links to `/search` without scripting.
- **Flag coupling:** `readSearchOverlayEnabled` requires `SEARCH_SUGGESTIONS_ENABLED` too, so the overlay can never open onto `DISABLED`.
- **Verified in Chromium** (local, PostgreSQL 16, both flags on): server HTML has a plain `/search` link and no dialog; open focuses
  the field with a hint and no list; typing shows 6 of 8 matches with "Có 8 sản phẩm phù hợp." and a see-all link to `/shop?q=overlay`,
  inactive products never appear; no match says so and Enter still goes to `/shop?q=…`; ArrowDown/ArrowUp move between field and
  suggestions without wrapping, Escape closes and returns focus; choosing a suggestion lands on its canonical PDP and closes the
  overlay; 14× Tab and 14× Shift+Tab stay inside; Ctrl-click opens a new tab and no dialog; 390×844 and 1440×900 axe clean, no overflow.
- **Not claimed:** no screen reader; not a full ARIA combobox (the suggestions are a labelled list of links reached with arrows).

## Release readiness (as of `main@ec57980`)

**Nothing in this programme is enabled.** Seven slices are merged (F00, B07, C02, C01, C03, C05 plus this record); every behaviour
change ships behind a server-side flag whose default is OFF, so a deployment that sets none of them behaves as before. No migration was
added, so there is nothing to apply or roll back at the database.

| Flag (all default OFF, exact `"true"` only) | Slice | Needs | Residual before production enablement |
| --- | --- | --- | --- |
| `SEARCH_SUGGESTIONS_ENABLED` | B07 | — | no request-rate limit (same exposure as `GET /shop?q=`); time and connections are now bounded in the database (see review fixes); invisible until C05 |
| `SHOP_FILTER_DISCLOSURE_ENABLED` | C02 | — | real-device and screen-reader pass; `/shop` content depends on a script to reveal (pre-existing) |
| `PDP_MOBILE_INTERACTIONS_ENABLED` | C01 | — | real touch device; the bar covers ~70px at the viewport bottom while the shopper is within the product detail (it hides past it) |
| `CART_DRAWER_ENABLED` | C03 | — | screen-reader pass; read-only by design (editing is C03b, not started) |
| `SEARCH_OVERLAY_ENABLED` | C05 | `SEARCH_SUGGESTIONS_ENABLED` | the B07 rate-limit decision; screen-reader pass |

Each flag follows the runbook in [`docs/operations/release-and-rollback.md`](../operations/release-and-rollback.md): set it in
`deploy/vps/.env.production`, recreate `app`, verify the value inside the container, and roll back by setting it `false`. Enabling any
of them is a production change and still needs the owner's explicit approval (gate G6); this record does not grant it.

### What the programme could not do, and why

| Blocked | Reason | The owner's next step |
| --- | --- | --- |
| A01–A10, C04, F01 | F01 child contract (stacking, `lineId`/`laq2`, paid bases, capacity, rollback) is an owner decision; A08 additionally needs controlled Pancake readback (G2) | Approve the F01 child spec; arrange a test-environment Pancake readback for 0-VND gifts and same-variation PAID+GIFT rows |
| B01–B03 | GB1 (finite `pageSize`, pagination, empty-state, ownership) and G3 (additive migration) | Approve the B1 child spec; review the migration design |
| B04, B05, B06 | Each needs new persistence, so G3 | Approve the migration design for the ones wanted |
| B08 → B09 | Owner/architecture decision | Decide in [ADR 0010 (proposed)](../decisions/0010-category-taxonomy-vs-collections.md); recommendation is KEEP collections, which skips B09 |
| B10 → B11 | Needs comparable real-image measurements and a security review; the sandbox cannot reach the CDN | Run the plan in [image-delivery-decision.md](../audits/image-delivery-decision.md); skip B11 unless a bottleneck is shown |

No gate was waived, no checkbox was ticked for a blocked task, and no production system, Pancake order or database outside the
local test instance was touched.

## Review follow-up on #29–#32 (fix PR)

Four required findings and two suggestions from review, fixed in one PR. Each fix has a test that was verified to **fail with the fix
removed** (the fix was temporarily reverted, the test run, then restored), so the tests catch the original defect.

| # | Finding | Fix | Evidence |
| --- | --- | --- | --- |
| #30 (P2) | Removing a filter chip while the collapsed panel was open could move focus to the trigger instead of the next chip: closing the panel asked for trigger focus, and that request landed after the chip focus | `NAVIGATED` takes `restoreFocus`; the hook passes `false` when a chip removal is pending, so the panel closes without a competing focus request. No chip left still falls back to the trigger | domain: `restoreFocus:false` closes with no focus intent, default unchanged; browser: open panel → remove a chip by keyboard → focus stays on the next chip (checked again 500 ms later) and the panel is closed; last chip → trigger |
| #31 (P2) | The sticky bar did not show the Preorder state | The bar shows the panel's own `view.preorderMessage` (the brand preorder label) when the CTA state is `preorder` | browser, with selling modes and preorder on in the test server: a PREORDER option shows `[data-preorder-marker]` equal to the brand label; a ready option shows none |
| #31 (P2) | The bar covered the footer once the shopper scrolled to the bottom | `resolveStickyBarVisible` also requires the product detail region to overlap the viewport minus the bar's height (a second `IntersectionObserver` with a `-80px` bottom margin) | domain: region off-screen → hidden; browser: scroll to the bottom → bar hidden, the last footer link scrolls into view, is focusable and is the element at its own centre point; scrolling back up restores the bar |
| #32 (P2) | Activating the cart link twice in one tick called the server twice although the reducer ignored the second open | A synchronous single-flight guard in the hook (released by the current read's answer or by close; a late answer from a closed read cannot release a newer one) | browser: two `click()` calls before React re-renders → exactly one server action request, the drawer fills; after close, opening again is a second, unblocked read |
| #29 (suggestion) | The 1,500 ms timeout did not cancel the database query | Suggestions read through a dedicated client (`src/db/budgeted-prisma.ts`, `src/db/search-suggestions-prisma.ts`) with Postgres `statement_timeout` 1,500 ms and a pool capped at 4 connections, created on first use. The promotion read inside the discovery page now uses the repository's own client, so the whole read stays inside the budget | DB: a `pg_sleep(3)` is cancelled by Postgres within 2 s with a statement-timeout error, is no longer `active` in `pg_stat_activity` afterwards, the client stays usable, and a 1-connection pool serializes two 0.4 s reads |
| #32 (suggestion) | C03 was ticked although the drawer is read-only | Checklist and runbook now state the read-only scope; the "stale/double mutations" acceptance line is **unticked** (it has no subject until the drawer can mutate); quantity editing is tracked as **C03b**, not started | `tasks/core-kit-reusable-a-b-c-v1-todo.md`, `docs/operations/release-and-rollback.md` |

What the #29 change does **not** do: it bounds how long and how many connections a suggestion read can use. It is not a request-rate
limit, and the residual in the release table stands until one is decided.

Verified locally (PostgreSQL 16 reset to a clean database, Chromium): `pnpm lint` 0 errors, `pnpm typecheck`, `pnpm test` 1929/1929,
`pnpm test:db` 490/490, `pnpm build`; the three specs that gained tests (`plp-filter-disclosure`, `pdp-mobile-interactions`,
`cart-drawer`) 25/25; and a regression run of the specs that exercise the changed code with every flag in its default or test-server
state (`discovery`, `pdp-promotion`, `storefront-media`, `variant-deep-link`, `storefront-commerce`, `selling-modes`,
`search-overlay`) 31/31. A first `test:db` run showed three unrelated failures (homepage-position, sitemap, capacity-count); they came from rows
left in the local database by earlier browser runs, and passed after the database was recreated.
