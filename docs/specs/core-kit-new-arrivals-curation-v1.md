# Core Kit curated New Arrivals v1 — GB1 child specification

**Status:** OWNER PAGE/UX POLICY APPROVED on 2026-10-18; **technical review ACCEPTED 2026-10-18** (see the `-technical-review` document); **migration review pending**. GB1 is not automatically completed by this draft, and **G3 stays blocked** until the specific additive persistence/SQL design is reviewed.
**Parents:** [A/B/C umbrella spec](./core-kit-reusable-capabilities-a-b-c-v1.md) (`5/B1), [plan B01–B03](../../tasks/core-kit-reusable-a-b-c-v1-plan.md), [owner decision](../approvals/core-kit-a-b-c-owner-decisions-2026-10-18.md).

## 1. Owner-approved decisions

| Contract | Required v1 behavior |
| --- | --- |
| `pageSize` | **24 curated positions/page**, positive and finite |
| Maximum curated selection | **500** stored product IDs per shop; reject larger admin writes |
| Ordering | Atomic administrator-defined **stable manual position**; deterministic across pages |
| URLs | `/new-arrivals` for page 1; `/new-arrivals?page=N` for positive subsequent pages |
| Invalid/out-of-range page | **HTTP 404** (not redirect or unbounded read) |
| OFF | Preserve current editorial-only view model, frame, metadata and route shell; **zero curated-listing DB reads** |
| ON + zero selection | Editorial frame plus visible, screen-reader-accessible empty-list `role=status`/equivalent; **zero product cards**, no redirect/backfill |
| ON + saved selection | Canonical `/shop` catalog visibility, promotion-aware effective price, availability, safe media and canonical PDP link |
| Unavailable/hidden/stale item | Suppress the item on its stored-position page **without filling the hole from later positions** |
| Feature rollout | Default OFF; migration + child-spec review needed before B01 implementation |

## 2. Pagination and empty semantics

Persist each shop's manual selection as an ordered set of stable product IDs. Compute `totalPages = ceil(selectionCount / 24)` from **stored slots**, bounded by max 500 (at most 21 pages); for empty selection render page 1 as the editorial+empty state, and 404 later pages.

First slice the stable saved positions for the requested page, **then** hydrate only those products through existing canonical shop/catalog pricing and availability authority. Skip hidden/unpublished/missing items in place. **Never compact across page boundaries, backfill from `createdAt` or another collection, reorder by item name, or silently substitute a missing item.** A page containing only hidden selections may show accessible empty-list status even though more saved positions exist on other pages; pagination still reflects saved slots.

Page 1's canonical URL is `/new-arrivals`; non-first pages use `?page=N`. Reject page <= 0, non-integers, unsafe or oversized values, extra ambiguous page values, and page numbers beyond `totalPages` as 404. Keep unrelated canonical `/shop` search/filter/order URLs unchanged. Precise parser bounds and metadata/canonical/indexation implementations must be reviewed with the route owner before B03; this document authorizes no new SEO default beyond the approved path/page grammar.

## 3. Curation admin/persistence boundaries

- B01: atomic ordered membership per shop, unique product identity and position, max 500, deterministic reorder; no use of ProductMirror creation time as curation. Read/write visibility and SKU mapping must be shop-safe; Pancake sync cannot overwrite admin order.
- B02: only existing authenticated admin server mutations can create, remove and reorder curated products; validate product membership, shop, IDs and size; reject conflicting/concurrent writes safely. No direct client-trusted curation order.
- B03: separate flagged read model for `/new-arrivals` using the same publication, price, stock, PDP card projections, route refresh and observability authority as `/shop`, **not** an alternative discovery/sort/filter engine.
- **G3 still required before any B01 schema/migration/repository implementation:** additive Prisma/SQL proposal with FK/unique/check strategy, old/new writer coexistence and rollback, actual DB tests and reviewed deployment order. This child contract does **not** approve any schema diff.

## 4. Future acceptance and verification

1. **Boundaries:** selections 0 / 1 / 23 / 24 / 25 / 49 / 500 / 501; max 500 accepted, 501 rejected. Page 1/2/3 order for 25, 49, and 500; no repeated/missing valid item across pages.
2. **Visibility:** invalid/hidden item among page slots never auto-refills; empty page with hidden-only slots retains editorial frame/status; no privacy leak or alternate product. Out-of-range, negative, zero, fractional, duplicate, enormous or malformed page => 404.
3. **Feature flag:** OFF route content/metadata and query count unchanged; ON + zero selection has accessible empty state and zero product cards; no fallback from `createdAt`.
4. **Parity:** ON product cards use shop-effective prices, visibility/stock, safe media, canonical PDP links and analytics; catalog price/rules change without creating stale second authority.
5. **Admin/concurrency:** auth+shop scope, atomic reorder, max selection enforcement, duplicate/conflicting edits, mixed old/new readers and migration rollback tested.
6. **Runtime:** `pnpm test:domain`, `pnpm test:db`, `pnpm lint`, `pnpm typecheck`, `pnpm build` and responsive keyboard/axe at 390×844, 768 and 1440px on exact implementation commit.

## 5. Gate accounting

**Owner option A is accepted** for `pageSize=24`, max=500, page grammar, 404 invalid, stable ordered slots and visible empty behavior. **GB1 technical review is pending**, **G3 concrete migration approval is pending**; neither B01 repository implementation nor new SQL is authorized by selecting these policies. No code/DB/production changes in this document.
