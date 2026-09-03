-- yourrank:migration-phase: expand
--
-- F-057 / F-015: trustworthy restore evidence.
--
-- * Freshness must come from a server-controlled timestamp: `verified_at` is
--   stamped by the database on insert regardless of what the client sent.
--   Operator/workflow `completed_at` stays as metadata but may not be in the
--   future beyond a small clock-skew tolerance, and chronology / RTO / RPO are
--   validated database-side so no writer (admin API, drill workflow, N-1 Worker)
--   can make the backup health signal falsely green.
-- * Successful rows can carry verifiable, secret-free evidence (workflow run id,
--   source backup id, restore target, release SHA, integrity result).
--
-- Expand-safe: columns are nullable, existing rows are untouched (their
-- verified_at stays NULL so pre-migration rows cannot look freshly verified),
-- the trigger only rejects rows that were never legitimate. The N-1 Worker's
-- insert (provider, target, started_at, completed_at, rto, rpo, success, notes)
-- keeps working unchanged.

ALTER TABLE public.backup_verifications
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS recorded_by TEXT,
  ADD COLUMN IF NOT EXISTS release_sha TEXT,
  ADD COLUMN IF NOT EXISTS evidence JSONB;

COMMENT ON COLUMN public.backup_verifications.verified_at IS
  'Server-controlled recording time (set by trigger on insert); freshness is computed from this, never from client-supplied completed_at.';
COMMENT ON COLUMN public.backup_verifications.evidence IS
  'Secret-free restore evidence: workflow run id, source backup id, restore target, integrity checks, RTO/RPO inputs.';

CREATE SCHEMA IF NOT EXISTS app_private;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app_private' AND p.proname = 'validate_backup_verification'
  ) THEN
    CREATE FUNCTION app_private.validate_backup_verification()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $fn$
    DECLARE
      -- Small explicit tolerance for clock differences between writers and DB.
      skew CONSTANT interval := interval '5 minutes';
    BEGIN
      IF TG_OP = 'INSERT' THEN
        NEW.verified_at := now();
      ELSE
        NEW.verified_at := OLD.verified_at;
      END IF;
      IF NEW.completed_at IS NULL THEN
        RAISE EXCEPTION 'backup_verifications.completed_at is required'
          USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.completed_at > now() + skew THEN
        RAISE EXCEPTION 'backup_verifications.completed_at % is in the future (tolerance %)', NEW.completed_at, skew
          USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.started_at IS NOT NULL AND NEW.started_at > NEW.completed_at THEN
        RAISE EXCEPTION 'backup_verifications.started_at % is after completed_at %', NEW.started_at, NEW.completed_at
          USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.rto_seconds IS NOT NULL AND NEW.rto_seconds < 0 THEN
        RAISE EXCEPTION 'backup_verifications.rto_seconds must be non-negative'
          USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.rpo_seconds IS NOT NULL AND NEW.rpo_seconds < 0 THEN
        RAISE EXCEPTION 'backup_verifications.rpo_seconds must be non-negative'
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END
    $fn$;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'backup_verifications_validate'
      AND tgrelid = 'public.backup_verifications'::regclass
  ) THEN
    CREATE TRIGGER backup_verifications_validate
      BEFORE INSERT OR UPDATE ON public.backup_verifications
      FOR EACH ROW EXECUTE FUNCTION app_private.validate_backup_verification();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_backup_verifications_success_verified
  ON public.backup_verifications(success, verified_at DESC);
