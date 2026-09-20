-- yourrank:migration-phase: expand
--
-- Server-backed Chat Giveaways. Entries are collected from official Kick
-- `chat.message.sent` webhooks routed through the verified community channel,
-- so collection no longer depends on a browser tab holding a chat socket.
--
-- Additive only: one nullable column, two tables, indexes and grants.

-- Recorded when the creator connection successfully subscribed the channel to
-- chat events. Chat giveaways are only "ready" while this is set.
ALTER TABLE public.community_channels
  ADD COLUMN IF NOT EXISTS chat_events_subscribed_at timestamptz;

COMMENT ON COLUMN public.community_channels.chat_events_subscribed_at IS
  'Set when the verifying creator connection subscribed this channel to provider chat events (Kick chat.message.sent). NULL means chat giveaways are not ready.';

CREATE TABLE IF NOT EXISTS public.chat_giveaway_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'kick',
  keyword text NOT NULL CHECK (char_length(keyword) BETWEEN 1 AND 64),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stopped', 'completed', 'cancelled')),
  started_at timestamptz NOT NULL DEFAULT now(),
  stopped_at timestamptz,
  -- Points at chat_giveaway_entries.id; entries cascade with the session, so
  -- the application validates the reference instead of a circular FK.
  winner_entry_id uuid,
  drawn_at timestamptz,
  winner_confirmed_at timestamptz,
  winner_confirmation_message text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- One collecting giveaway per site; a second start fails with 23P01.
  CONSTRAINT uq_chat_giveaway_sessions_one_active_per_site
    EXCLUDE USING btree (site_id WITH =) WHERE (status = 'active')
);
COMMENT ON TABLE public.chat_giveaway_sessions IS
  'One chat-keyword giveaway run for a site. Entries are only collected while status = active.';

CREATE INDEX IF NOT EXISTS idx_chat_giveaway_sessions_site_created
  ON public.chat_giveaway_sessions (site_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.chat_giveaway_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  giveaway_session_id uuid NOT NULL REFERENCES public.chat_giveaway_sessions(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'kick',
  provider_user_id text NOT NULL,
  username text NOT NULL,
  avatar_url text,
  message text NOT NULL DEFAULT '',
  badges jsonb NOT NULL DEFAULT '[]'::jsonb,
  entered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (giveaway_session_id, provider_user_id)
);
COMMENT ON TABLE public.chat_giveaway_entries IS
  'One row per viewer per giveaway session, keyed by the stable provider user id (never by username).';

CREATE INDEX IF NOT EXISTS idx_chat_giveaway_entries_session_entered
  ON public.chat_giveaway_entries (giveaway_session_id, entered_at);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE public.chat_giveaway_sessions TO service_role;
    GRANT ALL ON TABLE public.chat_giveaway_entries TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yourrank_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.chat_giveaway_sessions TO yourrank_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.chat_giveaway_entries TO yourrank_app;
  END IF;
END $$;
