-- Idempotency key for viewer redemptions so retries and double-clicks cannot
-- create duplicate orders or double-deduct credits.
ALTER TABLE public.redemptions
  ADD COLUMN IF NOT EXISTS client_token text;

-- A member may reuse a token only after the original redemption is cancelled.
-- Pending or fulfilled redemptions lock the token so retries are safe.
CREATE UNIQUE INDEX IF NOT EXISTS idx_redemptions_site_viewer_client_token_active
  ON public.redemptions (site_viewer_id, client_token)
  WHERE status IN ('pending', 'fulfilled');
