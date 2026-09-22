-- yourrank:migration-phase: expand
-- Existing sessions keep chat-only, equal-chance behavior. Roll back code only;
-- keep these additive columns until the previous release is retired.
ALTER TABLE public.chat_giveaway_sessions
  ADD COLUMN rules jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN verification_salt text DEFAULT encode(gen_random_bytes(32), 'hex'),
  ADD COLUMN winner_response_deadline timestamptz;
ALTER TABLE public.chat_giveaway_entries
  ADD COLUMN eligibility_status text DEFAULT 'eligible'
    CHECK (eligibility_status IN ('eligible', 'pending_verification', 'rejected')),
  ADD COLUMN eligibility_reason text,
  ADD COLUMN viewer_id uuid REFERENCES public.viewers(id) ON DELETE SET NULL,
  ADD COLUMN verified_at timestamptz,
  ADD COLUMN ip_hash text;
CREATE INDEX idx_chat_giveaway_verified_ip ON public.chat_giveaway_entries (giveaway_session_id, ip_hash)
  WHERE ip_hash IS NOT NULL AND eligibility_status = 'eligible';
CREATE TABLE public.chat_giveaway_draws (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  giveaway_session_id uuid NOT NULL REFERENCES public.chat_giveaway_sessions(id) ON DELETE CASCADE,
  entry_id uuid REFERENCES public.chat_giveaway_entries(id) ON DELETE SET NULL,
  provider_user_id text NOT NULL,
  drawn_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_giveaway_draws_session ON public.chat_giveaway_draws(giveaway_session_id);
INSERT INTO public.chat_giveaway_draws (giveaway_session_id, entry_id, provider_user_id, drawn_at)
 SELECT gs.id, e.id, e.provider_user_id, gs.drawn_at
 FROM public.chat_giveaway_sessions gs JOIN public.chat_giveaway_entries e ON e.id=gs.winner_entry_id
 WHERE gs.drawn_at IS NOT NULL;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT ALL ON public.chat_giveaway_draws TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='yourrank_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_giveaway_draws TO yourrank_app;
  END IF;
END $$;
COMMENT ON COLUMN public.chat_giveaway_entries.ip_hash IS 'Giveaway-scoped HMAC of normalized verification IP. Never a raw IP; never exposed in API responses.';
