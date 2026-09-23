-- yourrank:migration-phase: expand
-- Board-scoped API keys and server-persisted idempotency for the write API.
-- A NULL site_id keeps the existing account-level key semantics; a set site_id
-- restricts the key to that one board.

ALTER TABLE postback_keys
  ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES sites(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_postback_keys_site_active
  ON postback_keys(site_id)
  WHERE revoked_at IS NULL AND site_id IS NOT NULL;

-- Idempotency-Key reservations for POST/PATCH /api/scores. A reservation is a
-- 60-second in-progress lock; a completed row replays its stored response for
-- the TTL window.
CREATE TABLE IF NOT EXISTS api_idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed')),
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (user_id, site_id, endpoint, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_api_idempotency_keys_expires_at
  ON api_idempotency_keys(expires_at);

-- RLS + service_role-only policy for api_idempotency_keys must ship in a
-- later contract-phase migration; the expand-phase preflight rejects
-- ENABLE ROW LEVEL SECURITY here (same pattern as chat_giveaway_*).
