# Product-image delivery: evidence and measurement plan (A/B/C task B10)

- **Status:** **EVIDENCE PLAN — no decision.** B10 requires comparable real-image measurements and a security design review. Neither has been done, and this document does not claim a result. B11 stays blocked (gate G5).
- **Date:** 2026-10-18
- **Plan task:** B10 in [`tasks/core-kit-reusable-a-b-c-v1-plan.md`](../../tasks/core-kit-reusable-a-b-c-v1-plan.md).

## Current delivery, as implemented (read from `main`)

| Property | Fact | Source |
| --- | --- | --- |
| Trusted origin | Exactly `https://content.pancake.vn`; no other host, no userinfo, no custom port, no traversal | `docs/integrations/trusted-product-media-contract.md`, `src/commerce/product-media.ts` |
| Path shape | `/:segment/:id/:id/:id/:file.(jpg\|png\|webp)`, 5 segments | same |
| Fetching | **None server-side.** The resolver is a pure validator; there is no proxy and no outbound image fetch, so no SSRF surface | contract §8 |
| Rendering | `next/image` with `remotePatterns` for the same host and the three extensions; PDP `sizes="(min-width: 1024px) 50vw, 100vw"`, cards `sizes="(min-width: 1024px) 25vw, 50vw"`, thumbnails `64px` | `next.config.mjs`, `product-gallery.tsx`, `product-card.tsx` |
| Browser policy | CSP `img-src 'self' blob: data: https://content.pancake.vn` (plus the pixel host when configured) | `next.config.mjs` |
| Bounds | At most 100 candidates scanned and 12 gallery images per product | contract |
| Fallback | A placeholder panel when no trusted photography exists | `product-gallery.tsx` |

So Core Kit already serves responsive, format-negotiated images through the framework's optimizer from one reviewed origin, with no code that fetches a URL on a shopper's behalf. A bounded image endpoint (B11) would **add** an outbound-fetch surface that does not exist today.

## What is not known

No measurement exists of: bytes transferred and decode time per hero/card/thumbnail on a mid-range phone profile; LCP of the PDP and `/shop` with real catalog images; the origin's own sizes and formats; optimizer cache hit rate or CPU on the VPS; or any shopper-visible failure attributable to delivery. Without those there is no "specific verified delivery bottleneck" (the B10 acceptance wording) to justify B11. This sandbox cannot reach the CDN, so it cannot produce them.

## Measurement plan (to run where the real catalog and CDN are reachable)

1. Pick 10 representative products (primary + 3–5 gallery images each) from the live catalog; record origin file sizes, dimensions and formats.
2. For `/shop` (24 cards) and a multi-image PDP, record with a throttled mobile profile (e.g. 4× CPU, Slow 4G) over ≥5 cold and ≥5 warm runs: LCP element and time, total image bytes, number of image requests, and decode/long-task time. Record the optimizer's cache status per request and server CPU during the run.
3. Compare with the same pages using unoptimized origin URLs, to separate "the optimizer helps" from "the origin is the bottleneck".
4. Write the numbers into this file with the date, build SHA and environment.

## Decision rule (proposed)

- If LCP and image bytes meet the budget the owner sets (the owner owns the budget; none is recorded), **B11 is SKIPPED with no code**.
- Only if a named bottleneck is shown that `next/image`, `sizes`, preload or a different origin size cannot fix does B11 proceed, and only after a security design covering: a fixed origin allow-list (no request-supplied host), redirect refusal, content-type and magic-byte checks, source and output byte caps, pixel and dimension caps, a closed set of output widths and formats (bounded cache-key space), per-IP and global rate limits, timeouts, and a measured CPU/bandwidth budget — plus feature-OFF fallback to today's delivery.

## Decision record (to be filled by the owner)

- [ ] Measurements recorded above; existing delivery sufficient → B11 SKIPPED
- [ ] Measurements recorded above; bottleneck shown → security design review, then B11
- Decided by / date / link: ______
