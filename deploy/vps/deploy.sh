#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

# shellcheck source=deploy/vps/project-identity.sh
source "deploy/vps/project-identity.sh"

ENV_FILE="deploy/vps/.env.production"
COMPOSE_FILE="deploy/vps/compose.yml"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/$PROJECT_SLUG}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

# Load only RELEASE_SHA for the exact-checkout invariant. Do not echo env contents.
RELEASE_SHA="$(grep -E '^RELEASE_SHA=' "$ENV_FILE" | tail -n 1 | cut -d= -f2-)"
if [[ -z "$RELEASE_SHA" || "$RELEASE_SHA" == "replace-with-approved-git-sha" ]]; then
  echo "RELEASE_SHA must be set in $ENV_FILE" >&2
  exit 1
fi

ACTUAL_SHA="$(git rev-parse HEAD)"
if [[ "$ACTUAL_SHA" != "$RELEASE_SHA" ]]; then
  echo "Refusing deploy: checkout $ACTUAL_SHA does not match RELEASE_SHA $RELEASE_SHA" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing deploy: git working tree is not clean" >&2
  exit 1
fi

compose=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

"${compose[@]}" config --quiet
"${compose[@]}" build app ops
"${compose[@]}" up -d postgres

for _ in {1..30}; do
  postgres_id="$("${compose[@]}" ps -q postgres)"
  postgres_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$postgres_id" 2>/dev/null || true)"
  if [[ "$postgres_health" == "healthy" ]]; then
    break
  fi
  if [[ "$postgres_health" == "unhealthy" ]]; then
    "${compose[@]}" logs --tail=200 postgres
    echo "PostgreSQL health check failed" >&2
    exit 1
  fi
  sleep 2
done

postgres_id="$("${compose[@]}" ps -q postgres)"
postgres_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$postgres_id" 2>/dev/null || true)"
if [[ "$postgres_health" != "healthy" ]]; then
  "${compose[@]}" logs --tail=200 postgres
  echo "Timed out waiting for PostgreSQL health" >&2
  exit 1
fi

# Validate real production configuration before any database-changing command.
"${compose[@]}" run --rm ops pnpm release:check

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/$PROJECT_SLUG-predeploy-${RELEASE_SHA:0:12}-$(date -u +%Y%m%dT%H%M%SZ).dump"

# This is the pre-migration logical recovery artifact. Off-site replication and
# restore drills remain mandatory host operations before declaring production ready.
"${compose[@]}" exec -T postgres sh -ec \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$BACKUP_FILE"
chmod 600 "$BACKUP_FILE"
echo "Created pre-migration database dump: $BACKUP_FILE"

# Quiesce every database writer of the current release before any migration: the app and the
# catalog sync. A migration may establish a new write invariant (a backfill, a new required ledger
# row); if an old writer kept running between that migration and the new release starting, it could
# create old-shape rows the new code never sees. One always-safe sequence rather than a per-migration
# mode. The cost is real: the storefront is unavailable (Caddy answers 502) for as long as the
# migration runs, so schedule releases with migrations accordingly.
WRITERS=(app catalog-sync)
stopped_writers=()
for writer in "${WRITERS[@]}"; do
  if [[ -n "$("${compose[@]}" ps -q "$writer")" ]]; then
    "${compose[@]}" stop "$writer"
    stopped_writers+=("$writer")
  fi
done

if ! "${compose[@]}" run --rm ops pnpm prisma:migrate:deploy; then
  # `docker compose stop` keeps the stopped containers, so this resumes the exact pre-release writers
  # instead of recreating them from the newly built images. What was not running before is not
  # started: nothing is invented.
  for writer in ${stopped_writers[@]+"${stopped_writers[@]}"}; do
    "${compose[@]}" start "$writer"
  done
  echo "Migration failed; the pre-release writers that were running were restored" >&2
  exit 1
fi

"${compose[@]}" up -d --no-build app caddy catalog-sync

for _ in {1..40}; do
  app_id="$("${compose[@]}" ps -q app)"
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$app_id" 2>/dev/null || true)"
  if [[ "$health" == "healthy" ]]; then
    echo "Application container is healthy at release $RELEASE_SHA"
    exit 0
  fi
  if [[ "$health" == "unhealthy" ]]; then
    "${compose[@]}" logs --tail=200 app
    echo "Application health check failed" >&2
    exit 1
  fi
  sleep 3
done

"${compose[@]}" logs --tail=200 app
echo "Timed out waiting for application health" >&2
exit 1
