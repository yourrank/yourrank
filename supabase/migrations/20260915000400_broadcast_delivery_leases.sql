-- yourrank:migration-phase: expand
--
-- C13/F12: broadcast batch ownership becomes a durable lease instead of the
-- FOR UPDATE row lock, which ended the moment the claim UPDATE committed and
-- let a second cron tick double-send a 'sending' broadcast.
--
-- Additive only: nullable columns, no writer cutover. The N-1 worker ignores
-- them and keeps today's behaviour; the leased worker starts claiming through
-- processing_lease_token immediately. Full protection (one worker per
-- broadcast at a time) completes when every cron tick runs the leased worker;
-- a mixed fleet is never worse than the current code, which already re-claims
-- 'sending' rows on every tick.

ALTER TABLE public.broadcasts
  ADD COLUMN IF NOT EXISTS processing_lease_token text,
  ADD COLUMN IF NOT EXISTS processing_lease_expires_at timestamptz;

COMMENT ON COLUMN public.broadcasts.processing_lease_token IS
  'Opaque token held by the worker currently processing a batch; progress writes must match it or be discarded.';
COMMENT ON COLUMN public.broadcasts.processing_lease_expires_at IS
  'Lease validity window. A past or NULL expiry makes a sending broadcast reclaimable by the next tick.';
