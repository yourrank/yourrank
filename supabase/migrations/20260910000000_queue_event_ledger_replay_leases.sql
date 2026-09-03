-- yourrank:migration-phase: expand
--
-- F-037 / F-050 / F-053 / F-054: queue event identity, durable deduplication,
-- exclusive DLQ replay leases and correlation retention.
--
-- Additive only. The N-1 consumer/bot ignore every new object:
--   * queue_event_ledger is written only by the new consumer/producers;
--   * new queue_dlq_events columns have defaults, and the old replay path
--     (replayed_at / replay_attempts) keeps working unchanged;
--   * dlq health continues to treat replayed_at IS NULL rows as pending.

CREATE TABLE IF NOT EXISTS public.queue_event_ledger (
  event_id         TEXT PRIMARY KEY,
  event_type       TEXT NOT NULL,
  correlation_id   TEXT,
  identity_source  TEXT NOT NULL DEFAULT 'envelope'
                   CHECK (identity_source IN ('envelope', 'cloudflare_message_id')),
  state            TEXT NOT NULL
                   CHECK (state IN ('processing', 'completed', 'failed', 'ambiguous')),
  attempts         INTEGER NOT NULL DEFAULT 1,
  lease_expires_at TIMESTAMPTZ,
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ,
  last_error       TEXT
);

CREATE INDEX IF NOT EXISTS idx_queue_event_ledger_state_first_seen
  ON public.queue_event_ledger (state, first_seen_at);

COMMENT ON TABLE public.queue_event_ledger IS
  'One row per logical queue event id. processing=lease held, completed=side effect applied, failed=retryable, ambiguous=external delivery outcome unknown (never blindly retried).';

ALTER TABLE public.queue_dlq_events
  ADD COLUMN IF NOT EXISTS event_id TEXT,
  ADD COLUMN IF NOT EXISTS correlation_id TEXT,
  ADD COLUMN IF NOT EXISTS replay_state TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS replay_lease_token TEXT,
  ADD COLUMN IF NOT EXISTS replay_lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_replay_error TEXT,
  ADD COLUMN IF NOT EXISTS replay_state_changed_at TIMESTAMPTZ;

-- replay_state values (pending|replaying|replayed|failed|invalid) are enforced by
-- the replay state machine; a CHECK constraint is a later contract-phase change.

UPDATE public.queue_dlq_events
   SET replay_state = 'replayed', replay_state_changed_at = replayed_at
 WHERE replayed_at IS NOT NULL AND COALESCE(replay_state, 'pending') = 'pending';

CREATE INDEX IF NOT EXISTS idx_queue_dlq_events_event_id
  ON public.queue_dlq_events (event_id)
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_queue_dlq_events_replayable
  ON public.queue_dlq_events (received_at)
  WHERE replayed_at IS NULL AND replay_state IN ('pending', 'replaying');
