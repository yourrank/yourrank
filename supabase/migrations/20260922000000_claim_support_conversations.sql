-- yourrank:migration-phase: expand
--
-- Claim support conversations: a creator <-> viewer thread attached to one
-- reward claim (redemptions row). Distinct from public.support_messages, which
-- is YourRank's own account/site support inbox and stays untouched.
--
-- Additive only. "At most one open request per claim" is enforced by the
-- handler inside a transaction that locks the redemption row; a partial unique
-- index is a contract-phase change and is deliberately not added here.

CREATE TABLE IF NOT EXISTS public.claim_support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES public.redemptions(id) ON DELETE CASCADE,
  viewer_id uuid NOT NULL REFERENCES public.viewers(id) ON DELETE CASCADE,
  issue_type text NOT NULL CHECK (issue_type IN ('reward_not_received', 'wrong_or_invalid_reward', 'taking_too_long', 'other')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
COMMENT ON TABLE public.claim_support_requests IS
  'Viewer-opened help request for one reward claim; the creator of the claim''s site answers and resolves it. Not YourRank support.';

CREATE INDEX IF NOT EXISTS idx_claim_support_requests_claim_status
  ON public.claim_support_requests (claim_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.claim_support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  support_request_id uuid NOT NULL REFERENCES public.claim_support_requests(id) ON DELETE CASCADE,
  sender_type text NOT NULL CHECK (sender_type IN ('viewer', 'creator')),
  sender_id uuid NOT NULL,
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.claim_support_messages IS
  'Text-only messages of a claim support request. sender_id is viewers.id for viewer messages and users.id for creator messages.';

CREATE INDEX IF NOT EXISTS idx_claim_support_messages_request_created
  ON public.claim_support_messages (support_request_id, created_at ASC);

DO $$
DECLARE
  rel text;
BEGIN
  FOREACH rel IN ARRAY ARRAY['claim_support_requests', 'claim_support_messages'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', rel);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yourrank_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public.%I TO yourrank_app', rel);
    END IF;
  END LOOP;
END $$;
