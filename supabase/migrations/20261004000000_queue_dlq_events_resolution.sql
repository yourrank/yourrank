-- yourrank:migration-phase: expand
--
-- DLQ resolution columns: every terminal state (replayed / invalid /
-- exhausted) is recorded once so `replayed_at` stays a pure "delivered" marker
-- and actionable-pending becomes `resolved_at IS NULL` instead of
-- `replayed_at IS NULL`. `replay_state = 'failed'` is only ever written when
-- `replay_attempts >= maxAttempts`, so it is the exhausted-budget state by
-- construction and backfills to resolution 'exhausted'.
--
-- Additive + DML backfill only; the N-1 replay path keeps working unchanged
-- (new columns are nullable, and the old `replayed_at IS NULL` pending
-- predicate remains true for every row that is still actionable). The
-- (resolution IS NULL) = (resolved_at IS NULL) invariant is stamped
-- atomically by the replay code paths; a CHECK constraint is a contract
-- change and must follow later through the manual contract-migration
-- workflow (ADD CONSTRAINT is not allowed in the expand phase).

ALTER TABLE public.queue_dlq_events
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolution text;

UPDATE public.queue_dlq_events
SET resolution = 'replayed', resolved_at = replayed_at
WHERE replayed_at IS NOT NULL AND resolved_at IS NULL;

UPDATE public.queue_dlq_events
SET resolution = 'invalid', resolved_at = coalesce(replay_state_changed_at, now())
WHERE replayed_at IS NULL AND replay_state = 'invalid' AND resolved_at IS NULL;

UPDATE public.queue_dlq_events
SET resolution = 'exhausted', resolved_at = coalesce(replay_state_changed_at, now())
WHERE replayed_at IS NULL AND replay_state = 'failed' AND resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_queue_dlq_events_actionable
  ON public.queue_dlq_events (received_at)
  WHERE resolved_at IS NULL;
