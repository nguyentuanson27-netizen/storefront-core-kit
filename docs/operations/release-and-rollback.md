# LA Clothing release and rollback runbook

Production infrastructure is defined by [ADR 0002](../decisions/0002-vps-production-infrastructure.md) and amended for the selected shared VPS by [ADR 0003](../decisions/0003-shared-host-npm-edge.md). The active edge is nginx-proxy-manager (NPM) on host 80/81/443, with LA Clothing's Caddy running internal-only behind it. [ADR 0001](../decisions/0001-production-infrastructure.md) remains historical context for the superseded Render decision.

Host provisioning is documented in [VPS bootstrap handoff](./vps-bootstrap.md).

## Release model

Production does not auto-deploy a moving branch. Every release uses one reviewed, CI-green, full 40-character Git SHA.

`deploy/vps/.env.production` contains `RELEASE_SHA`. `bash deploy/vps/deploy.sh` refuses to continue if the checked-out commit differs or the worktree is dirty.

## Release gate

A candidate is eligible only when all of these are true:

1. Human review/approval exists for the exact candidate.
2. CI is green on that exact commit, including normal application gates and the VPS Docker/Compose smoke.
3. The production domain and server configuration are known.
4. `deploy/vps/.env.production` contains real production values and is protected on the VPS.
5. `EDGE_NETWORK_NAME` identifies the existing NPM Docker network and `EDGE_TRUSTED_PROXY_CIDR` contains the smallest reviewed stable NPM trust range. Do not deploy the documentation-only fallbacks `la-clothing-edge-unconfigured` or `192.0.2.1/32`.
6. NPM is attached to that network and the LA Clothing Proxy Host is configured to forward `APP_DOMAIN` to `http://la-clothing-caddy:80` without changing unrelated live proxy hosts.
7. PostgreSQL/Caddy image references have been reviewed/pinned for the host.
8. Migration changes since the current deployment have been reviewed.
9. Off-site backup is configured and a restore drill has succeeded; destructive migrations additionally have a release-specific recovery plan.
10. The previous known-good application SHA/image is recorded and retained locally.
11. The controlled Pancake production write acceptance has completed; a read-only contract probe alone is insufficient.
12. VPS host firewall/SSH/NPM/TLS/monitoring prerequisites in `vps-bootstrap.md` are satisfied.

## Production configuration preflight

The canonical application preflight remains:

```bash
pnpm release:check
```

On VPS it is run inside the `ops` Docker target with the real production environment before migration. It validates PostgreSQL URL shape, Better Auth URL/secret/trusted IP header, Pancake configuration, and shipping policy without printing secret values.

Production uses:

```text
BETTER_AUTH_URL=https://<production-domain>
BETTER_AUTH_IP_HEADER=x-la-client-ip
DATABASE_URL=postgresql://...@postgres:5432/...
EDGE_NETWORK_NAME=<existing NPM Docker network>
EDGE_TRUSTED_PROXY_CIDR=<reviewed NPM trust CIDR>
```

NPM terminates public TLS and appends the forwarding chain. Caddy accepts traffic only over its Docker networks, trusts the configured NPM CIDR with strict right-to-left `X-Forwarded-For` parsing, and overwrites `X-LA-Client-IP` before proxying to Next.js.

Cloudflare remains DNS-only for the initial launch. If Cloudflare proxying is enabled later, that trust must be handled at the NPM edge in a separately reviewed change.

## Standard release

1. Record current known-good SHA and candidate SHA.
2. Confirm review/CI for the candidate.
3. Review migrations and database recovery requirements.
4. Confirm off-site backup/restore evidence and current backup freshness.
5. Confirm Pancake controlled production acceptance is complete.
6. Confirm the existing NPM stack is healthy and its unrelated proxy hosts are unchanged.
7. Confirm the external edge network exists and NPM is attached.
8. Confirm the LA Clothing NPM Proxy Host targets `http://la-clothing-caddy:80` and owns certificate/HTTPS redirect for `APP_DOMAIN`.
9. On VPS, fetch and detach at the exact candidate SHA; confirm clean worktree.
10. Set `RELEASE_SHA`, `EDGE_NETWORK_NAME`, and `EDGE_TRUSTED_PROXY_CIDR` in protected `deploy/vps/.env.production` to the reviewed values.
11. Run:

   ```bash
   bash deploy/vps/deploy.sh
   ```

12. The helper validates Compose, builds exact-SHA images, starts/waits for PostgreSQL, runs production `release:check`, creates a pre-migration custom-format dump, **stops every running database writer (the app and the `catalog-sync` service)**, deploys Prisma migrations, starts the exact app/Caddy/catalog-sync stack, and waits for `/shop` application health. Stopping the old writers first means nothing old can create rows between a migration that establishes a new invariant and the new release starting. The cost is an outage, not just a write pause: with the app stopped, Caddy answers 502 for the whole storefront until the migration finishes and the new app is healthy, so schedule releases that carry migrations accordingly. If the migration fails, the helper restarts exactly the writers it stopped (`docker compose start`, never a recreate from the new image) and exits non-zero; what was not running beforehand is not started. `tests/integrations/vps-deploy-sequence.test.ts` runs the real script against a recording `docker` to pin this order.
13. Verify public HTTPS and non-destructive buyer-flow smoke through **NPM -> Caddy -> app**.
14. Verify Caddy exposes no host ports and client-IP/rate-limit behavior is not collapsed to the NPM container address.
15. Review NPM/Caddy/application/PostgreSQL logs and container health.
16. Record post-release evidence before declaring success.

Do not create a live Pancake order merely as a generic release smoke test. The write acceptance is a controlled, separately recorded gate.

## Rollback triggers

Rollback/recovery is required for material user harm or integrity/security risk, including:

- the app container cannot become healthy;
- public critical buyer flows fail after promotion;
- NPM -> Caddy routing or TLS for the LA Clothing host fails after launch changes;
- client-IP attribution is incorrect enough to break or weaken auth/rate limiting;
- new auth/authz/security failure is observed;
- a migration causes data/read/write integrity issues;
- checkout/Pancake telemetry shows a release-caused unsafe state.

## Application-only rollback

When schema/data remain compatible with the previous application:

```bash
bash deploy/vps/rollback.sh <PREVIOUS_APPROVED_FULL_SHA>
```

The previous exact image must already exist locally. The rollback helper does not rebuild old code during the incident.

After rollback:

- wait for `/shop` health;
- verify public HTTPS through NPM and critical read/checkout/tracking flows;
- inspect NPM/Caddy/application logs/error state;
- record the failed candidate and rollback SHA.

Do not automatically reverse additive migrations.

NPM route/certificate rollback is a separate host operation. Do not revert or restart unrelated shared proxy hosts while rolling back LA Clothing.

## Database/data recovery

Application rollback is not database rollback.

For destructive/incompatible migrations or damaged data, use the release-specific recovery plan. Restore the selected logical/off-site backup into an isolated target first, validate it, then deliberately switch the application database only after the recovery point is understood.

Never invent a reverse migration while responding to an incident.

## Capacity reservation ledger (`20260926210000_add_capacity_reservations`)

Rollout:

- the migration is additive with no backfill: before it, no order held capacity, so there is nothing to reconstruct;
- it is safe against a still-serving old writer: old code never touches the ledger, and an order it confirms simply
  carries no hold, exactly as before;
- from the first new-code checkout, every submitted order holds its units (`CapacityReservation` /
  `CapacityReservationResource`) from the `POS_SUBMITTING` claim until a catalog sync that started after the order
  was confirmed hands them to the mirror. Expect a composite's own "Set" stock to be ignored in favour of what its
  components can supply.

Rollback:

- roll back application code only; keep both tables. Older code ignores them, so checkout returns to live-stock-only
  validation, and re-deploying new code resumes from the ledger as it was;
- never drop or truncate the ledger to "free" stock: holds for `SYNC_UNKNOWN` orders are the only record that those
  units may already be sold in Pancake. Resolve those orders against Pancake first;
- `OrderMirror` and `VariantMirror` rows with reservations cannot be hard-deleted (`Restrict`); that refusal is the
  intended guard, not an error to work around.

Holds clear only through a catalog sync, so the `catalog-sync` Compose service runs one every
`CATALOG_SYNC_INTERVAL_SECONDS` (default 300) with the release's own `ops` image; `pnpm pancake:catalog:sync` runs a
single sync by hand. If that service is stopped, sold units stay held and a Pancake restock is not offered until it runs
again: check `docker compose ... logs catalog-sync` first when stock looks stuck.

Liveness is a successful sync, not a running process. Each success writes a heartbeat inside the container, and the
service's health check (`scripts/catalog-sync-health.ts`) is healthy only while the last success is at most two
intervals plus two minutes old, so `docker compose ps` shows `unhealthy` for a loop that keeps failing (bad Pancake
configuration, an outage) or has never succeeded. `deploy.sh` does not report success until that check turns healthy
after the first sync of the new release; a failure there means the app is serving but stock will not refresh.

`rollback.sh` stops the current `catalog-sync` before starting the previous app, so an older app never serves beside
newer sync code. It then starts the previous release's own sync and waits for it to be healthy when that release shipped
one, and otherwise leaves sync stopped with a warning.

Operator view: units still locally held per variant are
`SELECT "variantId", SUM("quantity") FROM "CapacityReservationResource" WHERE "mirroredAt" IS NULL GROUP BY 1;`.
A hold that never clears after syncs belongs to a `SYNC_UNKNOWN` order or to a composite component consumed more than
once per set, whose handoff is not yet evidenced (`docs/integrations/pancake.md`).

## Selling modes (`20260928090000_add_product_selling_policy`, `SELLING_MODES_ENABLED`)

Spec: `docs/specs/core-kit-selling-modes-v1.md`. The migration only adds `ProductSellingPolicy`; no product has a row
until an admin saves one, and a product without a row is `STANDARD` with limit −20, exactly the behaviour before
selling modes.

Two flags, both **off** by default in `deploy/vps/env.example`:

- `SELLING_MODES_ENABLED` — the whole capability. While it is off every stored policy is effectively `STANDARD` in
  checkout, the live Pancake pre-check, the storefront advisory read (TypeScript and SQL), the Merchant feed and
  JSON-LD, and the admin form accepts only `STANDARD` or the default.
- `SELLING_MODE_PREORDER_ENABLED` — `PREORDER` additionally. Keep it off until Preorder truth v1 ships: a preorder
  accepted without its confirmed-order snapshot loses its preorder history for good.

Turning `STANDARD` + `OVERSELL` on is a configuration change, not a deploy of new code. Run from the repository root
on the VPS, with the same Compose invocation `deploy.sh` uses:

```sh
compose() { docker compose --env-file deploy/vps/.env.production -f deploy/vps/compose.yml "$@"; }
```

1. Confirm the release contains Selling Modes M1–M3 (`git log` shows M3b) and that its browser gate passed.
2. Preview what will change: `compose run --rm ops pnpm catalog:selling-policy:report` lists every stored policy, its
   effective mode under the flags in `.env.production` and each variant's free / sellable / ready units. Every row reads
   `SELLING_MODES_DISABLED` while the flag is off; resolve any `INVALID_POLICY` or `COMPOSITE_MODE_UNSUPPORTED` row
   first.
3. Set `SELLING_MODES_ENABLED=true` in `deploy/vps/.env.production`, then **recreate** the containers that load that
   file. A plain `docker compose restart` keeps each container's existing environment and would leave the flag off:

   ```sh
   compose up -d --no-build --no-deps --force-recreate app catalog-sync
   ```

   `--no-build` keeps the current release's images: no migration, no rebuild. `catalog-sync` does not read the flag, but
   it loads the same env file and is recreated with the app so the two never run on different configurations.
4. Verify the running app actually has the value, not just the file:

   ```sh
   compose exec app node -e 'if (process.env.SELLING_MODES_ENABLED !== "true") process.exit(1)'
   ```

   Then the report (`compose run --rm ops pnpm catalog:selling-policy:report`) shows effective `OVERSELL` for the
   intended products and no `SELLING_MODES_DISABLED`; an `OVERSELL` variant below zero is purchasable on its PDP with no
   preorder marker and appears in `/shop?availability=in-stock`; the Merchant feed lists it `in_stock`.

Rollback is the same switch in reverse and is safe in the conservative direction: set `SELLING_MODES_ENABLED=false`,
run the same `compose up -d --no-build --no-deps --force-recreate app catalog-sync`, and verify with
`compose exec app node -e 'if (process.env.SELLING_MODES_ENABLED === "true") process.exit(1)'`. Every product sells as
`STANDARD` again from the next decision; holds already taken below zero stay valid ledger rows and hand off to the
mirror as usual; negative stock simply stops selling until it is positive again. Stored policies are kept, so turning
the flag back on restores them. Never delete `ProductSellingPolicy` rows to "reset" a product: the admin "Mặc định"
choice does that one product at a time and records who did it.

## Search suggestions (`SEARCH_SUGGESTIONS_ENABLED`)

A/B/C plan task B07. No migration and no new table: a suggestion is the first few rows of the canonical `/shop`
discovery read for the same `q`, so visibility, effective price and availability are the listing's own. The flag is
**off** by default in `.env.example` and `deploy/vps/env.example`; only the exact value `true` enables it. While it is
off the `searchStorefrontSuggestions` server action answers `DISABLED` before validating the query or reading the
catalog, and `/search` and `/shop` are unchanged either way.

Bounds are code constants in `src/commerce/storefront-search-suggestions.ts`: query 2–80 characters (the same maximum
`/shop` accepts for `q`), at most 6 suggestions, a 1,500 ms ceiling after which the caller gets `UNAVAILABLE`.

The ceiling is enforced in the database, not only in the caller. Suggestions read through their own Prisma client
(`src/db/search-suggestions-prisma.ts`, built by `src/db/budgeted-prisma.ts`): Postgres cancels any statement that runs longer
than 1,500 ms (`statement_timeout`), and the client's pool is capped at 4 connections with a 1 s wait for a free one, so a burst
of slow suggestions cannot hold more than 4 connections of the shared pool's budget or leave statements running after the caller
has given up. The pool is created on first use, so a deployment that never enables suggestions never opens it. This bounds time
and connections; it is not a request-rate limit (see the residual in the slice record).

Enable by setting `SEARCH_SUGGESTIONS_ENABLED=true` in `deploy/vps/.env.production` and recreating the `app`
container (`--no-build --no-deps --force-recreate`, as for selling modes; a plain restart keeps the old environment).
Verify with `compose exec app node -e 'if (process.env.SEARCH_SUGGESTIONS_ENABLED !== "true") process.exit(1)'`.
Nothing renders suggestions until the optional overlay (task C05) is shipped and wired by a brand, so enabling this flag
alone changes no page.

Rollback is the same switch in reverse: set it to `false` and recreate `app`. There is nothing to migrate or clean up.

## Collapsible shop filters (`SHOP_FILTER_DISCLOSURE_ENABLED`)

A/B/C plan task C02. No migration. The filters, URLs, sort, page reset and results are unchanged: this only decides
whether the existing GET filter form is collapsed behind a "Bộ lọc (n)" button below 1024px. Off by default in
`.env.example` and `deploy/vps/env.example`; only the exact value `true` enables it. Off, `/shop` renders the same
markup as before.

On, the server still sends the form open with no button; the button appears and the form collapses only after the
client measures the viewport, so a client that never runs the script keeps a usable form. Opening moves focus to the
first field, Escape or applying a filter returns it to the button, removing a chip moves focus to the next chip (else
the button), and a polite status line states the result count.

Enable: set `SHOP_FILTER_DISCLOSURE_ENABLED=true` in `deploy/vps/.env.production` and recreate `app`
(`--no-build --no-deps --force-recreate`; a plain restart keeps the old environment), then verify with
`compose exec app node -e 'if (process.env.SHOP_FILTER_DISCLOSURE_ENABLED !== "true") process.exit(1)'`.
Rollback is the same switch in reverse; there is nothing to migrate or clean up.

## Mobile product page interactions (`PDP_MOBILE_INTERACTIONS_ENABLED`)

A/B/C plan task C01. No migration. Price, purchasability, the unavailable reason and the preorder marker are still
decided by `variant-selection-model.ts`; which photo a colour maps to is still `resolve-gallery-model.ts`. The flag only
adds interaction: previous/next buttons, arrow/Home/End keys and touch swipe on a multi-photo gallery (no wrap-around),
and a sticky purchase bar below 1024px that appears once the real purchase panel leaves the viewport. The bar's action is
the panel's own `addToBag`; when a choice is still needed it moves focus to that choice in the panel. Off by default in
`.env.example` and `deploy/vps/env.example`; only the exact value `true` enables it. Off, the product page is unchanged.

The server never sends the bar: it appears only after the client has measured the viewport. The bar is shown only while the
shopper is within the product detail region and the purchase panel is out of view; once they scroll past that region (the related
grid, the footer) it hides, so it never covers the footer. Within the region it covers the bottom ~70px of the viewport, which the
detail region reserves with bottom padding. When the option is a preorder the bar shows the same brand preorder marker the panel does.

Enable: set `PDP_MOBILE_INTERACTIONS_ENABLED=true` in `deploy/vps/.env.production`, recreate `app`
(`--no-build --no-deps --force-recreate`), verify with
`compose exec app node -e 'if (process.env.PDP_MOBILE_INTERACTIONS_ENABLED !== "true") process.exit(1)'`. Rollback is the
same switch in reverse; there is nothing to migrate.

## Cart drawer (`CART_DRAWER_ENABLED`)

A/B/C plan task C03. No migration. A read-only summary of the shopper's own cart opened from the header cart link.
**Scope: read-only.** Every figure (line prices, availability words, subtotal, whether checkout is offered) is
`buildCartViewModel`'s, the same model `/cart` renders, passed through the `readStorefrontCartDrawer` server action; the drawer
recalculates nothing and edits nothing. **Changing a quantity or removing a line still happens on `/cart`**, where the canonical
cart mutation and its feedback live; an editing drawer would be a separate slice (checklist C03b) that reuses `useCartLine`.
Opening is single-flight: activating the link twice in the same tick makes one server read. Off by default in `.env.example` and `deploy/vps/env.example`; only the exact value
`true` enables it. Off, the header link is a plain link and the action answers `null` without reading the database.

The dialog traps Tab, closes on Escape, the close button, the backdrop or following any link inside it, restores focus to the
cart link, and drops a response that arrives after it was closed or after a newer open. A modified click (Ctrl/Cmd/Shift/Alt,
middle) and a client without scripting still follow the link to `/cart`.

Enable: set `CART_DRAWER_ENABLED=true` in `deploy/vps/.env.production`, recreate `app` (`--no-build --no-deps --force-recreate`),
verify with `compose exec app node -e 'if (process.env.CART_DRAWER_ENABLED !== "true") process.exit(1)'`. Rollback is the same
switch in reverse; there is nothing to migrate.

## Search overlay (`SEARCH_OVERLAY_ENABLED`)

A/B/C plan task C05. No migration. A dialog opened from the header search link (in the utility bar on wide viewports and in the
Menu disclosure below 1024px) with a search field and the bounded suggestions from `searchStorefrontSuggestions` (B07). It
**requires `SEARCH_SUGGESTIONS_ENABLED=true` as well**: `readSearchOverlayEnabled` is false unless both are exactly `true`, so an
overlay never opens onto a disabled suggestion endpoint. Off by default in `.env.example` and `deploy/vps/env.example`. Off, the
header link is a plain link to `/search` and `/search` itself is unchanged.

The field is a real GET form to `/shop?q=`, so Enter always works whether or not suggestions load. Suggestions are debounced
(200 ms), a response is applied only if it answers the text currently in the box and the latest request, and every failure shows a
message rather than a stale list. Escape, the close button, the backdrop or following a link closes it and restores focus to the
header link. Modified clicks and clients without scripting still reach `/search`.

Enable: set both `SEARCH_SUGGESTIONS_ENABLED=true` and `SEARCH_OVERLAY_ENABLED=true` in `deploy/vps/.env.production`, recreate
`app` (`--no-build --no-deps --force-recreate`), verify each with `compose exec app node -e 'if (process.env.SEARCH_OVERLAY_ENABLED !== "true") process.exit(1)'`.
Rollback is either switch in reverse (overlay off keeps suggestions available to other callers; suggestions off also disables the
overlay); there is nothing to migrate. The suggestion action has no dedicated rate limit, the same exposure as `GET /shop?q=`
(see the B07 residual in the slice record); decide on one before enabling this in production.

## Curated new arrivals (`NEW_ARRIVALS_CURATION_ENABLED`)

A/B/C plan tasks B01–B03. The migration `20261018160000_add_new_arrivals_selection` adds two **new** tables and alters
nothing else, so it is safe to deploy with the flag off and before any code that reads it. Off by default in
`.env.example` and `deploy/vps/env.example`; only the exact value `true` enables it. Off, `/new-arrivals` renders the
same editorial page and metadata as before, ignores `?page=`, and issues no curated-listing query.

On, the page also lists the selection an administrator keeps at `/admin/new-arrivals` (at most 500 products, 24 stored
slots per page, `?page=N`). Pages are cut from the **stored** order first; a product that is hidden, inactive or gone is
dropped from its own page and the hole is not refilled. An empty selection, or a page whose slots are all hidden, keeps
the editorial frame with an accessible status line. A malformed, repeated or out-of-range `page` is a 404 (values above
21 are refused before any read). Price, availability, media and links come from the same projection as `/shop`.

Order of operations: deploy the migration, deploy the code with the flag off, curate the list at `/admin/new-arrivals`,
then set `NEW_ARRIVALS_CURATION_ENABLED=true` in `deploy/vps/.env.production` and recreate `app`
(`--no-build --no-deps --force-recreate`), then verify with
`compose exec app node -e 'if (process.env.NEW_ARRIVALS_CURATION_ENABLED !== "true") process.exit(1)'`.

Rollback is the switch in reverse: set it to `false` and recreate `app`. Leave the tables and their rows in place; they
are never dropped once they hold data, and an older build ignores them.

## Curated homepage selection (`HOMEPAGE_FEATURED_ENABLED`)

A/B/C plan task B04. The migration `20261018170000_add_homepage_featured` adds two **new** tables and alters nothing else,
so it is safe to deploy with the flag off. Off by default in `.env.example` and `deploy/vps/env.example`; only the exact
value `true` enables it. Off, the homepage "Tuyển chọn" shelf is the automatic discovery it has always been and the
selection is never read.

On, the shelf lists the selection an administrator keeps at `/admin/homepage-featured` — at most **12** products (a
database CHECK, not only an application rule), in that order, independent of any collection (nothing is copied from
`featuredProductSlugs`). A product that is hidden, inactive or gone is dropped from the shelf and its slot is not refilled.
If the selection is empty, or none of its products is currently visible, the shelf falls back to automatic discovery so
the homepage is never blank because of curation.

Order of operations: deploy the migration, deploy the code with the flag off, curate the list, then set
`HOMEPAGE_FEATURED_ENABLED=true` in `deploy/vps/.env.production` and recreate `app` (`--no-build --no-deps
--force-recreate`), then verify with
`compose exec app node -e 'if (process.env.HOMEPAGE_FEATURED_ENABLED !== "true") process.exit(1)'`.
Rollback: set it to `false` and recreate `app`; leave the tables and rows in place.

## Pancake write safety during rollback

Application or database rollback does not undo a Pancake order accepted by the external POS.

For an order in `SYNC_UNKNOWN`, never issue a blind duplicate create request. Use the existing status/reconciliation path to determine the remote outcome before any additional write.

## Promotion and campaign rollback

For promotion and campaign rollback, operational runbooks, kill-switch procedures, and durable pricing revision invalidation, refer to [Promotion rollback runbook](./promotion-rollback-runbook.md).


## Post-release evidence

Record without secrets:

- exact deployed application SHA;
- GitHub CI run for that SHA;
- runtime Docker image tag/digest;
- PostgreSQL and Caddy image digests;
- NPM stack/version identifier where available;
- selected NPM Docker network and reviewed trust CIDR;
- NPM Proxy Host target `la-clothing-caddy:80` and TLS status;
- `release:check` pass/fail;
- migration set applied;
- local pre-migration dump path/checksum;
- off-site backup freshness / restore-drill reference;
- `/shop` health result;
- domain/TLS status;
- public non-destructive smoke result;
- client-IP attribution/rate-limit sanity result;
- NPM/Caddy/app/database telemetry review;
- Pancake production-acceptance evidence;
- previous known-good SHA retained for rollback;
- any rollback or `SYNC_UNKNOWN` reconciliation performed.

## Host-only work not performed by repository automation

The repository cannot claim these complete until observed on the real VPS:

- OS hardening/patching;
- SSH/firewall configuration;
- Docker Engine/Compose installation;
- existing NPM inventory and safe network attachment;
- LA Clothing NPM Proxy Host and certificate issuance;
- production DNS;
- real secret installation;
- off-site backup scheduling and restore drill;
- external uptime/disk/backup/NPM alerting;
- controlled Pancake create -> verify -> cancel acceptance;
- first real production deploy and public smoke.
