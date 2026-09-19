-- yourrank:migration-phase: expand
-- Provider portability, Phase 2.5 (docs/PROVIDER_PORTABILITY_PLAN.md §4). Expand-safe.
--
-- Explicit channel ownership. Until now a community channel routed events to
-- its site only when the site owner's active creator connection had
-- `external_user_id = external_channel_id`. That equality is a Kick fact
-- (a Kick channel is identified by its broadcaster's user id), not a generic
-- one: a Twitch/YouTube/Discord resource id is not the creator's user id.
--
-- The generic model records WHICH creator connection verified the binding:
-- `community_channels.creator_connection_id`. Provider-specific code proves
-- ownership/access before binding; generic routing only checks the reference.
--
-- Additive only: one nullable column, one index, a backfill that applies the
-- legacy rule to the rows that exist today (all Kick).

ALTER TABLE public.community_channels
  ADD COLUMN IF NOT EXISTS creator_connection_id uuid
    REFERENCES public.creator_connections(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.community_channels.creator_connection_id IS
  'Creator connection whose provider-specific verification proved ownership/access to this channel. '
  'Events route to the site only when the referenced connection is active and belongs to the site owner.';

CREATE INDEX IF NOT EXISTS idx_community_channels_creator_connection
  ON public.community_channels (creator_connection_id);

-- Backfill: every verified channel so far was bound by Kick code that required
-- the site owner's Kick creator connection to be the channel itself.
UPDATE public.community_channels ch
   SET creator_connection_id = cc.id,
       updated_at = now()
  FROM public.sites s
  JOIN public.creator_connections cc
    ON cc.user_id = s.user_id
 WHERE ch.site_id = s.id
   AND ch.creator_connection_id IS NULL
   AND cc.provider = ch.provider
   AND cc.status = 'active'
   AND cc.external_user_id = ch.external_channel_id;

-- Legacy compatibility mirror (sites.kick_channel_* -> community_channels).
-- The expand-phase mirror trigger is left untouched (policy: no function
-- replacement in an expand migration); this trigger is named to fire after it
-- and owns only the new column. It IS Kick-specific code, so it may apply the
-- Kick ownership rule (broadcaster user id = channel id) to record the verifying
-- creator connection for rows written through the legacy columns.
CREATE FUNCTION public.trg_mirror_community_channel_ownership() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_connection_id uuid;
BEGIN
  IF NEW.kick_channel_external_id IS NULL OR NEW.kick_channel_external_id = '' THEN
    UPDATE public.community_channels SET creator_connection_id = NULL, updated_at = now()
     WHERE site_id = NEW.id AND provider = 'kick' AND creator_connection_id IS NOT NULL;
    RETURN NULL;
  END IF;
  SELECT cc.id INTO v_connection_id
    FROM public.creator_connections cc
   WHERE cc.user_id = NEW.user_id
     AND cc.provider = 'kick'
     AND cc.status = 'active'
     AND cc.external_user_id = NEW.kick_channel_external_id
   LIMIT 1;
  UPDATE public.community_channels
     SET creator_connection_id = CASE WHEN NEW.kick_channel_verified_at IS NULL THEN NULL ELSE v_connection_id END,
         updated_at = now()
   WHERE site_id = NEW.id AND provider = 'kick'
     AND external_channel_id = NEW.kick_channel_external_id
     AND creator_connection_id IS DISTINCT FROM CASE WHEN NEW.kick_channel_verified_at IS NULL THEN NULL ELSE v_connection_id END;
  RETURN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'mirror_community_channels_zz_ownership' AND tgrelid = 'public.sites'::regclass) THEN
    CREATE TRIGGER mirror_community_channels_zz_ownership
      AFTER INSERT OR UPDATE OF kick_channel_external_id, kick_channel_verified_at, user_id ON public.sites
      FOR EACH ROW EXECUTE FUNCTION public.trg_mirror_community_channel_ownership();
  END IF;
END $$;

-- A channel verification is proof about ONE external creator identity. When
-- the referenced creator connection is revoked or re-linked as a different
-- external identity, that proof no longer applies: drop the verification (the
-- binding row is kept, unverified) and mirror the loss into the legacy Kick
-- column so legacy readers agree. Rebinding re-verifies through provider code.
CREATE FUNCTION public.trg_creator_connection_invalidates_channels() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'revoked' OR NEW.external_user_id IS DISTINCT FROM OLD.external_user_id THEN
    UPDATE public.community_channels
       SET verified_at = NULL, creator_connection_id = NULL, updated_at = now()
     WHERE creator_connection_id = NEW.id;
    IF NEW.provider = 'kick' THEN
      UPDATE public.sites s
         SET kick_channel_verified_at = NULL, updated_at = now()
        FROM public.community_channels ch
       WHERE ch.site_id = s.id AND ch.provider = 'kick'
         AND s.user_id = NEW.user_id
         AND s.kick_channel_verified_at IS NOT NULL
         AND ch.creator_connection_id IS NULL;
    END IF;
  END IF;
  RETURN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'creator_connection_invalidates_channels' AND tgrelid = 'public.creator_connections'::regclass) THEN
    CREATE TRIGGER creator_connection_invalidates_channels
      AFTER UPDATE OF external_user_id, status ON public.creator_connections
      FOR EACH ROW EXECUTE FUNCTION public.trg_creator_connection_invalidates_channels();
  END IF;
END $$;
