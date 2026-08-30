-- Measured access paths for the selected-site Insights reward aggregates.
-- The completion-event index is intentionally partial: claim lifecycle events
-- are the durable completion clock, and unrelated audit traffic must not grow
-- this read path.
CREATE INDEX IF NOT EXISTS idx_redemptions_site_viewer_created_at
  ON public.redemptions(site_viewer_id, created_at);

CREATE INDEX IF NOT EXISTS idx_redemptions_pending_site_viewer
  ON public.redemptions(site_viewer_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_audit_log_claim_completed_site_window
  ON public.audit_log(
    (details->>'site_id'),
    created_at,
    (details->>'source_id')
  )
  WHERE entity_type = 'claim'
    AND action = 'claim_completed';
