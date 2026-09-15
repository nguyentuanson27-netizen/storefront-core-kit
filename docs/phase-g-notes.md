# Phase G — Full regression and the discardability exercise

## 1. T34 — full regression

Run on `07ac893` (Phase F merged), with the environment CI itself uses.

| gate | result |
| --- | --- |
| `pnpm lint` | 0 errors, 12 warnings (all pre-existing `_`-prefixed unused vars) |
| `pnpm typecheck` | clean |
| `pnpm test` | **1696 / 1696** |
| `pnpm test:db` | **433 / 433** |
| `pnpm build` | succeeded |
| `pnpm release:check` | `ok: true` |
| `pnpm money:audit` | exit 0 |
| `pnpm merchant:identity:audit` | exit 0 |
| `pnpm sitemap:capacity:audit` | exit 0 |
| Playwright, full config | **91 / 91** |

**No Core Kit regression was found, so no code was changed by T34.**

### What the earlier phases had been calling "known environment failures"

Phases D–F carried four `test:db` failures and one admin Playwright failure as environment noise.
Phase G's "clean environment" requirement forced them to be resolved rather than annotated, and none
of them were what they looked like:

| symptom | actual cause |
| --- | --- |
| `auth-runtime.test.ts` fails to load | `BETTER_AUTH_SECRET` was never exported locally. CI sets it. |
| `U2 homepage positions` | a `CollectionDefinition` row left by `editorial.spec.ts` was squatting homepage slot 1, which that test owns |
| `P12 sitemap`, `W21 capacity` | the same leftover rows |
| `admin-promotions` U14 P5b | `PANCAKE_SHOP_ID` was not exported for the Playwright run; the spec seeds its fixture under shop `920942` and inherits the variable from the environment |

All five pass once the environment matches CI. One false trail worth recording: the auth tables
looked absent because `pg_tables` has no `"User"` — Prisma `@@map`s them to lowercase `user` and
`session`, and the migration that creates them has always been applied.

Two audit outputs read alarming and are not:

- `merchant:identity:audit` prints `durability.verdict: "BLOCKED"`. That is a **hardcoded constant**
  in `src/commerce/merchant-identity-audit.ts` — `upstreamLifetimeProven` is `false` until upstream
  lifetime is proven, which is outside this repo. Exit code is 0 and this is the expected baseline.
- `money:audit` is byte-identical to the pre-Phase-D baseline, but the local mirror is empty, so it
  proves nothing regressed rather than that the money paths were exercised.

`release:check` needs `PANCAKE_API_KEY` present. `validateReleaseEnvironment` performs **no network
call** — it only checks configuration is present — so a placeholder satisfies it honestly.

## 2. T35A–C — the discardability exercise

Run in a throwaway git worktree on branch `exercise/brand-two-redraw`, never merged, now deleted.

**Reset (T35A).** 19 storefront `page.tsx`, `src/app/globals.css` and all 8 `src/components/brand/**`
files were deleted. Admin pages were left untouched. A tree-object hash of every shared directory
was recorded before the reset and compared after every step.

**Redraw (T35B–C).** 811 lines of brand #2 presentation were written from nothing — a dark palette,
different layout, different component structure — against the public contracts only.

**Result: 9 of 19 storefront pages redrew cleanly. Shared-tree diff stayed 0 at every checkpoint.**

| | pages |
| --- | --- |
| Redrew through public seams | `/`, `/shop`, `/shop/[slug]`, `/collections`, `/collections/[slug]`, `/flash-sale`, `/lookbook`, `/search`, `/new-arrivals` |
| Could not be redrawn | `/cart`, `/checkout`, `/checkout/success`, `/about`, `/contact`, `/shipping`, `/returns`, `/size-guide`, `/track-order`, `/account` |

For the seven migrated routes this is a genuine proof: the loader, the route shell, the canonical
metadata builders, the headless models and the selection→gallery controller were all consumed
unchanged. `useVariantSelection` drove a completely different panel and a completely different
gallery. No shared file was edited to make any of it work.

## 3. Findings

Per the exercise's own rule, these are reported rather than worked around. **Neither was fixed in
this PR**; both are seam work, not regressions.

### Finding 1 — ten routes have no loader, so their presentation is not yet replaceable

Tasks 26–32 were never run: ten storefront routes still reach `@/commerce`, `@/db`, `@/seo`,
`@/content`, `next/server` and the transitional `@/components/commerce` shims directly. A brand
cannot redraw them without either editing shared layers or writing new loaders under `src/routes`,
which is itself a shared layer.

The four `tests/domain` failures the exercise produced (`route-boundary`, two `route-manifest`
checks, `metadata mode`) are the *measurement* of this gap, not defects: the manifest declares 19
pages and the exercise could only rebuild 9.

Grouped by what each needs:

- **`/about`, `/contact`, `/shipping`, `/returns`, `/size-guide`** — a shared static-page loader and
  metadata builder; they differ only in content. One loader would cover all five.
- **`/cart`, `/checkout`, `/checkout/success`** — real loaders (cart lines, quote proof, purchase
  snapshot) plus funnel tracking through the shell.
- **`/track-order`, `/account`** — only a brand adapter and a metadata builder; the smallest of the ten.

### Finding 2 — three dead shims invert the seam

`src/components/commerce/product-purchase-panel.tsx`, `product-gallery.tsx` and
`storefront-product-card.tsx` have **no importers left** — every route that used them was migrated in
Phase E. They still `import` from `@/components/brand/*`, so a *shared* module depends on the
*discardable* one. Deleting the brand layer breaks typecheck through files nothing renders.

That is backwards: it makes the brand layer discardable in content but not in its module interface,
and the constraint is undocumented and only discoverable by breaking the build. Deleting the three
files removes it. `cart-line-controls.tsx` and `account/account-auth-panel.tsx` have the same shape
but are still imported by `/cart` and `/account`, so they go when Finding 1 does.

## 4. What Phase G changed

Documentation only: this file and the Core Kit section of `README.md`. No source file, test, schema,
migration or dependency was touched, and the exercise was discarded in full.
