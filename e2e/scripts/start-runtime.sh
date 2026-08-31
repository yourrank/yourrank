#!/usr/bin/env bash
# Brings up the isolated runtime the E2E release gate needs: a migrated Postgres
# schema and the leaderboard Worker under `wrangler dev`, over HTTPS because the
# session cookies are Secure. CI and a laptop run the same script so a local pass
# and a CI pass mean the same thing.
#
# Requires PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE for an already-running
# Postgres, and refuses to touch anything that is not obviously local.
# Prints the base URL on stdout; writes the Worker log to $E2E_WORKER_LOG.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${E2E_WORKER_PORT:-8787}"
LOG="${E2E_WORKER_LOG:-/tmp/wrangler-e2e.log}"
: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=yourrank_e2e}"
export PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD

# The suite mutates data, so it must never be pointed at a hosted database.
case "$PGHOST" in
  127.0.0.1 | localhost | ::1 | postgres) ;;
  *)
    echo "refusing to seed a non-local database host: $PGHOST" >&2
    exit 1
    ;;
esac

# This script drops and recreates PGDATABASE, so the name has to be disposable.
case "$PGDATABASE" in
  *e2e* | *test*) ;;
  *)
    echo "refusing to recreate a database whose name is not marked e2e/test: $PGDATABASE" >&2
    exit 1
    ;;
esac

DB_URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}"

echo "--- waiting for Postgres at ${PGHOST}:${PGPORT}"
for _ in $(seq 1 60); do
  pg_isready -q && break
  sleep 1
done
pg_isready

# The baseline migration is not idempotent (bare CREATE TYPE), so the gate owns a
# database it recreates rather than one it re-migrates.
echo "--- recreating database ${PGDATABASE}"
psql -q -d postgres -c "DROP DATABASE IF EXISTS ${PGDATABASE} WITH (FORCE)" \
  -c "CREATE DATABASE ${PGDATABASE}" >/dev/null

echo "--- applying $(ls "$REPO"/supabase/migrations/*.sql | wc -l) migrations"
for f in $(ls "$REPO"/supabase/migrations/*.sql | sort); do
  psql -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null
done

# The Worker reads its local Postgres through the Hyperdrive local binding: the
# HYPERDRIVE binding itself is not resolvable without a Cloudflare account, and
# DATABASE_URL alone is only the fallback path.
echo "--- writing apps/leaderboard/.dev.vars"
cat > "$REPO/apps/leaderboard/.dev.vars" <<EOF
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=$DB_URL
DATABASE_URL=$DB_URL
SESSION_COOKIE_DOMAIN=localhost
ENVIRONMENT=development
ALLOW_DEMO_LOGIN=true
DEMO_USER_EMAIL=demo@yourrank.site
PRO_PRICE_USD=29
MAIL_FROM=YourRank <hey@yourrank.site>
TOKEN_ENC_KEY=${TOKEN_ENC_KEY:-$(openssl rand -hex 32)}
EOF

# A stale .wrangler/state carries Durable Object storage (rate-limit counters)
# across runs and makes repeat gate runs fail on 429s.
rm -rf "$REPO/apps/leaderboard/.wrangler/state"

echo "--- starting wrangler dev on https://localhost:${PORT}"
(
  cd "$REPO/apps/leaderboard"
  # Wrangler resolves the Hyperdrive local connection string from the process
  # environment, not from .dev.vars.
  export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="$DB_URL"
  npx --yes wrangler dev --port "$PORT" --local-protocol https --ip 127.0.0.1 --test-scheduled >"$LOG" 2>&1 &
  echo $! > /tmp/wrangler-e2e.pid
)

export NODE_TLS_REJECT_UNAUTHORIZED=0
for _ in $(seq 1 90); do
  if curl -ksf "https://localhost:${PORT}/health" >/dev/null; then
    echo "--- Worker ready"
    echo "https://localhost:${PORT}"
    exit 0
  fi
  sleep 2
done

echo "::error::Worker did not become ready on https://localhost:${PORT}" >&2
tail -50 "$LOG" >&2
exit 1
