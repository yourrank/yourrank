-- Rollback for 20260903000000_repair_double_encoded_jsonb.sql.
--
-- Restores every rewritten row to its stored pre-image, by primary key, and only
-- where the current value still equals what the repair wrote. A row edited by the
-- application after the repair is therefore left alone rather than reverted.
BEGIN;

DO $$
DECLARE
  target record;
  key_pred text;
  restored bigint;
  total bigint := 0;
BEGIN
  FOR target IN
    SELECT DISTINCT table_name, column_name FROM public.jsonb_repair_preimage ORDER BY 1, 2
  LOOP
    SELECT string_agg(format('t.%1$I::text = p.row_key->>%1$L', a.attname), ' AND ' ORDER BY k.ord)
      INTO key_pred
      FROM pg_class c
      JOIN pg_constraint con ON con.conrelid = c.oid AND con.contype = 'p'
      JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
      JOIN pg_namespace ns ON ns.oid = c.relnamespace AND ns.nspname = 'public'
     WHERE c.relname = target.table_name;

    EXECUTE format(
      'UPDATE public.%1$I t
          SET %2$I = p.before_value
         FROM public.jsonb_repair_preimage p
        WHERE p.table_name = %1$L AND p.column_name = %2$L
          AND %3$s
          AND t.%2$I = (p.before_value #>> ''{}'')::jsonb',
      target.table_name, target.column_name, key_pred
    );
    GET DIAGNOSTICS restored = ROW_COUNT;
    total := total + restored;
    RAISE NOTICE 'restored % row(s) in %.%', restored, target.table_name, target.column_name;
  END LOOP;
  RAISE NOTICE 'rollback complete: % row(s)', total;
END $$;

COMMIT;
