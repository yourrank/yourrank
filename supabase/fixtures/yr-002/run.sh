#!/bin/sh
# YR-002 local fixture lifecycle. This script deliberately has no database URL
# argument and only operates on the local Docker compose project below.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
REPOSITORY_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../../.." && pwd -P)
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
PROJECT_NAME="yr002-fixtures"
DATABASE="yourrank_yr002_fixtures"

fail() {
  printf '%s\n' "YR-002 fixture runner: $*" >&2
  exit 1
}

assert_local_docker() {
  command -v docker >/dev/null 2>&1 || fail "docker is required; no database command was run"

  case "${DOCKER_HOST:-}" in
    ""|unix://*|npipe://*) ;;
    *) fail "refusing non-local DOCKER_HOST; no database command was run" ;;
  esac

  context_name=$(docker context show 2>/dev/null || true)
  [ -n "$context_name" ] || fail "could not determine Docker context; no database command was run"
  context_host=$(docker context inspect "$context_name" --format '{{.Endpoints.docker.Host}}' 2>/dev/null || true)
  case "$context_host" in
    unix://*|npipe://*) ;;
    *) fail "refusing Docker context with non-local endpoint '$context_host'; no database command was run" ;;
  esac

  docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required; no database command was run"
}

compose() {
  YR002_REPOSITORY_ROOT="$REPOSITORY_ROOT" \
    env -u COMPOSE_FILE docker compose \
      --project-name "$PROJECT_NAME" \
      --file "$COMPOSE_FILE" "$@"
}

wait_for_postgres() {
  attempt=0
  while [ "$attempt" -lt 30 ]; do
    if compose exec -T postgres pg_isready -U postgres -d "$DATABASE" >/dev/null 2>&1; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
  fail "fixture PostgreSQL did not become ready"
}

ensure_started() {
  compose up -d
  wait_for_postgres
}

apply_migrations() {
  find "$REPOSITORY_ROOT/supabase/migrations" -maxdepth 1 -type f -name '*.sql' -print \
    | LC_ALL=C sort \
    | while IFS= read -r migration; do
        base=$(basename "$migration")
        printf '%s\n' "Applying supabase/migrations/$base"
        compose exec -T postgres psql -X -v ON_ERROR_STOP=1 -U postgres -d "$DATABASE" \
          -f "/workspace/supabase/migrations/$base"
      done
}

seed() {
  ensure_started
  printf '%s\n' "Applying YR-002 fixture seed"
  compose exec -T postgres psql -X -v ON_ERROR_STOP=1 -U postgres -d "$DATABASE" \
    -f /workspace/supabase/fixtures/yr-002/seed.sql
}

smoke() {
  ensure_started
  printf '%s\n' "Running read-only YR-002 fixture smoke assertions"
  compose exec -T postgres psql -X -v ON_ERROR_STOP=1 -U postgres -d "$DATABASE" <<'SQL'
BEGIN READ ONLY;
DO $$
DECLARE
  fixture_site uuid := '0b200000-0000-4000-8000-000000000001';
  empty_site uuid := '0b200000-0000-4000-8000-000000000002';
  positive_viewer uuid := '0c200000-0000-4000-8000-000000000001';
  zero_viewer uuid := '0c200000-0000-4000-8000-000000000002';
  empty_member uuid := '0c200000-0000-4000-8000-000000000003';
  non_member uuid := '0c200000-0000-4000-8000-000000000004';
BEGIN
  IF current_database() <> 'yourrank_yr002_fixtures' THEN
    RAISE EXCEPTION 'unexpected database: %', current_database();
  END IF;
  IF (SELECT count(*) FROM sites WHERE id IN (fixture_site, empty_site)) <> 2 THEN
    RAISE EXCEPTION 'expected exactly two YR-002 communities';
  END IF;
  IF (SELECT count(*) FROM shop_items WHERE site_id = fixture_site) <> 4
     OR (SELECT count(*) FROM shop_items WHERE site_id = empty_site) <> 0 THEN
    RAISE EXCEPTION 'catalog coverage is not four populated rewards plus one empty catalog';
  END IF;
  IF (SELECT count(*) FROM shop_items WHERE site_id = fixture_site AND image_key IS NULL) <> 4
     OR NOT EXISTS (SELECT 1 FROM shop_items WHERE site_id = fixture_site AND char_length(name) > 100) THEN
    RAISE EXCEPTION 'missing-media or long-name reward coverage is absent';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM shop_items WHERE id = '0e200000-0000-4000-8000-000000000001' AND active AND stock = 4)
     OR NOT EXISTS (SELECT 1 FROM shop_items WHERE id = '0e200000-0000-4000-8000-000000000002' AND active AND stock = 1)
     OR NOT EXISTS (SELECT 1 FROM shop_items WHERE id = '0e200000-0000-4000-8000-000000000003' AND active AND stock IS NULL)
     OR NOT EXISTS (SELECT 1 FROM shop_items WHERE id = '0e200000-0000-4000-8000-000000000004' AND active AND stock = 0) THEN
    RAISE EXCEPTION 'available or exhausted reward coverage is absent';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM site_viewers WHERE site_id = fixture_site AND viewer_id = positive_viewer AND balance = 375 AND total_earned = 500 AND total_spent = 125)
     OR NOT EXISTS (SELECT 1 FROM site_viewers WHERE site_id = fixture_site AND viewer_id = zero_viewer AND balance = 0)
     OR NOT EXISTS (SELECT 1 FROM site_viewers WHERE site_id = empty_site AND viewer_id = empty_member AND balance = 50) THEN
    RAISE EXCEPTION 'member balance coverage is absent';
  END IF;
  IF NOT EXISTS (
       SELECT 1
         FROM site_viewers sv
         JOIN shop_items si ON si.site_id = sv.site_id
        WHERE sv.viewer_id = positive_viewer AND si.cost <= sv.balance
     ) OR NOT EXISTS (
       SELECT 1
         FROM site_viewers sv
         JOIN shop_items si ON si.site_id = sv.site_id
        WHERE sv.viewer_id = positive_viewer AND si.cost > sv.balance
     ) THEN
    RAISE EXCEPTION 'positive member does not cover both sufficient and insufficient costs';
  END IF;
  IF EXISTS (SELECT 1 FROM site_viewers WHERE viewer_id = non_member)
     OR NOT EXISTS (
       SELECT 1 FROM viewer_sessions
        WHERE viewer_id = non_member
          AND authority = 'global'
          AND site_id IS NULL
          AND hostname IS NULL
          AND domain_binding_id IS NULL
          AND expires_at > now()
     ) THEN
    RAISE EXCEPTION 'signed-in non-member coverage is absent';
  END IF;
  IF (SELECT count(*) FROM redemptions WHERE id IN (
        '0f200000-0000-4000-8000-000000000001',
        '0f200000-0000-4000-8000-000000000002',
        '0f200000-0000-4000-8000-000000000003'
      )) <> 3
     OR (SELECT count(DISTINCT status) FROM redemptions WHERE id IN (
        '0f200000-0000-4000-8000-000000000001',
        '0f200000-0000-4000-8000-000000000002',
        '0f200000-0000-4000-8000-000000000003'
      )) <> 3 THEN
    RAISE EXCEPTION 'pending, fulfilled, and cancelled claim coverage is absent';
  END IF;
END
$$;
ROLLBACK;
SQL
}

usage() {
  cat <<'USAGE'
Usage: ./supabase/fixtures/yr-002/run.sh {reset|seed|smoke|down}

  reset  Destroy only the YR-002 local compose volume, apply all migrations,
         apply the deterministic fixture, and run read-only smoke assertions.
  seed   Reapply only the deterministic fixture to the existing YR-002 database.
  smoke  Run read-only assertions against the existing YR-002 database.
  down   Stop and remove only the YR-002 local compose project and its volume.
USAGE
}

[ "$#" -eq 1 ] || { usage >&2; exit 2; }
assert_local_docker

case "$1" in
  reset)
    compose down --volumes --remove-orphans
    ensure_started
    apply_migrations
    seed
    smoke
    ;;
  seed) seed ;;
  smoke) smoke ;;
  down) compose down --volumes --remove-orphans ;;
  *) usage >&2; exit 2 ;;
esac
