-- yourrank:migration-phase: expand
--
-- Transactional viewer notifications: in-app records written server-side at
-- validated claim and claim-support transitions. Not a broadcast/campaign
-- system; creators cannot author rows directly.
--
-- Additive only. dedupe_key is the idempotency contract for one domain
-- transition (e.g. `claim_completed:<redemption id>`), so a retried action
-- inserts with ON CONFLICT DO NOTHING instead of duplicating the row.

CREATE TABLE IF NOT EXISTS public.viewer_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  viewer_id uuid NOT NULL REFERENCES public.viewers(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('claim_completed', 'claim_cancelled', 'claim_support_reply', 'claim_support_resolved')),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  claim_id uuid REFERENCES public.redemptions(id) ON DELETE CASCADE,
  support_request_id uuid REFERENCES public.claim_support_requests(id) ON DELETE CASCADE,
  dedupe_key text NOT NULL UNIQUE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 500),
  href text NOT NULL CHECK (href ~ '^/[^/]'),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.viewer_notifications IS
  'In-app transactional notifications for one viewer, created at validated claim/support transitions. dedupe_key makes retries idempotent.';

CREATE INDEX IF NOT EXISTS idx_viewer_notifications_viewer_created
  ON public.viewer_notifications (viewer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_viewer_notifications_viewer_unread
  ON public.viewer_notifications (viewer_id, created_at DESC)
  WHERE read_at IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE public.viewer_notifications TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yourrank_app') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE public.viewer_notifications TO yourrank_app;
  END IF;
END $$;
