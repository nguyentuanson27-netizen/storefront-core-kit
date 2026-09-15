# LA Clothing

Editorial men's fashion ecommerce storefront with Pancake POS integration.

## Stack

- Next.js 16.2.11 / React 19.2 / TypeScript
- Tailwind CSS v4
- PostgreSQL + Prisma 7.9.1
- Better Auth
- Pancake POS adapter under `src/integrations/pancake/`
- pnpm 11.4.0 on Node.js 22+

## Local commands

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm dev
```

Quality gates:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:db
pnpm build
pnpm release:check
```

`pnpm prisma:migrate:deploy` applies checked-in production migrations.

## Storefront Core Kit

This repository is the Core Kit: the storefront above is one brand's presentation over shared
layers that a second brand is expected to redraw without editing.

### Bootstrapping a brand

```bash
pnpm bootstrap:brand
```

It writes `src/brand/*.config.ts` — identity, navigation, fulfilment and size guide. Brand copy is
read from `BRAND` at every call site, so renaming a brand is a config edit, not a find-and-replace.

### The five page roots a route may reach

`src/app/**` may import from exactly these source roots, and nothing else:

| root | what lives there |
| --- | --- |
| `src/app` | routes themselves |
| `src/routes` | loaders, the route shell, canonical metadata builders |
| `src/brand` | Brand Config |
| `src/components/brand` | presentation a brand redraws or deletes |
| `src/components/headless` | decisions a brand must not re-derive |

Enforced by `tests/support/boundary-verifier.ts` and exercised in
`tests/domain/route-boundary.test.ts`. A route reaching `@/commerce`, `@/db`, `next/server` or
anything else is a boundary violation; the data belongs in a loader under `src/routes`.

### The exact external allowlist

A route may import these packages and no others:

```
react   react-dom   next   next/image   next/link
```

`next/server` (`connection()`) and `next/navigation` (`notFound()`) are deliberately absent: both
are loader concerns. The list lives in `storefrontPagePolicy()` and is asserted exactly, not as a
prefix match.

### `LA_*` environment prefix — kept

`LA_TRACKING_MODE` and `LA_GTM_CONTAINER_ID` keep their prefix on every brand. Renaming them would
touch ~150 references across `src/`, CI, `deploy/vps/`, scripts and docs for no template benefit.
Decided in spec `10-ranh-gioi-khong-lam.md` §7.

### Approved spec and plan

The Core Kit spec and task plan live in the `webtemplate` repository: `docs/00`–`docs/10` for the
boundaries (including §6.1, the one approved Prisma exception) and `tasks/plan.md` for the task
breakdown. Phase notes for what was actually built are in `docs/phase-*-notes.md` here.

## Production deployment

The active production architecture is a self-managed VPS using Docker Compose with Next.js, PostgreSQL, and Caddy.

Repository deployment assets live under `deploy/vps/`:

- `env.example` — placeholder-only production configuration template;
- `compose.yml` — app/PostgreSQL/Caddy/ops topology;
- `Caddyfile` — TLS reverse proxy and trusted client-IP boundary;
- `deploy.sh` — exact-SHA preflight, backup, migration, promotion, and health flow;
- `rollback.sh` — application-image rollback only.

See:

- `docs/decisions/0002-vps-production-infrastructure.md`
- `docs/operations/vps-bootstrap.md`
- `docs/operations/release-and-rollback.md`

Production secrets and VPS credentials must never be committed to this repository.
