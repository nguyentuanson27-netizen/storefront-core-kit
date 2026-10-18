# Core Kit curated New Arrivals v1 — GB1 technical review (PROPOSED, for reviewer sign-off)

**Status:** PROPOSAL. Closes nothing by itself. GB1 stays open until a reviewer accepts §1–§4 and links it from the [checklist](../../tasks/core-kit-reusable-a-b-c-v1-todo.md); B01 additionally needs its [G3 proposal](../proposals/g3-additive-migration-proposals.md) approved.
**Child of:** [B1 child spec](./core-kit-new-arrivals-curation-v1.md). Owner values (`pageSize = 24`, max 500, `?page=N`, 404, stored-slot pagination, accessible empty state) are taken as given and **not** reopened.

Grounded in: `src/app/new-arrivals/page.tsx` (editorial route), `src/routes/metadata/new-arrivals.ts`, `src/routes/shop.ts` (`SHOP_PAGE_SIZE = 24`, `notFound()` past the last page), `src/commerce/storefront-discovery.ts` (`parsePage`). No code accompanies this document.

## 1. Constants and page parser

```
NEW_ARRIVALS_PAGE_SIZE   = 24          // owner; equals SHOP_PAGE_SIZE — keep as its own constant
NEW_ARRIVALS_MAX_ITEMS   = 500         // owner
NEW_ARRIVALS_MAX_PAGES   = ceil(500/24) = 21   // derived, never hard-coded
```

Parser (mirror of `/shop`'s `parsePage`, then tightened by the derived bound):

| Input | Result |
| --- | --- |
| absent, or empty string | page 1 |
| `^[1-9][0-9]*$`, safe integer, `≤ 21` | that page |
| `0`, negative, `01`, `1.5`, `1e3`, `+2`, whitespace, non-numeric | 404 |
| `> 21` (including enormous values) | 404 **before any database read** |
| repeated `page` parameter (`?page=2&page=3`) | 404 (no "first wins" ambiguity) |
| other, unrelated query parameters | ignored; never part of the canonical URL |

Past the *actual* last page (`page > max(ceil(selectionCount/24), 1)`) → 404, decided from one bounded count read. `?page=1` is accepted and renders page 1 with canonical `/new-arrivals` (no redirect), matching how `/shop` treats it. Reviewer to confirm that choice (alternative: 404).

## 2. Behavior matrix

| Flag | Selection | Behavior | DB reads |
| --- | --- | --- | --- |
| OFF | any | Current editorial route, frame and metadata **byte-for-byte**; `page` parameter ignored (as today) | **0** curated reads |
| ON | empty | Editorial frame + visible `role="status"` empty text, zero cards; `?page=2+` → 404 | 1 (count) |
| ON | N slots | Slice stored positions for the page, hydrate through the canonical `/shop` catalog repository, drop hidden/missing **in place**; never refill | count + page slice + one batched hydrate |
| ON | page of only hidden slots | 200, editorial frame + empty status; pagination still reflects stored slots | same |

Slicing is by **rank** (`ORDER BY position LIMIT 24 OFFSET (page-1)*24`) over stored slots, so a product deleted from the catalog (FK cascade removes its slot) shifts later slots up by one. Hidden/unpublished products keep their slot and are suppressed at render only. This is the intended reading of "paginate stored positions first, then suppress".

Query budget is bounded by construction: at most 21 pages × 24 ids; hydration reuses the existing batched candidate/promotion reads, so there is **no per-product query** and no second pricing authority. Freshness (`refreshAfterMs`) comes from the same catalog result as `/shop`.

## 3. Metadata, canonical and indexation

Current metadata is title "Hàng mới" + description (`buildNewArrivalsMetadata`). Proposal, applied **only when the flag is ON**:

- Page 1: metadata unchanged; canonical `/new-arrivals`.
- Page N ≥ 2: title `Hàng mới — Trang N`; self-referencing canonical `/new-arrivals?page=N`; description unchanged.
- The sitemap is **not** extended with `?page=N` URLs; `/new-arrivals` stays the only entry.
- Whether pages ≥ 2 are `index` or `noindex` must follow what `/shop` pages ≥ 2 do today. B03 must read `src/routes/metadata/shop.ts` at implementation time and copy that policy; this document introduces no new indexation default.
- OFF metadata is not touched, which keeps the existing SEO and indexation tests valid unmodified.

## 4. Required tests (restating the spec with the numbers fixed)

1. Selection sizes 0, 1, 23, 24, 25, 48, 49, 500; 501 rejected at write (B02).
2. Pages for 25 / 49 / 500: no duplicate and no missing visible item across pages; stable order after reorder.
3. Hidden slot at a page boundary: the hole is **not** filled from the next page.
4. Parser table in §1, including repeated, enormous and malformed values (no DB read for out-of-bound values — assert statement count 0).
5. OFF: response and metadata identical to the current route; statement count 0.
6. ON + empty and ON + only-hidden page: status text present, zero cards, axe clean.
7. Browser: keyboard and axe at 390×844, 768, 1440 for OFF / ON-empty / ON-paginated.
8. Price, availability and PDP link parity with `/shop` for the same product.

## 5. What this closes

| Item | After acceptance |
| --- | --- |
| GB1 technical child-spec review | Closed (parser bounds, metadata/SEO, query budget fixed) |
| G3 for B01 | **Not closed** — see the proposal |
| Implementation | Not started; B01/B02/B03 remain blocked until the above are linked in the checklist |
