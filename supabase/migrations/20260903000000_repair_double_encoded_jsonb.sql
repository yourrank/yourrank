-- Repair legacy double-encoded jsonb rows.
--
-- Writers used to call JSON.stringify(value) before binding the value to a
-- `::jsonb` parameter, so postgres.js encoded it a SECOND time and the column
-- stored a JSON *string* instead of an object/array. The writers now bind native
-- values; this repairs the rows they already wrote.
--
-- Deployment: this is a DATA migration and ships on its own, after the writer
-- fixes are live everywhere. See supabase/repair/README.md for the procedure,
-- the expected counts and the rollback.
--
-- Scope is an explicit allowlist, not the schema: only the 20 columns that some
-- commit actually wrote from a pre-serialised binding are considered, and every
-- other jsonb column in the schema is never touched, even when it holds a
-- double-encoded value.
--
-- Within an allowlisted column, every cast is guarded by a real parse:
--   * malformed strings, scalar JSON strings, JSON null and SQL NULL are all
--     preserved, as are values already stored as an object or an array;
--   * a JSON *string* whose text parses to an object or an array is a repair
--     CANDIDATE and will be rewritten.
-- That last predicate is semantically ambiguous on its own: a row that
-- deliberately stored the text of a JSON object is indistinguishable from a
-- legacy double-encoded row. The allowlist narrows the ambiguity to columns with
-- a provably pre-serialising writer, and supabase/repair/preflight_20260903000000.sql
-- enumerates the real candidates read-only so they are inspected against the
-- column's application contract BEFORE this migration runs. Pre-images make any
-- misjudgement reversible.
BEGIN;

-- Pre-image of every row this migration rewrites, keyed by primary key, so the
-- repair is reversible without a database-wide restore. Kept after the run; drop
-- it deliberately once the repair has been accepted in production.
CREATE TABLE IF NOT EXISTS public.jsonb_repair_preimage (
  id bigserial PRIMARY KEY,
  repaired_at timestamptz NOT NULL DEFAULT now(),
  table_name text NOT NULL,
  column_name text NOT NULL,
  row_key jsonb NOT NULL,
  before_value jsonb NOT NULL
);
COMMENT ON TABLE public.jsonb_repair_preimage IS
  'Pre-images written by 20260903000000_repair_double_encoded_jsonb.sql. Recovery source; safe to drop once the repair is accepted.';

-- Parses text as jsonb, or returns NULL when it is not valid JSON. A plain cast
-- aborts the whole migration on the first malformed legacy value.
CREATE FUNCTION public.jsonb_repair_parse(txt text) RETURNS jsonb
  LANGUAGE plpgsql IMMUTABLE STRICT AS $fn$
BEGIN
  RETURN txt::jsonb;
EXCEPTION WHEN others THEN
  RETURN NULL;
END
$fn$;

DO $$
DECLARE
  target record;
  key_cols text;
  predicate text;
  backed bigint;
  repaired bigint;
  total bigint := 0;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('admin_audit', 'details'),
      ('archives', 'snapshot_json'),
      ('broadcasts', 'audience_filter_snapshot'),
      ('conversions', 'raw'),
      ('credit_ledger', 'metadata'),
      ('game_rounds', 'outcome'),
      ('game_rounds', 'params'),
      ('kick_reward_events', 'payload'),
      ('payments', 'payload_json'),
      ('predictions', 'options'),
      ('provider_events', 'payload_json'),
      ('queue_dlq_events', 'body'),
      ('seasons', 'tiers_json'),
      ('sites', 'extra_json'),
      ('sites', 'theme_json'),
      ('telegram_webhook_updates', 'update_json'),
      ('tournaments', 'participants_json'),
      ('viewer_duels', 'roll_details'),
      ('viewer_season_progress', 'claimed_tiers'),
      ('wheel_configs', 'segments_json')
    ) AS t(table_name, column_name)
  LOOP
    -- Fail loudly rather than silently skipping a column of the allowlist.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = target.table_name
         AND column_name = target.column_name
         AND data_type = 'jsonb'
    ) THEN
      RAISE EXCEPTION 'repair allowlist names %.%, which is not a public jsonb column',
        target.table_name, target.column_name;
    END IF;

    SELECT string_agg(format('%L, t.%I', a.attname, a.attname), ', ' ORDER BY k.ord)
      INTO key_cols
      FROM pg_class c
      JOIN pg_constraint con ON con.conrelid = c.oid AND con.contype = 'p'
      JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
      JOIN pg_namespace ns ON ns.oid = c.relnamespace AND ns.nspname = 'public'
     WHERE c.relname = target.table_name;
    IF key_cols IS NULL THEN
      RAISE EXCEPTION 'table public.% has no primary key, so the repair could not be reversed', target.table_name;
    END IF;

    -- Candidate predicate, identical to the preflight script's: the column holds
    -- a JSON string whose text re-parses as an object or an array. Every other
    -- shape is left alone.
    predicate := format(
      'jsonb_typeof(t.%1$I) = ''string''
         AND jsonb_typeof(public.jsonb_repair_parse(t.%1$I #>> ''{}'')) IN (''object'', ''array'')',
      target.column_name
    );

    EXECUTE format(
      'INSERT INTO public.jsonb_repair_preimage (table_name, column_name, row_key, before_value)
       SELECT %L, %L, jsonb_build_object(%s), t.%I FROM public.%I t WHERE %s',
      target.table_name, target.column_name, key_cols, target.column_name, target.table_name, predicate
    );
    GET DIAGNOSTICS backed = ROW_COUNT;

    EXECUTE format(
      'UPDATE public.%1$I t
          SET %2$I = public.jsonb_repair_parse(t.%2$I #>> ''{}'')
        WHERE %3$s',
      target.table_name, target.column_name, predicate
    );
    GET DIAGNOSTICS repaired = ROW_COUNT;

    IF backed <> repaired THEN
      RAISE EXCEPTION 'pre-image count % does not match repaired count % for %.%',
        backed, repaired, target.table_name, target.column_name;
    END IF;

    total := total + repaired;
    IF repaired > 0 THEN
      RAISE NOTICE 'repaired % double-encoded row(s) in %.% (pre-images stored)',
        repaired, target.table_name, target.column_name;
    END IF;
  END LOOP;

  RAISE NOTICE 'jsonb repair complete: % row(s) across % allowlisted column(s)', total, 20;
END $$;

DROP FUNCTION public.jsonb_repair_parse(text);

COMMIT;
