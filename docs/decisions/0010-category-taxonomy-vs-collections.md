# ADR 0010: Category taxonomy versus current collections (A/B/C task B08)

- **Status:** **ACCEPTED — owner decision 2026-10-18.** KEEP collections; defer separate taxonomy. B09 **SKIPPED** until an amended ADR is approved.
- **Date:** 2026-10-18
- **Plan task:** B08 in [`tasks/core-kit-reusable-a-b-c-v1-plan.md`](../../tasks/core-kit-reusable-a-b-c-v1-plan.md); gate G4 in the [checklist](../../tasks/core-kit-reusable-a-b-c-v1-todo.md).
- **Owner decision:** selected option A on 2026-10-18; [decision record](../approvals/core-kit-a-b-c-owner-decisions-2026-10-18.md). Existing SEO/indexation unchanged.

## The question

Does a fresh Core Kit brand need a **separate, navigable product category taxonomy** (spec B3), or do the existing website-owned **collections** plus the `/shop` discovery filters already meet the need? A "yes" unlocks B09 (category identity, membership, routes, sitemap); a "no" or "defer" means B09 is SKIPPED and nothing below changes.

## What exists today (read from `main`)

| Concern | Current authority | Evidence |
| --- | --- | --- |
| Identity | `CollectionDefinition.slug`, a `^[a-z0-9]+(?:-[a-z0-9]+)*$` key, max 48 chars, unique | `prisma/schema.prisma` `model CollectionDefinition`; `src/commerce/collection-definition.ts` |
| Labels and editorial | `title`, `description`, `seoTitle`, `seoDescription`, hero/mobile hero/gallery/video media | same model |
| Membership | `ProductContent.collectionSlugs` (a slug list per product), filtered to published collections | `src/commerce/storefront-catalog.ts` `buildBaseProductFilters` |
| Order inside a collection | `CollectionDefinition.featuredProductSlugs` pins products first | schema comment |
| Homepage placement | `homepagePosition` (unique, 1–6) | `COLLECTION_DEFINITION_LIMITS.homepagePosition` |
| POS link | `pancakeCategoryIds: Int[]` maps a collection to Pancake categories | schema |
| Routes | `/collections`, `/collections/[slug]` (page metadata), both in the route manifest | `src/routes/manifest.ts` |
| Listing filter | `/shop?collection=<slug>` through the one discovery parser, with the same published-collection guard | `src/commerce/storefront-discovery.ts`, `collection-discovery-url.ts` |
| Navigation | brand config, not data | `src/brand/navigation.config.ts` |

Collections already carry stable keys, editorial copy, SEO fields, ordered pinning, published state, a canonical listing URL and a POS category link. They are **not** hierarchical: a product has a flat list of slugs and a collection has no parent.

## What a taxonomy would add

Only two things the above cannot express: (1) a **hierarchy** (parent/child, breadcrumbs, a category's ancestors in the path), and (2) a **separation of "navigable category" from "editorial collection"** so a brand can have, say, a flat merchandising campaign and a tree-shaped catalog at once. Anything else — a stable key, a label, SEO copy, membership, order, a listing URL — collections already do.

## Accepted decision: KEEP collections; defer taxonomy

**KEEP collections; DEFER a separate taxonomy.** Owner approved this direction. Reasons:

1. No concrete Core Kit brand requirement for hierarchy has been recorded. The spec itself says "first decide if a separate taxonomy is required" and forbids silently promoting La.Na's categories.
2. A second membership model beside `ProductContent.collectionSlugs` is a second authority over which products appear where, with its own orphan, duplicate-path and sitemap rules (spec B3 validation list). That cost is real and the benefit is currently hypothetical.
3. B09 needs a schema migration, which is gate G3 and is not approved.
4. The decision is cheap to reverse in this direction: adding a taxonomy later is additive; removing a shipped one is not.

**Reopen if** a brand needs any of: nested categories with breadcrumb paths, the same product in a tree and in an unrelated campaign with different ordering, or category pages that must not share a namespace with collections.

## If the decision is later reopened for ADD

The ADR must be amended before B09 starts to state, at least: the owner of a category key; the key and path grammar and its relation to the collection slug namespace (collision rule); whether membership is a new table or reuses `collectionSlugs`; indexation and canonical rules per level; orphan and cycle handling; the sitemap source; and the G3 migration review. None of La.Na's category keys or paths may be copied.

## Consequences of KEEP

- B09 is recorded as **SKIPPED**; no code, schema or route changes.
- `BRAND-ONLY / SKIP` for La.Na's `category.config.ts` stands.
- No change to indexation, sitemap or canonical URLs.

## Decision record (accepted)

- [x] KEEP collections, defer separate taxonomy — **ACCEPTED 2026-10-18**.
- [ ] ADD a separate taxonomy — **NOT APPROVED**; requires amended ADR, SEO review and G3.
- **Evidence:** owner explicitly said “Duyệt A cả 4 mục” on 2026-10-18; exact scope in [decision record](../approvals/core-kit-a-b-c-owner-decisions-2026-10-18.md).
- **Tasks:** G4 decision satisfied, B08 decision completed, B09 **SKIPPED (not implemented)**. No schema, route, navigation, sitemap or runtime changes.
