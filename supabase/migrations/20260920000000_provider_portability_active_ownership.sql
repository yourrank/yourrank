-- yourrank:migration-phase: expand
-- Provider portability, switch phase (docs/PROVIDER_PORTABILITY_PLAN.md §4).
--
-- Unlink / rebind semantics. The expand phase kept every historical row and
-- enforced UNIQUE (provider, external_id) over all of them, so an identity or
-- channel that account A legitimately unlinked stayed reserved forever: account
-- B hit a unique violation when linking the same external id. Ownership must be
-- unique among ACTIVE rows only; revoked rows remain for audit.
--
-- Uniqueness is enforced by a BEFORE trigger that serializes on an advisory
-- lock per (table, provider, external id) and raises unique_violation (23505)
-- when another active row owns the id. The one-row-per-(owner, provider)
-- constraints stay, so the legacy mirror functions keep their ON CONFLICT
-- targets and re-linking the same owner reactivates its own historical row.
--
-- Additive only: drops nothing but the over-broad unique constraints, adds
-- nullable columns, new functions, new triggers and non-unique indexes.

-- ---------------------------------------------------------------------------
-- 1. Audit columns + channel binding status
-- ---------------------------------------------------------------------------

ALTER TABLE public.viewer_identities   ADD COLUMN IF NOT EXISTS unlinked_at timestamptz;
ALTER TABLE public.creator_connections ADD COLUMN IF NOT EXISTS unlinked_at timestamptz;
ALTER TABLE public.community_channels  ADD COLUMN IF NOT EXISTS unlinked_at timestamptz;
ALTER TABLE public.community_channels  ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';
COMMENT ON COLUMN public.community_channels.status IS
  'active | revoked. A provider event routes to a site only when status = active AND verified_at IS NOT NULL.';

-- ---------------------------------------------------------------------------
-- 2. Ownership is unique among active rows only
-- ---------------------------------------------------------------------------

ALTER TABLE public.viewer_identities   DROP CONSTRAINT IF EXISTS viewer_identities_provider_external_user_id_key;
ALTER TABLE public.creator_connections DROP CONSTRAINT IF EXISTS creator_connections_provider_external_user_id_key;
ALTER TABLE public.community_channels  DROP CONSTRAINT IF EXISTS community_channels_provider_external_channel_id_key;

CREATE INDEX IF NOT EXISTS idx_viewer_identities_provider_external
  ON public.viewer_identities (provider, external_user_id);
CREATE INDEX IF NOT EXISTS idx_creator_connections_provider_external
  ON public.creator_connections (provider, external_user_id);
CREATE INDEX IF NOT EXISTS idx_community_channels_provider_external
  ON public.community_channels (provider, external_channel_id);

-- Generic for the three tables: TG_ARGV[0] names the external-id column,
-- TG_ARGV[1] the owner column. The owner's own row never conflicts with itself
-- (an INSERT ... ON CONFLICT (owner, provider) re-links it), so the check only
-- looks at active rows held by a different owner.
CREATE FUNCTION public.trg_provider_active_ownership() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  ext_col text := TG_ARGV[0];
  owner_col text := TG_ARGV[1];
  row_json jsonb := to_jsonb(NEW);
  ext_id text := row_json ->> ext_col;
  owner_key text := row_json ->> owner_col;
  new_status text := COALESCE(row_json ->> 'status', 'active');
  old_status text := CASE WHEN TG_OP = 'UPDATE' THEN COALESCE(to_jsonb(OLD) ->> 'status', 'active') END;
  owner_id uuid;
BEGIN
  IF new_status = 'revoked' THEN
    IF TG_OP = 'INSERT' OR old_status <> 'revoked' OR NEW.unlinked_at IS NULL THEN
      NEW.unlinked_at := COALESCE(NEW.unlinked_at, now());
    END IF;
    RETURN NEW;
  END IF;
  NEW.unlinked_at := NULL;
  IF ext_id IS NULL OR ext_id = '' THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(TG_TABLE_NAME || ':' || NEW.provider || ':' || ext_id));
  EXECUTE format(
    'SELECT id FROM %I.%I WHERE provider = $1 AND %I = $2 AND COALESCE(status, ''active'') <> ''revoked'' AND %I::text <> $3 LIMIT 1',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, ext_col, owner_col)
    INTO owner_id USING NEW.provider, ext_id, owner_key;
  IF owner_id IS NOT NULL THEN
    RAISE unique_violation USING
      MESSAGE = format('%s %s identity %s is already linked to another account', TG_TABLE_NAME, NEW.provider, ext_id),
      CONSTRAINT = TG_TABLE_NAME || '_active_external_id';
  END IF;
  RETURN NEW;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'provider_active_ownership' AND tgrelid = 'public.viewer_identities'::regclass) THEN
    CREATE TRIGGER provider_active_ownership
      BEFORE INSERT OR UPDATE ON public.viewer_identities
      FOR EACH ROW EXECUTE FUNCTION public.trg_provider_active_ownership('external_user_id', 'viewer_id');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'provider_active_ownership' AND tgrelid = 'public.creator_connections'::regclass) THEN
    CREATE TRIGGER provider_active_ownership
      BEFORE INSERT OR UPDATE ON public.creator_connections
      FOR EACH ROW EXECUTE FUNCTION public.trg_provider_active_ownership('external_user_id', 'user_id');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'provider_active_ownership' AND tgrelid = 'public.community_channels'::regclass) THEN
    CREATE TRIGGER provider_active_ownership
      BEFORE INSERT OR UPDATE ON public.community_channels
      FOR EACH ROW EXECUTE FUNCTION public.trg_provider_active_ownership('external_channel_id', 'site_id');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Legacy channel unlink -> generic status. The expand-phase mirror only
--    clears verified_at; this trigger (named to fire after it) owns status.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.trg_mirror_community_channel_status() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.kick_channel_external_id IS NULL OR NEW.kick_channel_external_id = '' THEN
    UPDATE public.community_channels SET status = 'revoked', updated_at = now()
     WHERE site_id = NEW.id AND provider = 'kick' AND COALESCE(status, 'active') <> 'revoked';
  ELSE
    UPDATE public.community_channels SET status = 'active', updated_at = now()
     WHERE site_id = NEW.id AND provider = 'kick' AND external_channel_id = NEW.kick_channel_external_id
       AND COALESCE(status, 'active') <> 'active';
  END IF;
  RETURN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'mirror_community_channels_status' AND tgrelid = 'public.sites'::regclass) THEN
    CREATE TRIGGER mirror_community_channels_status
      AFTER INSERT OR UPDATE OF kick_channel_external_id ON public.sites
      FOR EACH ROW EXECUTE FUNCTION public.trg_mirror_community_channel_status();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Backfill: revoked rows get unlinked_at; channels whose legacy binding is
--    gone are revoked instead of merely unverified.
-- ---------------------------------------------------------------------------

UPDATE public.viewer_identities   SET unlinked_at = updated_at WHERE status = 'revoked' AND unlinked_at IS NULL;
UPDATE public.creator_connections SET unlinked_at = updated_at WHERE status = 'revoked' AND unlinked_at IS NULL;
UPDATE public.community_channels SET status = 'active' WHERE status IS NULL;
UPDATE public.community_channels ch
   SET status = 'revoked', unlinked_at = COALESCE(ch.unlinked_at, ch.updated_at)
  FROM public.sites s
 WHERE s.id = ch.site_id AND ch.provider = 'kick' AND ch.status <> 'revoked'
   AND (s.kick_channel_external_id IS NULL OR s.kick_channel_external_id = '' OR s.kick_channel_external_id <> ch.external_channel_id);
