-- yourrank:migration-phase: expand
-- Provider webhook delivery receipts. The receipt row is inserted inside the
-- same transaction as the event's side effects, so it is committed only if
-- every side effect committed; a Kick retry after a rolled-back transaction
-- processes normally. The PK claim is the dedup authority for concurrent
-- deliveries.
CREATE TABLE IF NOT EXISTS provider_webhook_receipts (
  provider text NOT NULL,
  message_id text NOT NULL,
  event_type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, message_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_webhook_receipts_processed_at
  ON provider_webhook_receipts(processed_at);

-- One open tournament per site. A row exists iff that site has a tournament
-- with open signups; the PRIMARY KEY is the concurrency authority when two
-- open requests race (a partial unique index on tournaments would be refused
-- by the expand-phase preflight, so the invariant lives in this lock table).
CREATE TABLE IF NOT EXISTS tournament_open_signups (
  site_id uuid PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  tournament_id uuid NOT NULL UNIQUE REFERENCES tournaments(id) ON DELETE CASCADE,
  opened_at timestamptz NOT NULL DEFAULT now()
);

-- Backfill: the newest currently-open tournament per site claims the row.
INSERT INTO tournament_open_signups (site_id, tournament_id)
SELECT DISTINCT ON (site_id) site_id, id FROM tournaments
 WHERE signup_state = 'open' AND status NOT IN ('completed','cancelled')
 ORDER BY site_id, created_at DESC
ON CONFLICT DO NOTHING;

-- RLS + service_role-only policy for provider_webhook_receipts and
-- tournament_open_signups must ship in a later contract-phase migration; the
-- expand-phase preflight rejects ENABLE ROW LEVEL SECURITY here (same
-- pattern as api_idempotency_keys and chat_giveaway_*).
