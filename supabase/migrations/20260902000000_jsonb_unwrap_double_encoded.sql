-- Repair double-encoded jsonb values.
--
-- Writers across the Worker, the bot and packages/shared used to call
-- JSON.stringify(value) before binding the value to a `::jsonb` parameter, so
-- postgres.js JSON-encoded it a SECOND time and the column stored a JSON
-- *string* instead of an object/array. The symptoms were invisible on write
-- (handlers echo the validated request) but broke every reader that indexed the
-- column: game_rounds.params->>'mines' on a bet replay, tournaments
-- participants_json, predictions.options, wheel_configs.segments_json,
-- credit_ledger.metadata, seasons.tiers_json, conversions.raw and others.
--
-- The writers now bind native values. This normalises the rows they already
-- wrote, for every jsonb column in the schema, so readers never have to guess.
-- Only values that re-parse as an object or an array are unwrapped: a jsonb
-- column that intentionally stores a scalar JSON string is left alone.
DO $$
DECLARE
  col record;
  updated bigint;
BEGIN
  FOR col IN
    SELECT c.table_name, c.column_name
      FROM information_schema.columns c
      JOIN pg_class rel ON rel.relname = c.table_name
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace AND ns.nspname = 'public'
     WHERE c.table_schema = 'public'
       AND c.data_type = 'jsonb'
       AND c.is_generated = 'NEVER'
       AND rel.relkind = 'r'
     ORDER BY c.table_name, c.column_name
  LOOP
    EXECUTE format(
      'UPDATE public.%I
          SET %I = (%I #>> ''{}'')::jsonb
        WHERE jsonb_typeof(%I) = ''string''
          AND left(ltrim(%I #>> ''{}''), 1) IN (''{'', ''['')',
      col.table_name, col.column_name, col.column_name, col.column_name, col.column_name
    );
    GET DIAGNOSTICS updated = ROW_COUNT;
    IF updated > 0 THEN
      RAISE NOTICE 'unwrapped % double-encoded row(s) in %.%',
        updated, col.table_name, col.column_name;
    END IF;
  END LOOP;
END $$;
