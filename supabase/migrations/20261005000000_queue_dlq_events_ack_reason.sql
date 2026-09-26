-- yourrank:migration-phase: expand
--
-- Operator acknowledgement audit field: when an operator disposes of an
-- actionable DLQ row as `resolution = 'acknowledged'`, the bounded reason is
-- recorded here. It is a dedicated audit column and is never written to
-- `last_replay_error` (which stays free-form runtime text).

ALTER TABLE public.queue_dlq_events
  ADD COLUMN IF NOT EXISTS ack_reason text;
