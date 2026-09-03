-- yourrank:migration-phase: expand
--
-- F-039 / F-044: one coherent backend database identity for the Workers.
--
-- Model
--   yourrank_app     NOLOGIN group role (SEC-DB-01). Holds table/sequence/function
--                    privileges and, from this migration, the RLS policies that let
--                    the backend operate on RLS-enabled application tables.
--   yourrank_worker  LOGIN connection role used by Hyperdrive / DATABASE_URL. It
--                    only inherits yourrank_app; it is NOSUPERUSER, NOBYPASSRLS,
--                    NOCREATEDB, NOCREATEROLE. It has no password until an operator
--                    sets one outside Git (see DEPLOY.md), so it cannot authenticate
--                    before that step.
--
-- EXPAND semantics
--   * Nothing is revoked. The previous Worker identity keeps every privilege it has
--     today, so an N-1 Worker (old credentials) keeps working while the new role is
--     provisioned, verified in staging, and finally switched in Hyperdrive.
--   * Policies are added only for the yourrank_app group. anon / authenticated gain
--     nothing: they keep having no policy on server-only tables.
--   * Removal of the old identity's access is a later CONTRACT migration.

-- 1. Dedicated LOGIN connection role. No password is set here.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yourrank_worker') THEN
    CREATE ROLE yourrank_worker
      LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
  END IF;
END $$;

ALTER ROLE yourrank_worker NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;

GRANT yourrank_app TO yourrank_worker;
GRANT USAGE ON SCHEMA public TO yourrank_worker;

-- 2. Backend RLS policies for every RLS-enabled application table.
--    Existing policies target service_role, which is not a Postgres login the
--    Workers can use. Without a policy for yourrank_app, RLS (not GRANTs) denies
--    every row to the intended backend identity. Policies are additive and scoped
--    to the yourrank_app group only.
DO $$
DECLARE
  rel record;
  policy_name text;
BEGIN
  FOR rel IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND c.relrowsecurity
     ORDER BY c.relname
  LOOP
    policy_name := 'yourrank_app_all_' || rel.relname;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = rel.relname
         AND policyname = policy_name
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO yourrank_app USING (true) WITH CHECK (true)',
        policy_name, rel.relname
      );
    END IF;
  END LOOP;
END $$;

-- 3. Click partition maintenance without table ownership.
--    apps/bot creates the current/next monthly `clicks` partition at startup.
--    `CREATE TABLE ... PARTITION OF` requires owning the parent, which the
--    least-privilege role must not. This SECURITY DEFINER helper performs exactly
--    that operation for a caller-supplied month. Retiring old partitions stays an
--    owner operation (see apps/bot/src/rollup.ts).
--    The helper lives in `app_private`, a schema only the backend group can use, so
--    PostgreSQL's default PUBLIC EXECUTE on new functions never reaches anon or
--    authenticated (they have no USAGE on the schema).
CREATE SCHEMA IF NOT EXISTS app_private;
GRANT USAGE ON SCHEMA app_private TO yourrank_app;

CREATE FUNCTION app_private.ensure_clicks_partition(month_start date)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  first_day date := date_trunc('month', month_start)::date;
  partition_name text := format('clicks_%s', to_char(first_day, 'YYYY_MM'));
BEGIN
  IF partition_name !~ '^clicks_\d{4}_\d{2}$' THEN
    RAISE EXCEPTION 'unexpected clicks partition name %', partition_name;
  END IF;
  IF to_regclass('public.' || partition_name) IS NULL THEN
    EXECUTE format(
      'CREATE TABLE public.%I PARTITION OF public.clicks FOR VALUES FROM (%L) TO (%L)',
      partition_name, first_day, (first_day + interval '1 month')::date
    );
  END IF;
  RETURN partition_name;
END $$;

GRANT EXECUTE ON FUNCTION app_private.ensure_clicks_partition(date) TO yourrank_app;
