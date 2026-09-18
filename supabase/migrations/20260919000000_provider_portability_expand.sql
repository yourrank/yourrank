-- yourrank:migration-phase: expand
--
-- Provider portability, expand phase. See docs/PROVIDER_PORTABILITY_PLAN.md.
--
-- Adds provider-neutral identity, connection, channel and event tables next to
-- the Kick/Discord-specific columns, backfills them, and installs triggers that
-- mirror every legacy-column write into the new tables. No existing column is
-- renamed, dropped or constrained; no application read path changes here.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.viewer_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  viewer_id uuid NOT NULL REFERENCES public.viewers(id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_user_id text NOT NULL,
  username text,
  avatar_url text,
  access_token_enc text,
  refresh_token_enc text,
  token_expires_at timestamptz,
  scopes text[],
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  linked_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_user_id),
  UNIQUE (viewer_id, provider)
);
COMMENT ON TABLE public.viewer_identities IS
  'One row per (Viewer Account, provider) link. Mirrors viewers.kick_*/discord_* during the expand phase; becomes the identity source of truth after reads switch.';

CREATE TABLE IF NOT EXISTS public.creator_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_user_id text NOT NULL,
  username text,
  access_token_enc text,
  refresh_token_enc text,
  token_expires_at timestamptz,
  scopes text[],
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  linked_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_user_id),
  UNIQUE (user_id, provider)
);
COMMENT ON TABLE public.creator_connections IS
  'One row per (creator user, provider) OAuth connection. Mirrors users.kick_* during the expand phase.';

CREATE TABLE IF NOT EXISTS public.community_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_channel_id text NOT NULL,
  external_channel_name text,
  linked_at timestamptz,
  verified_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_channel_id),
  UNIQUE (site_id, provider)
);
COMMENT ON TABLE public.community_channels IS
  'External channels bound to a site/community, one per provider. verified_at carries the owner-corroborated proof semantics of sites.kick_channel_verified_at; NULL bindings must not receive provider events.';

CREATE TABLE IF NOT EXISTS public.integration_events (
  id bigserial PRIMARY KEY,
  provider text NOT NULL,
  external_event_id text NOT NULL,
  event_type text NOT NULL,
  payload_type text,
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  external_actor_id text,
  viewer_id uuid REFERENCES public.viewers(id) ON DELETE SET NULL,
  status text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (provider, external_event_id)
);
COMMENT ON TABLE public.integration_events IS
  'Normalized creator-platform events (Kick, later Twitch, ...). event_type is the internal type (reward_redemption, follow, ...); payload_type is the raw provider event name. Not to be confused with provider_events, which is the payment-provider ledger.';
CREATE INDEX IF NOT EXISTS idx_integration_events_site_received
  ON public.integration_events (site_id, received_at DESC);

ALTER TABLE public.credit_ledger
  ADD COLUMN IF NOT EXISTS integration_event_id bigint REFERENCES public.integration_events(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_credit_ledger_integration_event_id
  ON public.credit_ledger (integration_event_id);

ALTER TABLE public.credit_reward_mappings
  ADD COLUMN IF NOT EXISTS provider text DEFAULT 'kick';
COMMENT ON COLUMN public.credit_reward_mappings.provider IS
  'Provider that owns kick_reward_id (the external reward id). Nullable during the expand phase; every current row is kick.';

-- ---------------------------------------------------------------------------
-- 2. Access: backend grants. anon/authenticated have no default privileges on
--    public tables (20260718000004); RLS enablement is a later, deliberate step
--    like the other post-baseline expand tables.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  rel text;
BEGIN
  FOREACH rel IN ARRAY ARRAY['viewer_identities', 'creator_connections', 'community_channels', 'integration_events'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', rel);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yourrank_app') THEN
      EXECUTE format('GRANT ALL ON TABLE public.%I TO yourrank_app', rel);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yourrank_app') THEN
    GRANT USAGE, SELECT ON SEQUENCE public.integration_events_id_seq TO yourrank_app;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Mirror functions + triggers (legacy columns -> new tables)
--    Triggers only ever write to the new tables. Removing them is the rollback.
--    Clearing a legacy id (unlink) marks the mirrored row revoked / unverified
--    rather than deleting it, so history stays auditable.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.mirror_viewer_identity(
  p_viewer_id uuid, p_provider text, p_external_user_id text, p_username text,
  p_avatar_url text, p_access_enc text, p_refresh_enc text, p_expires_at timestamptz, p_linked_at timestamptz
) RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_external_user_id IS NULL OR p_external_user_id = '' THEN
    UPDATE public.viewer_identities SET status = 'revoked', access_token_enc = NULL, refresh_token_enc = NULL, updated_at = now()
     WHERE viewer_id = p_viewer_id AND provider = p_provider AND status <> 'revoked';
    RETURN;
  END IF;
  INSERT INTO public.viewer_identities AS vi
    (viewer_id, provider, external_user_id, username, avatar_url, access_token_enc, refresh_token_enc, token_expires_at, linked_at)
  VALUES (p_viewer_id, p_provider, p_external_user_id, NULLIF(p_username, ''), NULLIF(p_avatar_url, ''), p_access_enc, p_refresh_enc, p_expires_at, p_linked_at)
  ON CONFLICT (viewer_id, provider) DO UPDATE
     SET external_user_id = EXCLUDED.external_user_id,
         username = EXCLUDED.username,
         avatar_url = EXCLUDED.avatar_url,
         access_token_enc = EXCLUDED.access_token_enc,
         refresh_token_enc = EXCLUDED.refresh_token_enc,
         token_expires_at = EXCLUDED.token_expires_at,
         linked_at = EXCLUDED.linked_at,
         status = 'active',
         updated_at = now();
END $$;

CREATE FUNCTION public.trg_mirror_viewer_identities() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.mirror_viewer_identity(NEW.id, 'kick', NEW.kick_user_id, NEW.kick_username,
    COALESCE(NULLIF(NEW.kick_avatar_url, ''), NEW.avatar_url), NEW.kick_access_token_enc, NEW.kick_refresh_token_enc,
    NEW.kick_token_expires_at, NEW.kick_linked_at);
  PERFORM public.mirror_viewer_identity(NEW.id, 'discord', NEW.discord_user_id, NEW.discord_username,
    NEW.avatar_url, NEW.discord_access_token_enc, NEW.discord_refresh_token_enc,
    NEW.discord_token_expires_at, NEW.discord_linked_at);
  RETURN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'mirror_viewer_identities' AND tgrelid = 'public.viewers'::regclass) THEN
    CREATE TRIGGER mirror_viewer_identities
  AFTER INSERT OR UPDATE OF kick_user_id, kick_username, kick_avatar_url, kick_access_token_enc, kick_refresh_token_enc,
    kick_token_expires_at, kick_linked_at, discord_user_id, discord_username, discord_access_token_enc,
    discord_refresh_token_enc, discord_token_expires_at, discord_linked_at, avatar_url
    ON public.viewers
    FOR EACH ROW EXECUTE FUNCTION public.trg_mirror_viewer_identities();
  END IF;
END $$;

CREATE FUNCTION public.trg_mirror_creator_connections() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.kick_user_id IS NULL OR NEW.kick_user_id = '' THEN
    UPDATE public.creator_connections SET status = 'revoked', access_token_enc = NULL, refresh_token_enc = NULL, updated_at = now()
     WHERE user_id = NEW.id AND provider = 'kick' AND status <> 'revoked';
    RETURN NULL;
  END IF;
  INSERT INTO public.creator_connections AS cc
    (user_id, provider, external_user_id, username, access_token_enc, refresh_token_enc, token_expires_at, linked_at)
  VALUES (NEW.id, 'kick', NEW.kick_user_id, NULLIF(NEW.kick_username, ''), NEW.kick_access_token_enc,
    NEW.kick_refresh_token_enc, NEW.kick_token_expires_at, NEW.kick_linked_at)
  ON CONFLICT (user_id, provider) DO UPDATE
     SET external_user_id = EXCLUDED.external_user_id,
         username = EXCLUDED.username,
         access_token_enc = EXCLUDED.access_token_enc,
         refresh_token_enc = EXCLUDED.refresh_token_enc,
         token_expires_at = EXCLUDED.token_expires_at,
         linked_at = EXCLUDED.linked_at,
         status = 'active',
         updated_at = now();
  RETURN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'mirror_creator_connections' AND tgrelid = 'public.users'::regclass) THEN
    CREATE TRIGGER mirror_creator_connections
  AFTER INSERT OR UPDATE OF kick_user_id, kick_username, kick_access_token_enc, kick_refresh_token_enc,
    kick_token_expires_at, kick_linked_at
    ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.trg_mirror_creator_connections();
  END IF;
END $$;

CREATE FUNCTION public.trg_mirror_community_channels() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.kick_channel_external_id IS NULL OR NEW.kick_channel_external_id = '' THEN
    UPDATE public.community_channels SET verified_at = NULL, updated_at = now()
     WHERE site_id = NEW.id AND provider = 'kick' AND verified_at IS NOT NULL;
    RETURN NULL;
  END IF;
  INSERT INTO public.community_channels AS ch
    (site_id, provider, external_channel_id, external_channel_name, linked_at, verified_at)
  VALUES (NEW.id, 'kick', NEW.kick_channel_external_id, NULLIF(NEW.kick_channel_name, ''),
    NEW.kick_channel_linked_at, NEW.kick_channel_verified_at)
  ON CONFLICT (site_id, provider) DO UPDATE
     SET external_channel_id = EXCLUDED.external_channel_id,
         external_channel_name = EXCLUDED.external_channel_name,
         linked_at = EXCLUDED.linked_at,
         verified_at = EXCLUDED.verified_at,
         updated_at = now();
  RETURN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'mirror_community_channels' AND tgrelid = 'public.sites'::regclass) THEN
    CREATE TRIGGER mirror_community_channels
  AFTER INSERT OR UPDATE OF kick_channel_external_id, kick_channel_name, kick_channel_linked_at, kick_channel_verified_at
    ON public.sites
    FOR EACH ROW EXECUTE FUNCTION public.trg_mirror_community_channels();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Backfill existing rows through the same mirror logic
-- ---------------------------------------------------------------------------

SELECT public.mirror_viewer_identity(v.id, 'kick', v.kick_user_id, v.kick_username,
    COALESCE(NULLIF(v.kick_avatar_url, ''), v.avatar_url), v.kick_access_token_enc, v.kick_refresh_token_enc,
    v.kick_token_expires_at, v.kick_linked_at)
  FROM public.viewers v WHERE v.kick_user_id IS NOT NULL;

SELECT public.mirror_viewer_identity(v.id, 'discord', v.discord_user_id, v.discord_username,
    v.avatar_url, v.discord_access_token_enc, v.discord_refresh_token_enc,
    v.discord_token_expires_at, v.discord_linked_at)
  FROM public.viewers v WHERE v.discord_user_id IS NOT NULL;

INSERT INTO public.creator_connections (user_id, provider, external_user_id, username, access_token_enc, refresh_token_enc, token_expires_at, linked_at)
SELECT u.id, 'kick', u.kick_user_id, NULLIF(u.kick_username, ''), u.kick_access_token_enc, u.kick_refresh_token_enc, u.kick_token_expires_at, u.kick_linked_at
  FROM public.users u
 WHERE u.kick_user_id IS NOT NULL AND u.kick_user_id <> ''
ON CONFLICT (user_id, provider) DO NOTHING;

INSERT INTO public.community_channels (site_id, provider, external_channel_id, external_channel_name, linked_at, verified_at)
SELECT s.id, 'kick', s.kick_channel_external_id, NULLIF(s.kick_channel_name, ''), s.kick_channel_linked_at, s.kick_channel_verified_at
  FROM public.sites s
 WHERE s.kick_channel_external_id IS NOT NULL AND s.kick_channel_external_id <> ''
ON CONFLICT (site_id, provider) DO NOTHING;

INSERT INTO public.integration_events
  (provider, external_event_id, event_type, payload_type, site_id, external_actor_id, viewer_id, status, payload, received_at, processed_at)
SELECT 'kick', k.event_id, 'reward_redemption', k.event_type, k.site_id, k.redeemer_kick_user_id,
       (SELECT v.id FROM public.viewers v WHERE v.kick_user_id = k.redeemer_kick_user_id),
       k.status, COALESCE(k.payload, '{}'::jsonb), k.created_at, k.processed_at
  FROM public.kick_reward_events k
ON CONFLICT (provider, external_event_id) DO NOTHING;

UPDATE public.credit_ledger cl
   SET integration_event_id = ie.id
  FROM public.integration_events ie
 WHERE cl.integration_event_id IS NULL
   AND cl.kick_event_id IS NOT NULL
   AND ie.provider = 'kick'
   AND ie.external_event_id = cl.kick_event_id;

UPDATE public.credit_reward_mappings SET provider = 'kick' WHERE provider IS NULL;
