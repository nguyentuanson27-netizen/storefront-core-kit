# Phase G — full regression and the discardability exercise

Phase G runs no feature work. Task 34 is the whole verification suite on a clean environment; Tasks
35A–D throw the presentation layer away in a temporary worktree and rebuild it from the public
contracts, to find out whether the architecture's central claim is true. What follows is what the
work turned up.

## 1. What the exercise was actually testing

Spec 04 says a brand fork rewrites `src/app/**/page.tsx`, `src/app/globals.css` and
`src/components/brand/**`, and nothing else. That is a claim with a sharp failure mode: if a redraw
has to reach into `src/commerce`, `src/routes` or `src/components/headless` even once, the seam is
in the wrong place and every future fork pays for it.

So the exercise was run as a measurement, not a demonstration. A baseline of tree hashes for every
shared directory was recorded before anything was touched, and the pass criterion was a **zero-file
diff** across all of them afterwards — not "it looked fine".

## 2. Result: the claim holds

A complete second brand was written: all 19 storefront pages, a new stylesheet with no token carried
over from brand 1, and 6 of the 9 brand components rewritten from scratch (radio-group selectors
instead of button rows, a stacked gallery instead of a thumbnail strip, a flat bordered card, an
inline cart row, monospace type on a warm ground).

| measure | result |
| --- | --- |
| presentation files changed | **26** |
| shared-layer files changed | **0** |
| `tsc --noEmit` | clean |
| `eslint .` | 0 errors, 12 pre-existing warnings |
| `test:domain` | **1629/1629** |

The shared set held to zero covers `src/commerce`, `src/routes`, `src/components/headless`,
`src/seo`, `src/db`, `src/auth`, `src/integrations`, `src/tracking`, `src/content`,
`src/operations`, `prisma`, `scripts`, `.github`, `package.json`, `pnpm-lock.yaml`, `tsconfig.json`
and `tests`.

Three brand components needed no rewrite at all, which is the right answer rather than a gap:
`guest-checkout-form.tsx` and `guest-order-tracking-form.tsx` are deliberate adapters over one
workflow each (T18/T30), and `commerce-event-reporter.tsx` is a thin mount. A brand restyles the
shared form; it does not fork the workflow.

The route shell did its job silently throughout. Promotion refresh, the commerce event, JSON-LD and
the Meta pixel events are mounted by `StorefrontRoute`, so a redrawn page cannot drop them by
forgetting — no redrawn page mentions any of them.

## 3. Findings

### 3.1 Required — shared tests regex-match brand source

`tests/domain/selection-gallery-seam.test.ts` asserts the **source text** of
`src/components/brand/purchase-panel.tsx` and `src/components/brand/product-gallery.tsx`:

```ts
assert.match(source, /export function PurchasePanelView\(\{ controller \}/, …);
assert.match(source, /Omit<GalleryModelInput, "manualSelection">/);
```

Both files are designated per-brand throwaway. The redraw was semantically correct and still failed
`test:domain` twice — once for putting the destructure on its own line, once for writing
`GalleryModelInput` where the test wanted the `Omit<…>` spelling. Conforming to both was a
formatting change with no behavioural content, after which the suite was 1629/1629.

The contracts these tests defend are real and worth keeping: a panel must be able to render a
controller it does not own (or a page cannot drive panel and gallery from one selection), and the
gallery must not accept a `manualSelection` it immediately overwrites. What is wrong is the
enforcement: a text match on a file the architecture promises a brand may rewrite freely turns a
formatting choice into a test failure, and the next brand hits it exactly as this exercise did.

The fix belongs in the shared tree, not in a brand: express both as **type-level** obligations that
a redraw satisfies by compiling — for example a `satisfies` check that `PurchasePanelView` accepts
`{ controller: VariantSelectionController }`, and typing the brand gallery's props as the `Omit<…>`
in the headless module so the constraint is inherited rather than re-spelled. Reported rather than
changed here: Phase G merges no code, and this is a seam fix, not an exercise workaround.

### 3.2 Minor — one route exports no props type

`src/routes/collections.ts` exports `CollectionsRouteData` and `loadCollectionsRoute` but no
`CollectionsRouteProps`. It is alone in this: the other **18 of 19** routes export their own props
type. Both the shipped page and the exercise's redraw had to re-declare the shape by hand, which is
a small tax on every fork and an easy place to get `searchParams` subtly wrong.

Not a blocker — the redraw worked — and not fixed here for the same reason as 3.1.

### 3.3 Minor — the deployment template omits four `LA_*` variables

Writing the README's configuration section for T35D surfaced this. The app reads ten `LA_*`
variables; `deploy/vps/env.example` carries six — the shipping and merchant-feed values. Missing:

```
LA_TRACKING_MODE  LA_BUILD_FACEBOOK_PIXEL_ID  LA_GTM_CONTAINER_ID  LA_PROMOTION_ACTIVATION_ENABLED
```

All four have safe defaults, so nothing breaks; an operator deploying from the template simply
never learns they exist, and a fork that wants a pixel or GTM container has to find them in source.
The fix is four placeholder lines in `deploy/vps/env.example`. Not made here — Phase G merges no
configuration — and the README now states the gap rather than implying the template is complete.

### 3.4 Not a finding, recorded so it is not re-derived

`resolveGalleryModel` returns `activeImage: TrustedProductImage | null`, and the first draft of the
redrawn gallery assumed it non-null. The type caught it immediately. That is the seam working:
a nullable field that a brand must handle is exactly what belongs in the public shape.

## 4. Task 34 verification

Run on a dropped-and-remigrated database, with the environment each suite expects.

| gate | result |
| --- | --- |
| `pnpm lint` | 0 errors, 12 pre-existing warnings |
| `pnpm typecheck` | clean |
| `pnpm test` | **1754/1754** |
| `pnpm test:db` | **433/433** |
| `pnpm build` | exit 0 |
| `pnpm release:check` | `ok: true` |
| `pnpm money:audit` | exit 0 |
| `pnpm merchant:identity:audit` | exit 0 |
| `pnpm sitemap:capacity:audit` | exit 0 |

Playwright, the full 91-test configuration (both projects, admin desktop and mobile) against the
environment the CI admin job uses: **89 passed, 2 failed**.

Both failures were `evergreen-pages.spec.ts` — the footer-reachability walk and the size-guide
render — and both were 120-second timeouts (`waitForURL` never resolving, then
`net::ERR_ABORTED; maybe frame was detached?`), not assertion failures. The cause was mine: the
exercise's typecheck and its 1629-test domain suite were running on the same container at the same
time, and each Playwright spec boots its own Next dev server. Re-run alone, the spec is **6/6 in
25 seconds**. Recorded rather than quietly re-run: a suite that is this sensitive to a loaded
machine will produce the same two failures for the next person who runs something alongside it.

`release:check` needs the release environment to be complete — `PANCAKE_API_KEY`, and an
`APP_DOMAIN` matching the production domain in `project.config.json`. Two runs failed on a partial
local environment before the third, correctly configured, returned `ok: true`. Worth recording: the
failure mode is a configuration error that reads like a regression.

The manual checks the plan lists — a COD order reaching Pancake, Purchase deduplication against the
Conversions API, Rich Results validation — need live credentials this environment does not have.
They are not claimed here.

## 5. Still open

- **3.1, 3.2 and 3.3 above**, all deliberately unfixed.
- The carry-forwards from Phase E stand: the root layout is outside the boundary by approved
  exception (spec 04 §8.1, plan Task 36), checkout's buyer copy has no targeted language test, and
  `flash-sale-freshness.spec.ts` waits a fixed 500 ms for hydration instead of a signal.
