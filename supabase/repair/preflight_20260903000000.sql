-- READ-ONLY preflight for 20260903000000_repair_double_encoded_jsonb.sql.
--
-- Enumerates the rows that migration WOULD rewrite, so every candidate is judged
-- against its column's application contract before any data is changed. It uses
-- the same 20-column allowlist and the same candidate predicate as the migration:
-- an allowlisted jsonb column holding a JSON *string* whose text parses to an
-- object or an array.
--
-- Read-only by construction:
--   * the script runs inside `SET TRANSACTION READ ONLY` and ends in ROLLBACK, so
--     postgres itself rejects any INSERT/UPDATE/DELETE/DDL reached from here;
--   * it creates nothing — no helper function, no temp table. The guarded parse
--     the migration gets from `jsonb_repair_parse()` is done here by a plpgsql
--     EXCEPTION block, so a malformed legacy value cannot abort the report;
--   * all output is RAISE NOTICE.
--
-- Run it against production with read-only credentials:
--   psql "$READONLY_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/repair/preflight_20260903000000.sql
--
-- The role needs SELECT on the allowlisted tables AND must not be filtered by
-- row-level security, because the migration runs as the table owner and sees
-- every row. A role that RLS filters would under-report candidates, so this
-- script refuses to inspect such a table and lists it as NOT INSPECTED instead
-- of reporting a false zero. A read-only role with BYPASSRLS satisfies both:
--   CREATE ROLE jsonb_preflight_ro LOGIN BYPASSRLS PASSWORD '...';
--   GRANT USAGE ON SCHEMA public TO jsonb_preflight_ro;
--   GRANT SELECT ON ALL TABLES IN SCHEMA public TO jsonb_preflight_ro;
--
-- Sensitive payloads are never dumped. For each candidate the report gives
-- structural evidence only: the parsed type, object keys with each value's type
-- and length (or array length and element types), the text length and an md5
-- fingerprint. Key NAMES are printed; values are not.
BEGIN;
SET TRANSACTION READ ONLY;

DO $$
DECLARE
  -- Keep in sync with the migration's allowlist.
  allowlist text[][] := ARRAY[
    ['admin_audit', 'details'],
    ['archives', 'snapshot_json'],
    ['broadcasts', 'audience_filter_snapshot'],
    ['conversions', 'raw'],
    ['credit_ledger', 'metadata'],
    ['game_rounds', 'outcome'],
    ['game_rounds', 'params'],
    ['kick_reward_events', 'payload'],
    ['payments', 'payload_json'],
    ['predictions', 'options'],
    ['provider_events', 'payload_json'],
    ['queue_dlq_events', 'body'],
    ['seasons', 'tiers_json'],
    ['sites', 'extra_json'],
    ['sites', 'theme_json'],
    ['telegram_webhook_updates', 'update_json'],
    ['tournaments', 'participants_json'],
    ['viewer_duels', 'roll_details'],
    ['viewer_season_progress', 'claimed_tiers'],
    ['wheel_configs', 'segments_json']
  ];
  sample_limit constant int := 20;  -- candidates detailed per column
  tbl text;
  col text;
  i int;
  key_cols text;
  rec record;
  parsed jsonb;
  shape text;
  candidates int;
  shown int;
  total int := 0;
  empty_cols text[] := '{}';
  skipped_cols text[] := '{}';
  summary text[] := '{}';
  rls_exempt boolean;
BEGIN
  RAISE NOTICE 'jsonb repair preflight (READ ONLY) on database % at %', current_database(), now();
  RAISE NOTICE 'server: %', version();

  SELECT rolsuper OR rolbypassrls INTO rls_exempt FROM pg_roles WHERE rolname = current_user;
  RAISE NOTICE 'role %: rls-exempt=%, row_security=%', current_user, rls_exempt,
    current_setting('row_security', true);

  FOR i IN 1 .. array_length(allowlist, 1) LOOP
    tbl := allowlist[i][1];
    col := allowlist[i][2];
    candidates := 0;
    shown := 0;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = tbl
         AND column_name = col AND data_type = 'jsonb'
    ) THEN
      skipped_cols := skipped_cols || format('%s.%s (not a public jsonb column here)', tbl, col);
      CONTINUE;
    END IF;

    IF NOT has_table_privilege(format('public.%I', tbl), 'SELECT') THEN
      skipped_cols := skipped_cols || format('%s.%s (no SELECT privilege)', tbl, col);
      CONTINUE;
    END IF;

    -- Refuse rather than report a false zero: RLS would hide rows from this role
    -- that the migration, running as the owner, will still rewrite.
    IF NOT rls_exempt AND EXISTS (
      SELECT 1 FROM pg_class c
        JOIN pg_namespace ns ON ns.oid = c.relnamespace AND ns.nspname = 'public'
       WHERE c.relname = tbl
         AND c.relrowsecurity
         AND (c.relforcerowsecurity OR NOT pg_has_role(current_user, c.relowner, 'USAGE'))
    ) THEN
      skipped_cols := skipped_cols ||
        format('%s.%s (row-level security filters this role; rerun with a BYPASSRLS read-only role)', tbl, col);
      CONTINUE;
    END IF;

    -- Row identifier: the primary key, exactly as the migration records it in
    -- jsonb_repair_preimage.row_key.
    SELECT string_agg(format('%L, t.%I', a.attname, a.attname), ', ' ORDER BY k.ord)
      INTO key_cols
      FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace AND ns.nspname = 'public'
      JOIN pg_constraint con ON con.conrelid = c.oid AND con.contype = 'p'
      JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
     WHERE c.relname = tbl;
    IF key_cols IS NULL THEN
      skipped_cols := skipped_cols || format('%s.%s (no primary key, repair would refuse it)', tbl, col);
      CONTINUE;
    END IF;

    -- Cheap prefilter; the authoritative test is the guarded parse below.
    FOR rec IN EXECUTE format(
      'SELECT jsonb_build_object(%s) AS row_key, t.%I #>> ''{}'' AS txt
         FROM public.%I t
        WHERE jsonb_typeof(t.%I) = ''string''
          AND left(ltrim(t.%I #>> ''{}''), 1) IN (''{'', ''['')',
      key_cols, col, tbl, col, col
    ) LOOP
      BEGIN
        parsed := rec.txt::jsonb;
      EXCEPTION WHEN others THEN
        CONTINUE;  -- malformed string: preserved by the repair, not a candidate
      END;

      IF jsonb_typeof(parsed) NOT IN ('object', 'array') THEN
        CONTINUE;  -- scalar/null text: preserved by the repair, not a candidate
      END IF;

      candidates := candidates + 1;
      total := total + 1;
      IF shown >= sample_limit THEN
        CONTINUE;
      END IF;
      shown := shown + 1;

      IF jsonb_typeof(parsed) = 'object' THEN
        SELECT coalesce(string_agg(
                 format('%s:%s', e.key,
                   CASE jsonb_typeof(e.value)
                     WHEN 'string' THEN format('string(len %s)', length(e.value #>> '{}'))
                     WHEN 'array' THEN format('array(%s)', jsonb_array_length(e.value))
                     WHEN 'object' THEN format('object{%s}', (
                       SELECT coalesce(string_agg(k, ',' ORDER BY k), '')
                         FROM jsonb_object_keys(e.value) k))
                     ELSE jsonb_typeof(e.value)
                   END), ', ' ORDER BY e.key), '(no keys)')
          INTO shape
          FROM jsonb_each(parsed) e;
      ELSE
        SELECT format('array(%s) of %s%s',
                 jsonb_array_length(parsed),
                 coalesce((SELECT string_agg(DISTINCT jsonb_typeof(v), '/')
                             FROM jsonb_array_elements(parsed) v), '-'),
                 coalesce((SELECT format(' keys{%s}', string_agg(DISTINCT k, ','))
                             FROM jsonb_array_elements(parsed) v,
                                  jsonb_object_keys(v) k
                            WHERE jsonb_typeof(v) = 'object'), ''))
          INTO shape;
      END IF;

      RAISE NOTICE '  %.% key=% current=string parsed=% len=% md5=% shape=%',
        tbl, col, rec.row_key, jsonb_typeof(parsed), length(rec.txt),
        left(md5(rec.txt), 12), shape;
    END LOOP;

    IF candidates = 0 THEN
      empty_cols := empty_cols || format('%s.%s', tbl, col);
    ELSE
      summary := summary || format('%s.%s: %s candidate row(s)%s', tbl, col, candidates,
        CASE WHEN candidates > sample_limit
             THEN format(' (%s detailed above, %s not shown)', sample_limit, candidates - sample_limit)
             ELSE '' END);
    END IF;
  END LOOP;

  RAISE NOTICE '--- candidate rows by table/column ---';
  IF array_length(summary, 1) IS NULL THEN
    RAISE NOTICE '  none';
  ELSE
    FOR i IN 1 .. array_length(summary, 1) LOOP
      RAISE NOTICE '  %', summary[i];
    END LOOP;
  END IF;

  RAISE NOTICE '--- allowlisted columns with zero candidates: % of 20 ---',
    coalesce(array_length(empty_cols, 1), 0);
  IF array_length(empty_cols, 1) IS NOT NULL THEN
    RAISE NOTICE '  %', array_to_string(empty_cols, ', ');
  END IF;

  RAISE NOTICE '--- allowlisted columns that could NOT be inspected: % ---',
    coalesce(array_length(skipped_cols, 1), 0);
  IF array_length(skipped_cols, 1) IS NOT NULL THEN
    FOR i IN 1 .. array_length(skipped_cols, 1) LOOP
      RAISE NOTICE '  %', skipped_cols[i];
    END LOOP;
  END IF;

  RAISE NOTICE 'TOTAL candidate rows the repair would rewrite: %', total;
  IF array_length(skipped_cols, 1) IS NOT NULL THEN
    RAISE NOTICE 'PREFLIGHT INCOMPLETE: % allowlisted column(s) were not inspected, so this total is a LOWER BOUND.',
      array_length(skipped_cols, 1);
  ELSE
    RAISE NOTICE 'PREFLIGHT COMPLETE: all 20 allowlisted columns inspected.';
  END IF;
  RAISE NOTICE 'Nothing was modified. Classify every candidate above against the column''s contract before running the migration.';
END $$;

ROLLBACK;
