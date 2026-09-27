# Spec — Core Kit Production Hardening v1

Status: **IMPLEMENTED (Slices 1, 2, 3, 5) / PARTIALLY DEFERRED (Slice 4).**

- Approved and merged as the specification in nguyentuanson27-netizen/storefront-core-kit#11.
- Implementation evidence: one pull request per slice (nguyentuanson27-netizen/storefront-core-kit#13,
  nguyentuanson27-netizen/storefront-core-kit#14, nguyentuanson27-netizen/storefront-core-kit#15,
  nguyentuanson27-netizen/storefront-core-kit#16), plus nguyentuanson27-netizen/storefront-core-kit#17 for the lifecycle
  gaps found in self-review and owner review. §19 records what each one shipped and how §17 was answered.
- Deferred: Slice 4 (overlay invariant). Core Kit has no real full-viewport overlay yet; §7.4 holds the acceptance contract
  for the first one.
- Out of scope for v1 and not implemented: automatic reconciliation of `SYNC_UNKNOWN` orders. Such holds are kept
  indefinitely, as §5.4 requires, and are resolved by an operator. Automating that is a separate specification.

**Reading this document after implementation.** Sections 1–18 are the approved contract. Where the implementation is
*stricter* than the original wording, the implementation is correct and this document says so in place, marked
"Implementation note". Do not loosen code back toward the original wording; amend this spec first if a rule really has to
change.

Planning/review base: `storefront-core-kit/main@ff3793cf4ce2c019db1562b28a7471998a8f66f8`.

This specification is written only for `storefront-core-kit`. It does not require, request, or authorize any change to `la.na_design_storefront`. The Lana repository is historical production evidence for failure modes and proven approaches; Core Kit owns its own implementation, tests, migrations, rollout, and review.

## 1. Objective

Strengthen Core Kit with a small set of brand-agnostic production capabilities that have already proven necessary in a real storefront:

1. **Resource-based sellable capacity for composite variants** so bundle/set parents cannot oversell shared child stock and do not depend on synthetic parent stock.
2. **Migration-safe VPS deployment sequencing** so migrations/backfills that establish new write invariants cannot race an old application writer.
3. **Viewport-owned overlays** so full-screen drawers/dialogs are never constrained by sticky/transformed/backdrop-filtered ancestors.
4. **Trusted responsive media** with reviewed WebP support and one-request art direction for desktop/mobile hero photography.
5. **Server-owned listing URL state** so brand presentation may redraw filter/sort controls without duplicating query-state authority.

The result must preserve the defining Core Kit property from the current README: a brand fork may rewrite `src/app/**/page.tsx`, `src/app/globals.css`, `src/components/brand/**`, and brand config while shared commerce, route, integration, persistence, CI, and deployment behavior remains authoritative and reusable.

### Success at product level

A new brand fork should inherit these correctness and runtime guarantees without inheriting Lana-specific styling, merchandising vocabulary, campaign taxonomy, page composition, or chat integrations.

## 2. Current-system facts and gaps

The implementation must begin from current Core Kit behavior, not from assumptions about the source storefront.

### 2.1 Stack and commands

Current repository stack:

- Next.js `16.2.11`
- React `19.2.0`
- TypeScript `5.9.x`
- Prisma / Prisma Client `7.9.1`
- PostgreSQL
- Better Auth `1.6.25`
- pnpm `11.4.0`
- Node.js `>=22.14.0`

Current required quality commands:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:db
pnpm build
pnpm release:check
```

Relevant additional checks already present in the repository must continue to pass, including the Merchant, sitemap, VPS-container, browser/a11y, and other exact-head CI gates that are required by `.github/workflows`.

### 2.2 Persistence facts

Current schema already has:

- `ProductMirror`
- `VariantMirror`
- `CompositeComponentMirror`
- `WarehouseStock`
- carts and immutable order snapshots
- promotion persistence

Current schema does **not** have a durable reservation/resource ledger equivalent to `VariantCapacityReservation` / `CapacityReservationResource`.

Therefore the composite-capacity work in this spec is a new Core Kit capability with additive persistence and migration requirements. It is not a cosmetic refactor and must not be implemented by copying parent stock into a synthetic local field.

### 2.3 Deployment fact

Current `deploy/vps/deploy.sh` performs:

```text
release preflight
→ database backup
→ prisma:migrate:deploy
→ app/caddy up
```

The currently serving app is not explicitly quiesced before migration. That is acceptable only for migrations that are fully compatible with concurrent old writers. This spec introduces a migration class where that assumption is not safe.

### 2.4 Media fact

`src/commerce/product-media.ts` currently trusts only `.jpg` and `.png` for product images on the reviewed Pancake CDN contract. Video has a separate `.mp4` entry point.

WebP is not currently part of the trusted image contract.

### 2.5 Brand-seam fact

Core Kit deliberately keeps shared decisions below the brand/page seam. Brand components may be discarded and redrawn. Any new filter/media/overlay capability must preserve that property: shared state/authority may be exposed as typed props/models, while brand markup remains replaceable.

## 3. Non-goals

The following are explicitly outside v1 and must not be smuggled into implementation PRs:

- no Lana visual design, fonts, colors, 2:3 card ratio, PDP gallery treatment, homepage section order, feedback layout, or collection styling;
- no `CLEARANCE` / “Xả hàng lẻ size” campaign kind;
- no Lana-specific six-choice combo taxonomy or labels such as `SET VÁY`, `SET QUẦN`, `ÁO LẺ`;
- no Pancake website chat widget;
- no admin-managed size-guide artwork/CMS work;
- no generic theme engine;
- no redesign of the Core Kit route-shell/page-boundary contract;
- no Next.js upgrade in the same implementation series. Framework upgrade, if desired, is a separate change with its own source verification and regression gate;
- no write-back of local capacity to Pancake stock;
- no unrelated cleanup/refactor.

## 4. Architectural invariants

### 4.1 External facts remain external facts

`WarehouseStock` remains a mirror of Pancake. Composite sellable capacity must be **derived**, not repaired by rewriting parent stock.

### 4.2 Code owns commerce authority; brand owns presentation

The brand layer may choose how to render a filter, drawer, hero, product option, or capacity message. It must not own:

- stock arithmetic;
- reservation resource expansion;
- row-lock strategy;
- canonical listing href construction;
- trusted-media URL validation;
- migration sequencing.

### 4.3 Fail closed at external boundaries

Invalid/missing component topology, untrusted media URLs, malformed listing state, or incomplete reservation resources must not silently degrade into a saleable or trusted state.

### 4.4 One authoritative implementation per invariant

Do not maintain one capacity rule for PDP, another for cart, and a third for checkout. Advisory views may consume a read model, but final acceptance must use one server-side authoritative reservation path.

Do not maintain one query-param builder per visual filter implementation. Routes/models own canonical hrefs; controls consume them.

## 5. Capability A — Resource-based composite capacity

### 5.1 Required semantics

A purchased line resolves to one or more **capacity resources**:

```text
standalone variant
  → itself × purchased quantity

composite parent (has CompositeComponentMirror edges)
  → each component variant × edge quantity × purchased quantity
```

A composite parent's own mirrored `WarehouseStock` is not substituted for child stock and is not rewritten to match derived capacity.

Advisory sellable quantity for a composite is derived from currently usable component resources:

```text
activeReservedUnits = sum(resource units whose accounting responsibility is still local/unresolved)
componentUnits = floor(max(0, mirroredComponentStock - activeReservedUnits) / edgeQuantity)
parentCapacity = min(componentUnits for every required component)
```

`mirroredComponentStock` is the same mirrored-stock aggregate checkout already uses today: the sum of every `WarehouseStock` row for that variant across mirrored warehouses (`sumWarehouseStocks` in `src/commerce/guest-checkout-snapshot.ts` and `src/commerce/storefront-cart-repository.ts`). A variant with no stock rows has zero mirrored stock. `WarehouseStock.quantity` is stored as `Float`, so the capacity path must fail closed on a non-finite value (as checkout does now) and must floor a fractional aggregate before integer capacity arithmetic rather than rounding it up. Changing which warehouses count toward sellable stock is out of scope for v1.

A reservation row may continue to exist for audit/idempotency after it stops contributing to `activeReservedUnits`. Whether a resource contributes is determined by the accounting-ownership contract in §5.4, not merely by the local order state's label.

Core Kit has no oversell/preorder selling policy today: every sale is floored at non-negative mirrored stock. v1 keeps that single floor for standalone and composite lines alike. Introducing any oversell/preorder policy is an ask-first change (§15) and would need its own resource-level floor definition.

### 5.2 Additive persistence

Implementation planning must define an additive schema equivalent in responsibility to:

```text
line reservation
  - owning order
  - purchased variant
  - purchased quantity
  - lifecycle/accounting state or enough durable evidence to derive it

reservation resource snapshot
  - owning line reservation
  - concrete resource variant
  - consumed resource quantity
  - enough durable handoff/reconciliation evidence to prevent release gaps or double accounting
```

Names are not prescribed by this spec; responsibilities are.

Required properties:

- reservation references existing variant identity with restrictive deletion semantics appropriate to an active hold. Today `VariantMirror` cascades from `ProductMirror`; production catalog sync retires variants through `isPresent`/`isActive` rather than deleting them, but several `scripts/*-http-smoke.ts` fixtures clean up with `productMirror.deleteMany`. Planning must make those cleanups remove reservations first (or otherwise stay compatible) so a restrictive reference cannot turn fixture teardown or a future hard-delete into a failure;
- resource snapshots reference the concrete component `VariantMirror`, not the `CompositeComponentMirror` edge row, because edges cascade-delete and are replaced when topology changes;
- resource snapshots are immutable for an accepted line's capacity identity;
- a later sync that changes composite topology does not move an existing reservation to different resources;
- duplicate order retries are idempotent at a stable order/variant boundary;
- accounting handoff/reconciliation is idempotent at a stable order/resource/evidence boundary;
- resource quantities are positive bounded integers;
- all new schema is additive in the rollout that first introduces it.

### 5.3 Transaction/locking contract

For each order commit:

1. Merge duplicate purchased variants into one logical request per variant.
2. Resolve all current capacity resources for the new reservation.
3. Build the complete lock set: requested variants + resource variants + any existing snapshots needed for idempotent retry.
4. Lock `VariantMirror` rows in a deterministic order before reading competing active resource holds.
5. Fail closed when a requested variant or required resource cannot be proven.
6. Read mirrored stock and active holds **after** the lock is acquired.
7. Evaluate every line/resource.
8. Insert all line reservations and all resource snapshots in the same transaction, or insert none.

> **Implementation note — topology race guard (stricter than steps 2–6).** The lock set is resolved and locked in one
> statement, but under `READ COMMITTED` a component edge committed while that statement waited for a row lock is not in
> its result. Topology is therefore read **again after the lock**, and if the re-read plan names any resource variant
> that is not in the locked set, the reservation is refused with `TOPOLOGY_CHANGED`. Nothing is inserted, no Pancake
> request is sent, and the order returns to `DRAFT` (`VALIDATION_UNAVAILABLE`) so the buyer can simply retry against the
> new topology. A reservation is never accepted on a resource this transaction does not hold
> (`src/commerce/capacity-reservation-repository.ts`, `reserveOrderCapacity`). Removing this guard reopens exactly the
> race the locks exist to close.

`READ COMMITTED` is acceptable only if correctness is supplied by the explicit lock ordering and post-lock reads. The implementation must prove this with DB concurrency tests rather than relying on commentary.

### 5.4 Reservation accounting lifecycle and Pancake mirror handoff

Capacity accounting has two possible owners for units consumed by an accepted Pancake sale:

1. **local/unresolved accounting** — the reservation resource contributes to `activeReservedUnits`; or
2. **mirror accounting** — a trusted Pancake inventory observation is authoritative for those consumed units, so that resource no longer contributes to `activeReservedUnits` even if its reservation row remains for audit/idempotency.

The same consumed unit must never be intentionally unaccounted by both sides, and it must never remain intentionally accounted by both sides after the handoff has been proven. Implementation details may use explicit states, timestamps/watermarks, reconciliation records, or another additive representation, but the following commerce contract is fixed by this spec.

#### 5.4.1 Holds that count in `activeReservedUnits`

The local reservation must be accepted no later than the transaction that claims `POS_SUBMITTING`, i.e. before the Pancake create-order request can be sent. Because no elapsed-time release is allowed (below), a hold must not be created in a state that can be abandoned without a durable, non-time-based release path: creating it at `DRAFT` or `VALIDATING` is allowed only if planning also defines how an order that never reaches the external call gives the hold back.

A reservation resource **must** contribute to `activeReservedUnits` from the moment the local reservation is accepted until one of the two terminal accounting outcomes below is durably proven:

- **definitive no-sale release:** trusted evidence proves the Pancake create-order attempt did not produce an accepted external order and cannot later materialize as one; or
- **mirror handoff:** trusted evidence proves the exact accepted external order's stock consumption is included in the authoritative mirrored stock observation used for capacity.

Consequences for existing local order states:

- `POS_SUBMITTING`/equivalent in-flight submission keeps the local hold;
- `SYNC_UNKNOWN` **must keep the local hold**. Timeout, transport failure, ambiguous response, or unknown create-order outcome is not a rejection and cannot release capacity;
- `CONFIRMED` **does not by itself retire the local hold**. Confirmation proves an external order exists, not that the current `WarehouseStock` mirror already reflects its stock consumption;
- `REJECTED`/equivalent may release capacity only when that state transition is backed by definitive evidence that no accepted Pancake order exists for the attempt. A local error label after an ambiguous submit is insufficient. A rejection reached before any create-order request was sent (today's `VALIDATING → REJECTED` validation path, including the recovery sweep's `VALIDATION_INTERRUPTED`) is itself definitive: no external attempt exists, so any hold it carried may be released.

No elapsed-time TTL, process restart, local status label, or buyer retry may silently convert an unresolved hold into released capacity.

#### 5.4.2 What qualifies as mirror-handoff evidence

Mirror handoff requires **causal evidence**, not numeric inference. The implementation must be able to prove both:

1. the exact Pancake order/create attempt was accepted; and
2. the inventory observation now represented by `WarehouseStock` is causally after that acceptance and, by the reviewed Pancake integration contract, is guaranteed to include that order's stock effect for the relevant resource.

The following are **not sufficient evidence** on their own:

- local `CONFIRMED` state;
- a successful HTTP response without stable external-order identity;
- a lower `WarehouseStock.quantity` value;
- a stock delta equal to the reserved quantity;
- elapsed propagation time;
- an unrelated later catalog sync;
- absence from one reconciliation/search attempt when propagation can still be pending.

If the current Pancake APIs/integration cannot provide a causally trustworthy inventory observation or equivalent reconciliation proof, implementation must keep the reservation locally accounted and surface that limitation during `/plan`; it must not invent a heuristic release rule. The capacity slice is not complete until a safe handoff mechanism is proven or the spec is explicitly amended.

#### 5.4.3 Atomic/idempotent ownership transfer

Once handoff evidence exists, the local database transition from local/unresolved accounting to mirror accounting must be durable and idempotent.

Preferred behavior when the stock-mirror update itself carries sufficient handoff evidence:

```text
same local DB transaction
  → write authoritative WarehouseStock observation
  → persist handoff evidence/accounting ownership
  → exclude the proven-reflected reservation resource from activeReservedUnits
```

If confirmation/reconciliation evidence arrives after the relevant stock observation was already stored, the reconciliation transaction must atomically persist the handoff proof and change accounting ownership against the already-recorded trusted observation.

A retry of the same sync/reconciliation event must not release twice, recreate a hold, or change resource quantity.

The authoritative capacity read must use **accounting ownership**, not physical row deletion. Therefore a reservation/resource row may remain indefinitely for history while contributing zero to `activeReservedUnits` after a proven mirror handoff.

#### 5.4.4 Required behavior for ordering races

The contract must remain safe for either arrival order:

**Confirmed before stock sync**

```text
mirror stock = 10
local hold = 2
CONFIRMED arrives
→ hold still counts
→ available = 8

later trusted inventory observation proves the order's stock effect and mirror stock = 8
→ atomically hand off accounting ownership
→ local active hold contribution = 0
→ available = 8
```

There must be no intermediate capacity of 10 caused by releasing on `CONFIRMED`.

**Stock observation before hold retirement/reconciliation**

A stock change alone does not prove which order caused it. Until causal handoff proof exists, the local hold remains authoritative even if this conservatively understates capacity. Once the exact order + trusted inventory observation are linked, handoff must be idempotent and the authoritative capacity becomes mirror-owned without deleting the reservation history.

This spec prefers temporary conservative under-capacity over any oversell window when Pancake outcome/propagation is ambiguous. It does not permit permanent double accounting after handoff evidence is known.

**Unknown outcome**

`SYNC_UNKNOWN` or equivalent ambiguity keeps the hold. If later reconciliation proves an accepted Pancake order, follow the mirror-handoff path. If later reconciliation definitively proves no accepted order exists and cannot still propagate into existence, release through the definitive no-sale path. Until one proof exists, capacity remains locally held.

### 5.5 Required regression cases

Database coverage must include at minimum:

- last unit: two concurrent buyers cannot both spend the same standalone unit;
- shared child: two different composite parents sharing one component contend on the same resource;
- composite parent vs direct child sale contend on the same resource;
- component edge quantity greater than 1;
- multi-component refusal is all-or-none with no partial reservation/resource rows;
- duplicate purchased lines are merged before capacity evaluation;
- invalid/missing component topology fails closed;
- a non-finite mirrored stock value fails closed, and a fractional aggregate is floored, not rounded up;
- an order abandoned or rejected before the create-order request (`DRAFT`/`VALIDATING`) does not leave a permanent hold;
- idempotent retry does not double-reserve;
- later composite-topology sync does not rewrite an existing resource snapshot;
- **confirmed-before-stock-sync:** `CONFIRMED` does not release a hold while the mirror is still pre-order stock;
- **stock-reflected-before-hold-retirement:** once causal handoff proof links the exact accepted order to the trusted reflected stock observation, accounting ownership switches once and final capacity is not double-subtracted;
- **unknown outcome:** `SYNC_UNKNOWN` keeps capacity held until accepted-sale handoff or definitive no-sale proof;
- repeated handoff/reconciliation of the same evidence is idempotent and does not change capacity a second time;
- a mere stock decrease/matching delta without causal order evidence does not retire a hold.

Tests must demonstrate failure on the pre-capability behavior where practical, then pass after implementation.

## 6. Capability B — Migration-safe VPS deployment

### 6.1 Problem

A migration that backfills or establishes a new reservation-resource invariant cannot be considered safe if the old app continues creating old-shape rows after the backfill and before the new app starts.

### 6.2 Required deployment sequence

For releases containing such a migration, the Core Kit production sequence must support:

```text
validate exact release/config
→ build images
→ ensure PostgreSQL healthy
→ release:check
→ create pre-migration backup
→ detect whether app is currently running
→ stop/quiesce old app writer
→ prisma:migrate:deploy
   ├─ failure: restart the exact stopped pre-release app container, then fail
   └─ success: start new app + caddy
→ require healthy new app
```

Do not recreate the old app from the newly built image on migration failure. If an old container was stopped, recovery must restart that exact pre-release container where Docker Compose supports it.

### 6.3 Deployment tests

CI/VPS verification must pin ordering, not merely script presence. At minimum:

- migration command occurs after old-app stop for the protected migration mode;
- new app starts only after migration success;
- migration failure attempts old-app restart when it was previously running;
- a deployment with no running prior app does not invent a restart target;
- existing exact-SHA, clean-tree, release preflight, backup, PostgreSQL health, and final app-health contracts remain intact.

Planning may choose one always-safe quiesced sequence or an explicit migration-mode gate. Prefer the simpler model unless measured availability requirements justify extra branching.

## 7. Capability C — Viewport-owned overlay contract

### 7.1 Scope

Any brand implementation that renders a full-viewport modal/drawer from inside a sticky, transformed, filtered, or otherwise containing ancestor needs a safe primitive/contract to escape that ancestor.

This spec does **not** require Core Kit to adopt Lana's cart UI. Core Kit currently may not expose the same cart-drawer surface. The capability is the invariant, not the visual component.

### 7.2 Contract

A full-viewport overlay implementation must:

- mount at `document.body` (or an equivalently reviewed top-layer root) via portal when needed;
- own the full viewport bounds;
- preserve existing focus trap and focus restoration;
- close on Escape where the surface is dismissible;
- lock background scroll through one canonical helper/policy;
- expose correct dialog/region semantics and accessible names;
- avoid moving commerce data/mutation authority into the overlay component merely to achieve the portal.

### 7.3 Browser regression

At a representative mobile viewport (390×844 or the repository's canonical equivalent):

1. scroll until the sticky header is in its scrolled state;
2. open the relevant full-screen drawer/dialog;
3. assert the overlay is under the approved top-layer root;
4. assert its bounding box is the viewport;
5. assert close-button/initial focus, scroll lock, Escape dismissal, and focus restoration.

If Core Kit has no cart drawer at implementation time, apply this to the first real full-viewport drawer rather than inventing a cart drawer solely for the test.

### 7.4 Acceptance contract for the first real overlay (deferred Slice 4)

**Status.** Deferred. Core Kit has no full-viewport overlay today (§19, Q4). Do not build one just to satisfy this section.

**Evidence.** nguyentuanson27-netizen/la.na_design_storefront#63 is the production bug this contract comes from. A mobile cart drawer was rendered
inside the sticky site header. Once the page scrolled, the header gained `backdrop-filter`. A `backdrop-filter` (like a
`transform` or `filter`) makes an element the containing block for its `position: fixed` descendants. The "full-screen"
drawer was then sized and positioned against the header instead of the viewport. The fix was to render the drawer through
`createPortal(…, document.body)`. The browser regression below reproduced the bug before the fix.

**The contract.** The first change that introduces a full-viewport drawer, dialog or overlay in Core Kit — cart drawer,
search overlay, filter drawer or anything equivalent — must ship all of the following in the same pull request:

1. **Portal.** The overlay root is rendered into `document.body` (or a reviewed top-layer root) and is never rendered in
   place under a sticky, transformed or filtered ancestor. Prefer one shared helper so later overlays reuse it.
2. **Viewport bounds.** At 390×844, the overlay root's bounding box is `x = 0, y = 0, width = 390, height = 844` **after
   the page has scrolled** and the header is in its scrolled state (the state that applies the containing-block style).
3. **Focus.** On open, focus moves into the overlay (its close button or first control). Tab stays inside it while it is
   open. On close, focus returns to the element that opened it.
4. **Escape.** Escape closes a dismissible overlay.
5. **Scroll lock.** The background does not scroll while the overlay is open, through one canonical helper. The previous
   scroll-lock state is restored on close, including when two overlays open in sequence.
6. **Semantics.** The overlay exposes `dialog` semantics with an accessible name. Nothing behind it is reachable by
   keyboard.
7. **Authority stays put.** Portalling moves markup only. Cart and checkout data, mutations and capacity decisions stay in
   the headless and commerce layers.

**Required browser regression** (`tests/a11y-runtime/`, mobile project), modelled on the one nguyentuanson27-netizen/la.na_design_storefront#63
added:

```text
viewport 390×844 → go to a page with the sticky header
→ scrollTo(0, 120); wait until scrollY > 20 and the header reports its scrolled state
→ open the overlay from its real trigger
→ assert overlayRoot.parentElement === document.body
→ assert boundingBox == { x: 0, y: 0, width: 390, height: 844 }
→ assert initial focus is inside the overlay; assert document.body scroll is locked
→ Tab past the last control → assert focus is still inside the overlay
→ press Escape → assert the overlay is gone, focus is back on the trigger, and the scroll lock is released
```

The test must fail against a version rendered in place (no portal) and pass with the portal. Lana's own regression stops at
Escape. The two after-close assertions in the last step (focus restored, scroll lock released) are added here on purpose.

## 8. Capability D — Trusted responsive media

### 8.1 WebP extension of the existing trust boundary

Extend the reviewed Pancake **image** contract to lowercase `.webp` while preserving all existing restrictions:

- `https:` only;
- exact `content.pancake.vn` hostname;
- no wildcard host;
- no custom/explicit port;
- no credentials;
- no traversal or encoded traversal;
- exact reviewed path shape;
- bounded URL length;
- image parser must not accept video extensions;
- uppercase/unreviewed extensions remain rejected unless separately approved.

The same extension must be reflected consistently in:

- `src/commerce/product-media.ts` (`ALLOWED_IMAGE_EXTENSIONS` and the reviewed path-shape regex);
- `next.config.mjs` `images.remotePatterns`, which today has one entry per extension (`*.jpg`, `*.png`);
- CSP `img-src`, which is host-scoped (`https://content.pancake.vn`) and needs no widening for a new extension;
- domain/integration tests that pin the trust boundary;
- documentation that describes trusted product media.

Do not weaken the parser to “any file on content.pancake.vn”.

### 8.2 Responsive editorial-media shape

Core Kit may add an optional mobile-specific image to editorial entities that genuinely need art direction. The first approved consumer should be the existing collection hero because `CollectionDefinition` already owns `heroImageUrl`.

Preferred additive shape:

```ts
type ResponsiveEditorialMedia = Readonly<{
  desktopUrl: string;
  mobileUrl?: string | null;
}>;
```

Persistence naming may stay entity-specific (for example an additive nullable mobile hero column) if that is simpler than inventing a generic media table. Do not create a CMS abstraction in v1.

Stored URLs must be revalidated on read through the trusted-media boundary.

### 8.3 One-request art direction

When desktop and mobile hero sources differ, rendering must use browser-native art direction (`<picture>` / reviewed Next.js equivalent) so one viewport chooses one source rather than preloading/requesting both CSS-hidden `<Image>` elements.

The implementation should use the current installed Next.js version's documented/supported image APIs. Because this is version-sensitive, implementation must verify the exact API against official Next.js documentation or the installed package before coding.

Browser tests must prove:

- mobile requests only the mobile hero source;
- desktop requests only the desktop hero source;
- fallback with no mobile source still requests the desktop source correctly;
- alt/accessibility semantics remain correct;
- no second hidden high-priority/preloaded source is fetched.

## 9. Capability E — Server-owned listing URL state

### 9.1 Contract

Routes/view models own canonical listing state and navigation targets. Brand controls consume that state rather than reconstructing it.

A generic public model should be sufficient for brand presentation to render links, selects, chips, drawers, or sidebars, for example:

```ts
type ListingOption<T extends string = string> = Readonly<{
  value: T | null;
  label: string;
  href: string;
  active: boolean;
}>;
```

The exact type may differ, but these responsibilities are mandatory:

- query parsing stays in route/shared discovery authority;
- page-reset semantics stay in the canonical href builder;
- selected filters and clear links are server-derived;
- client controls navigate to provided hrefs;
- no brand component reimplements search-param merge/removal logic;
- no hidden duplicate focusable control exists only to carry URL behavior.

### 9.2 Accessible mobile filter presentation

If a brand chooses a mobile drawer:

- real controls have accessible names;
- one visible sorting control owns sorting interaction;
- drawer focus is trapped/restored;
- Escape and scroll lock work;
- active-filter removal and clear-all actions use canonical hrefs from the model;
- changing sort/filter does not unexpectedly reset scroll unless the route contract explicitly requires it.

Presentation and breakpoint choices remain brand-owned.

### 9.3 Required route/browser coverage

At least one listing route and one collection-local listing must prove:

- canonical state survives a real UI interaction;
- unrelated active query state is preserved when required;
- page resets only when the canonical route contract says it should;
- clear/removal hrefs are route-local and server-derived;
- mobile accessibility/focus behavior works through the real UI;
- brand markup can change without changing the href-generation tests.

## 10. Project structure and ownership

Implementation should prefer existing homes:

```text
src/commerce/**              commerce/capacity authority
src/db/**                    persistence repositories/transactions
prisma/**                    additive reservation/resource schema + migrations
src/routes/**                canonical listing/read models and href authority
src/components/headless/**   reusable UI state/behavior without brand markup
src/components/brand/**      replaceable visual implementation/adapters
src/commerce/product-media.ts trusted media parsing
src/app/**                   route markup over view models only
deploy/vps/**                deployment sequencing/rollback
.github/workflows/**          required exact-head verification
```

Do not create a new cross-cutting framework when an existing layer already owns the concern.

## 11. Code style

Follow current repository TypeScript style and explicit readonly contracts. Prefer small named policies/models over configuration-heavy components.

Good direction:

```ts
export type CapacityResource = Readonly<{
  variantId: string;
  quantity: number;
}>;

export function resolveCapacityResources(/* trusted typed input */): readonly CapacityResource[] {
  // pure mapping only; database locking belongs to the repository/transaction layer
}
```

Avoid:

```ts
// brand component deciding stock, DB reads, URL merging, and rendering in one place
function ProductPanel() {
  // fetch DB
  // infer composite capacity
  // construct search params
  // render UI
}
```

Shared helpers must encode a real invariant, not merely move code into another file.

## 12. Testing strategy

### Domain/unit

Use for pure rules:

- resource expansion and edge quantities;
- capacity arithmetic/policy;
- trusted WebP URL parsing;
- listing href/model behavior;
- responsive-media model fallback.

### Database/integration

Required for:

- concurrent row-lock behavior;
- shared-resource contention;
- all-or-none reservations;
- idempotent reservation retry;
- confirmed-before-stock-sync accounting;
- stock-reflected-before-hold-retirement handoff;
- `SYNC_UNKNOWN` retaining capacity;
- idempotent handoff/reconciliation;
- rejection/release only on definitive no-sale evidence;
- persistence constraints and migration behavior.

Use the repository's existing PostgreSQL test harness and `pnpm test:db`; do not mock the transaction semantics being proven.

### Browser/runtime

Required for:

- overlay top-layer/viewport behavior;
- focus/keyboard/scroll-lock behavior;
- responsive image request selection;
- real listing controls and URL state;
- accessibility regressions on changed UI surfaces.

### Full gates

Before any implementation PR is considered complete:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:db
pnpm build
pnpm release:check
```

plus every relevant exact-head CI/runtime/VPS/Merchant/Catalog/browser gate defined by the repository at that time.

No test may be weakened, skipped, or converted to a source-spelling assertion merely to make a migration pass.

## 13. Security and trust boundaries

This work touches external catalog/media input and database-backed commerce authority, so security review is mandatory.

Requirements:

- Pancake data and CDN URLs remain untrusted external input until validated;
- no wildcard media hosts;
- no user-controlled URL may bypass trusted-media parsing;
- reservation quantities and component quantities must be bounded positive integers before persistence/arithmetic;
- transaction code must use parameterized database access;
- no secret/env value may be logged or added to examples;
- migration/deploy changes must not echo `.env.production`;
- brand/client state never becomes authority for capacity or final checkout acceptance.

## 14. Implementation slicing

This specification is intentionally broader than one implementation PR. After approval, planning should split it into independently reviewable slices, in this dependency order:

### Slice 1 — Capacity authority and persistence

- additive reservation/resource schema;
- pure resource planning;
- transactional locking/evaluation/insertion;
- durable accounting-ownership/handoff evidence;
- idempotent reconciliation for definitive no-sale release vs proven mirror handoff;
- DB concurrency, atomicity, confirmed-before-sync, reflected-before-retirement, and unknown-outcome coverage;
- wire final checkout acceptance to the authority;
- advisory PDP/cart projection may consume the same resource facts without becoming checkout authority.

### Slice 2 — Safe deployment for the new invariant

- quiesce old app before protected migration;
- migration-failure restart path;
- script/CI regression coverage;
- rollout/rollback documentation.

Slice 2 must land before a production migration that depends on the no-old-writer window.

### Slice 3 — Trusted responsive media

- lowercase WebP trust contract end to end;
- additive mobile hero storage/read contract for the first approved editorial surface;
- one-request art-directed hero component/model;
- browser request-selection coverage.

### Slice 4 — Overlay invariant

- introduce/reuse top-layer portal + scroll/focus behavior on a real existing full-viewport surface;
- mobile scrolled-header regression.

Do not invent a new drawer solely to satisfy this slice. **Deferred.** The acceptance contract for when it lands is §7.4.

### Slice 5 — Listing URL-state seam

- typed canonical option/href model below brand presentation;
- migrate one listing vertical slice first;
- browser acceptance;
- expand to other listing surfaces only after the first slice proves the seam.

### Separate change — framework alignment

If Core Kit is to move from Next `16.2.11` to the version currently proven in another storefront, that must be a standalone dependency/framework PR after checking official current Next.js release/migration documentation. It is not a prerequisite of this spec.

## 15. Boundaries

### Always

- preserve the Core Kit brand-discardability contract;
- write regression tests before or with changed behavior;
- use additive schema first;
- verify current framework APIs from authoritative sources when version-sensitive;
- keep checkout authority server-side;
- keep `SYNC_UNKNOWN`/ambiguous external outcomes locally capacity-accounted until proven otherwise;
- require causal external evidence before transferring capacity accounting from a local hold to `WarehouseStock`;
- revalidate stored external URLs on read;
- keep implementation slices independently revertible;
- document rollout/rollback for the reservation migration.

### Ask first

- introducing any oversell/preorder selling policy (standalone or composite);
- changing which warehouses count toward mirrored sellable stock;
- changing existing selling-policy floors;
- destructive schema changes;
- changing the route/page boundary or import allowlist;
- adding a dependency;
- widening CSP/media origins;
- changing public URL/canonical semantics;
- changing the standard VPS availability model beyond the minimum quiesce window.

### Never

- mutate `la.na_design_storefront` as part of this work;
- copy Lana brand/UI decisions into shared Core Kit authority;
- synthesize parent stock by rewriting Pancake mirror data;
- release capacity from `SYNC_UNKNOWN`, timeout, ambiguous create-order result, or `CONFIRMED` alone;
- infer mirror handoff merely from elapsed time or a matching warehouse-stock delta;
- trust client-side stock/capacity calculations for checkout;
- add wildcard trusted-media/CSP hosts;
- silently relax tests to match implementation;
- mix the Next.js upgrade with these behavior changes;
- perform unrelated refactors.

## 16. Definition of done for v1

The full initiative is complete only when all applicable implementation slices satisfy both their acceptance criteria and the repository's standing quality gates.

At minimum (state as of nguyentuanson27-netizen/storefront-core-kit#17; evidence in §19):

- [x] composite and direct sales share one correctly locked capacity pool;
- [x] parent mirror stock remains untouched;
- [x] reservation resources are snapshotted atomically and retry-safe;
- [x] `activeReservedUnits` includes every local/unresolved hold and excludes a hold only after definitive no-sale release or proven mirror handoff;
- [x] `SYNC_UNKNOWN` cannot release capacity early (it never releases automatically in v1; see status header);
- [x] `CONFIRMED` before stock reflection keeps the local hold;
- [x] mirror handoff is causally evidenced, durable, and idempotent, with no oversell gap and no permanent double accounting after proof (for the resources the Pancake evidence covers; others keep holding, §19 Q3);
- [x] DB tests prove concurrent shared-resource safety, all-or-none behavior, confirmed-before-stock-sync, stock-reflected-before-hold-retirement, unknown-outcome retention, and reconciliation idempotency;
- [x] production migration cannot race the old writer for the protected invariant;
- [x] migration failure can restore the stopped pre-release app when applicable;
- [x] `.webp` is accepted only through the reviewed Pancake image contract;
- [x] mobile/desktop art direction fetches one intended hero source per viewport;
- [ ] at least one real full-screen overlay owns the viewport under a scrolled/sticky ancestor and preserves keyboard/focus/scroll behavior — **deferred with Slice 4; contract in §7.4**;
- [x] listing controls consume server-built canonical hrefs rather than duplicating query-state logic (`/shop`, plus the existing collection pages);
- [x] brand presentation remains replaceable without editing shared commerce/route authority;
- [x] lint, typecheck, domain/integration/DB tests, build, release preflight, browser/a11y, VPS and other required exact-head CI gates pass;
- [x] no secrets, debug code, dead migration scaffolding, or unrelated refactor remains;
- [x] rollout and rollback implications are documented for the capacity migration.

## 17. Open questions for planning, not for spec approval

These do not change the commerce semantics fixed above and should be resolved against the code during `/plan`:

1. Which existing order/checkout transaction boundary is the narrowest correct owner for reservation creation and for invoking the fixed reconciliation/handoff contract in §5.4?
2. Which durable representation best records local/unresolved vs mirror-accounted ownership and the causal Pancake evidence required by §5.4 without over-engineering the schema?
3. Which existing Pancake inventory/reconciliation response, cursor, timestamp, order identity, or other reviewed source fact can satisfy the causal handoff proof in §5.4.2? If none can, `/plan` must surface that blocker rather than choose a heuristic.
4. Does Core Kit currently have a real full-viewport drawer suitable for the overlay slice, or should that slice wait until one exists?
5. Which first listing surface gives the smallest vertical proof of canonical href ownership without redesigning the brand UI?
6. Should deployment always quiesce the app before every production migration, or should a simple explicit protected-migration mode be introduced? Prefer the always-safe sequence unless availability evidence justifies the extra branch.

Planning may choose implementation shape and evidence source, but it may not redefine which outcomes keep/release a hold or what counts as sufficient handoff proof without a spec amendment.

These questions must not be answered by importing Lana-specific names or business rules. The implementation plan must resolve them from current Core Kit contracts, Pancake integration evidence, and tests.

## 18. Review gate

*Historical: this gate was passed when the specification merged as nguyentuanson27-netizen/storefront-core-kit#11.*

This PR is specification only.

Approval means:

- the five capabilities and their boundaries are accepted for Core Kit;
- the reservation-to-mirror accounting lifecycle in §5.4 is accepted as a commerce correctness contract;
- the non-goals are accepted;
- subsequent work may proceed to `/plan` and be split into the implementation slices above.

Approval does **not** authorize implementation to change Lana, merge all slices into one PR, broaden brand-specific behavior into the core, or skip exact-head verification.

## 19. Implementation status and planning answers

Recorded as the slices were implemented; each slice is its own pull request against `main`.

| Slice | Pull request | State |
| --- | --- | --- |
| 1 — capacity authority and persistence | nguyentuanson27-netizen/storefront-core-kit#13 | implemented |
| 2 — safe deployment for the new invariant | nguyentuanson27-netizen/storefront-core-kit#14 | implemented |
| 3 — trusted responsive media | nguyentuanson27-netizen/storefront-core-kit#15 | implemented |
| 4 — overlay invariant | — | **deferred: waiting for a real surface** (Q4 below; contract §7.4) |
| 5 — listing URL-state seam | nguyentuanson27-netizen/storefront-core-kit#16 | implemented for `/shop` |
| lifecycle gaps from self-review and owner review | nguyentuanson27-netizen/storefront-core-kit#17 | implemented |

What nguyentuanson27-netizen/storefront-core-kit#17 added:

- **Scheduled catalog sync.** A `catalog-sync` compose service runs `pnpm pancake:catalog:sync --loop`. Without a
  recurring sync, holds would never hand off.
  - It has a heartbeat-based health check: stale after two intervals plus 120 s.
  - `deploy.sh` quiesces it together with the app and waits for it to become healthy.
  - `rollback.sh` stops it before the previous app starts.
- **Reservation transactions wait out a sync.** The transactions that write `VariantMirror` wait out a catalog sync that
  holds the row lock instead of failing at Prisma's 5 s default.
- **One capacity read model everywhere.** Listing filters, flash-sale and Merchant availability read the same capacity
  numbers as checkout (`CAPACITY_SELLABLE_CTES`, `withAdvisorySellableStock`).
- **Partial index** on unmirrored reservation resources.

Answers to §17, resolved against the code rather than chosen in the abstract:

1. **Reservation boundary.** The submission transaction that claims `POS_SUBMITTING` also takes the hold, so no create-order
   request leaves without one and no `DRAFT`/`VALIDATING` order ever holds capacity. `CONFIRMED` records acceptance in its own
   transaction. A topology change that races the lock refuses the hold with `TOPOLOGY_CHANGED` and returns the order to
   `DRAFT` (§5.3 implementation note).
2. **Durable representation.** `CapacityReservation` (order × purchased variant, `acceptedAt`) and
   `CapacityReservationResource` (consumed stock, `mirroredAt` + `mirrorObservationStartedAt`). A resource counts while
   `mirroredAt` is null.
3. **Handoff evidence.** A stock read that *started* after acceptance (the sync samples its marker before its first request),
   for resources the reviewed Pancake evidence covers: standalone variations, and composite components used once per set.
   Components used more than once per set, and `SYNC_UNKNOWN` holds, have no such evidence and keep holding. See
   `docs/integrations/pancake.md` › "Capacity reservation and mirror handoff evidence".
4. **Overlay surface.** Core Kit has no full-viewport drawer or dialog today: the only overlay-like surface, the mobile menu,
   is a `<details>` dropdown positioned inside the sticky masthead, not a viewport-owning overlay, and there is no cart drawer,
   search overlay or filter drawer. Per §7.3 and §14 no drawer is invented to satisfy the slice. Slice 4 lands with the first
   real full-viewport surface a brand or a later core feature introduces, and the §7.3 regression applies to it then.
5. **First listing surface.** `/shop`. Collections already built sort, size and clear hrefs server-side; `/shop` still wrote
   its clear link and sort values in markup and offered no per-filter removal. Its model now owns `clearHref`, `sortOptions`,
   `activeFilters` (one removal href per applied filter) and `stateHref`, which keys the GET form so a client-side navigation
   cannot leave the controls showing, and resubmitting, a state the shopper just removed. Both listings share
   `ListingOption` (`src/routes/listing.ts`).
6. **Deploy mode.** Always quiesce before migrating (one sequence, no per-migration branch).
