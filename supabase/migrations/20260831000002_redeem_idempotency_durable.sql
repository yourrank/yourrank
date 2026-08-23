-- Phase 6 correction: make viewer redemption idempotency keys durable.
-- The original partial unique index only protected tokens while a redemption
-- was pending or fulfilled, which let cancellation make a token reusable and
-- allowed duplicate cancelled rows. Remove duplicates and enforce a full
-- unique constraint on (site_viewer_id, client_token) so the original order
-- is always returned for a given token, even after cancellation.
DROP INDEX IF EXISTS idx_redemptions_site_viewer_client_token_active;

WITH ranked AS (
  SELECT id,
    row_number() OVER (
      PARTITION BY site_viewer_id, client_token
      ORDER BY
        CASE status
          WHEN 'pending' THEN 0
          WHEN 'fulfilled' THEN 1
          ELSE 2
        END,
        created_at DESC
    ) AS rn
  FROM public.redemptions
  WHERE client_token IS NOT NULL
)
DELETE FROM public.redemptions
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_redemptions_site_viewer_client_token
  ON public.redemptions (site_viewer_id, client_token)
  WHERE client_token IS NOT NULL;
