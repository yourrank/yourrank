-- yourrank:migration-phase: expand
-- Per-site creator authorization (docs/PROVIDER_PORTABILITY_PLAN.md §4).
--
-- `creator_connections` holds one connection per (user, provider). A creator
-- who runs several sites and connects one of them with a different provider
-- account used to re-point that single row; the channel-invalidation trigger
-- then silently unverified every other site bound through it.
--
-- `site_creator_connections` stores the provider authorization a site was
-- connected with when that account differs from the one its owner's account
-- connection already verifies for another site. A community channel is proven
-- either by `creator_connection_id` (account connection, unchanged) or by
-- `site_creator_connection_id` (this table). Tokens are never copied between
-- the two: each OAuth grant lives in exactly one row.
--
-- Additive only: one table, one nullable column, indexes, triggers. Existing
-- bindings keep creator_connection_id, so no backfill is needed.

CREATE TABLE IF NOT EXISTS public.site_creator_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_user_id text NOT NULL,
  username text,
  verified_channel_id text NOT NULL,
  access_token_enc text,
  refresh_token_enc text,
  token_expires_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  linked_at timestamptz,
  unlinked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, provider)
);

COMMENT ON TABLE public.site_creator_connections IS
  'Provider authorization a single site was connected with, used when it differs from the owner''s account-level creator connection. '
  'Lets each site keep its own provider account without invalidating the owner''s other sites.';
COMMENT ON COLUMN public.site_creator_connections.verified_channel_id IS
  'External channel id the provider-specific verification proved this authorization owns; routing requires it to equal the bound channel.';

CREATE INDEX IF NOT EXISTS idx_site_creator_connections_provider_external
  ON public.site_creator_connections (provider, external_user_id);
CREATE INDEX IF NOT EXISTS idx_site_creator_connections_user
  ON public.site_creator_connections (user_id);

ALTER TABLE public.community_channels
  ADD COLUMN IF NOT EXISTS site_creator_connection_id uuid
    REFERENCES public.site_creator_connections(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.community_channels.site_creator_connection_id IS
  'Site-scoped authorization that verified this channel when the account-level creator connection did not. '
  'Exactly one of creator_connection_id / site_creator_connection_id proves a verified binding.';

CREATE INDEX IF NOT EXISTS idx_community_channels_site_creator_connection
  ON public.community_channels (site_creator_connection_id);

-- One active owner per provider identity, across both connection tables: a
-- site authorization may only belong to the site's owner, and never to an
-- identity another user holds actively (account-level or site-level).
CREATE FUNCTION public.trg_site_creator_connection_ownership() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'revoked' THEN
    IF TG_OP = 'INSERT' OR OLD.status <> 'revoked' OR NEW.unlinked_at IS NULL THEN
      NEW.unlinked_at := COALESCE(NEW.unlinked_at, now());
    END IF;
    RETURN NEW;
  END IF;
  NEW.unlinked_at := NULL;
  IF NOT EXISTS (SELECT 1 FROM public.sites s WHERE s.id = NEW.site_id AND s.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'Site creator connection must belong to the site owner'
      USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('creator_identity:' || NEW.provider || ':' || NEW.external_user_id));
  IF EXISTS (
    SELECT 1 FROM public.creator_connections cc
     WHERE cc.provider = NEW.provider AND cc.external_user_id = NEW.external_user_id
       AND cc.status <> 'revoked' AND cc.user_id <> NEW.user_id
  ) OR EXISTS (
    SELECT 1 FROM public.site_creator_connections sc
     WHERE sc.provider = NEW.provider AND sc.external_user_id = NEW.external_user_id
       AND sc.status <> 'revoked' AND sc.user_id <> NEW.user_id AND sc.id <> NEW.id
  ) THEN
    RAISE unique_violation USING
      MESSAGE = format('site_creator_connections %s identity %s is already linked to another account', NEW.provider, NEW.external_user_id),
      CONSTRAINT = 'site_creator_connections_active_external_id';
  END IF;
  RETURN NEW;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'site_creator_connection_ownership' AND tgrelid = 'public.site_creator_connections'::regclass) THEN
    CREATE TRIGGER site_creator_connection_ownership
      BEFORE INSERT OR UPDATE ON public.site_creator_connections
      FOR EACH ROW EXECUTE FUNCTION public.trg_site_creator_connection_ownership();
  END IF;
END $$;

-- The reverse direction: an account-level connection may not take an identity
-- another user actively holds through a site authorization.
CREATE FUNCTION public.trg_creator_connection_site_identity_ownership() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'revoked' THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('creator_identity:' || NEW.provider || ':' || NEW.external_user_id));
  IF EXISTS (
    SELECT 1 FROM public.site_creator_connections sc
     WHERE sc.provider = NEW.provider AND sc.external_user_id = NEW.external_user_id
       AND sc.status <> 'revoked' AND sc.user_id <> NEW.user_id
  ) THEN
    RAISE unique_violation USING
      MESSAGE = format('creator_connections %s identity %s is already linked to another account', NEW.provider, NEW.external_user_id),
      CONSTRAINT = 'site_creator_connections_active_external_id';
  END IF;
  RETURN NEW;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'creator_connection_site_identity_ownership' AND tgrelid = 'public.creator_connections'::regclass) THEN
    CREATE TRIGGER creator_connection_site_identity_ownership
      BEFORE INSERT OR UPDATE OF external_user_id, status, user_id ON public.creator_connections
      FOR EACH ROW EXECUTE FUNCTION public.trg_creator_connection_site_identity_ownership();
  END IF;
END $$;

-- Legacy compatibility: `creator_connection_invalidates_channels` clears
-- sites.kick_channel_verified_at for every site of the user whose channel has
-- no account-level connection, which includes sites proven by their own
-- authorization. Keep the legacy proof of such a site while that authorization
-- still verifies the same channel; the expand mirror then leaves
-- community_channels.verified_at intact.
CREATE FUNCTION public.trg_sites_keep_site_authorized_kick_channel() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.kick_channel_verified_at IS NOT NULL
     AND NEW.kick_channel_verified_at IS NULL
     AND NEW.kick_channel_external_id IS NOT DISTINCT FROM OLD.kick_channel_external_id
     AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
     AND EXISTS (
       SELECT 1
         FROM public.community_channels ch
         JOIN public.site_creator_connections sc ON sc.id = ch.site_creator_connection_id
        WHERE ch.site_id = NEW.id AND ch.provider = 'kick' AND ch.status = 'active'
          AND ch.external_channel_id = NEW.kick_channel_external_id
          AND sc.site_id = NEW.id AND sc.user_id = NEW.user_id AND sc.provider = 'kick'
          AND sc.status = 'active' AND sc.verified_channel_id = ch.external_channel_id
     )
  THEN
    NEW.kick_channel_verified_at := OLD.kick_channel_verified_at;
  END IF;
  RETURN NEW;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'keep_site_authorized_kick_channel' AND tgrelid = 'public.sites'::regclass) THEN
    CREATE TRIGGER keep_site_authorized_kick_channel
      BEFORE UPDATE OF kick_channel_verified_at ON public.sites
      FOR EACH ROW EXECUTE FUNCTION public.trg_sites_keep_site_authorized_kick_channel();
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE public.site_creator_connections TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yourrank_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.site_creator_connections TO yourrank_app;
  END IF;
END $$;
