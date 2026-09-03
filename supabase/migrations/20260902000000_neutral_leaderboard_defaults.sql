-- Future and malformed leaderboard configuration must fail toward neutral score
-- ranking. Existing rows keep their explicit rank_by values unchanged.
ALTER TABLE public.sites
  ALTER COLUMN rank_by SET DEFAULT 'score';

ALTER TABLE public.archives
  ALTER COLUMN rank_by SET DEFAULT 'score';

CREATE OR REPLACE FUNCTION public.derive_archive_values()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source jsonb;
  elem jsonb;
  parsed jsonb := '[]'::jsonb;
  ranked jsonb;
  wagered numeric;
  score numeric;
  prize numeric;
  ordinal integer := 0;
BEGIN
  source := public.archive_snapshot_array(NEW.snapshot_json);

  FOR elem IN SELECT value FROM jsonb_array_elements(source) LOOP
    IF jsonb_typeof(elem) <> 'object' THEN CONTINUE; END IF;
    BEGIN wagered := COALESCE(NULLIF(elem->>'wagered', '')::numeric, 0); EXCEPTION WHEN others THEN wagered := 0; END;
    BEGIN score := COALESCE(NULLIF(elem->>'score', '')::numeric, 0); EXCEPTION WHEN others THEN score := 0; END;
    BEGIN prize := COALESCE(NULLIF(elem->>'prize', '')::numeric, 0); EXCEPTION WHEN others THEN prize := 0; END;
    ordinal := ordinal + 1;
    parsed := parsed || jsonb_build_array(jsonb_build_object(
      'name', COALESCE(elem->>'name', ''),
      'wagered', wagered,
      'score', score,
      'prize', prize,
      '_ordinal', ordinal
    ));
  END LOOP;

  SELECT COALESCE(jsonb_agg(top_items.elem - '_ordinal' ORDER BY top_items.metric DESC, top_items.name ASC), '[]'::jsonb)
    INTO ranked
    FROM (
      SELECT elements.elem,
             CASE WHEN NEW.rank_by = 'wagered' THEN (elements.elem->>'wagered')::numeric ELSE (elements.elem->>'score')::numeric END AS metric,
             elements.elem->>'name' AS name
        FROM jsonb_array_elements(parsed) AS elements(elem)
       ORDER BY metric DESC, name ASC
       LIMIT 3
    ) AS top_items;

  NEW.top3_json := ranked;
  NEW.winner_name := ranked->0->>'name';
  RETURN NEW;
END;
$$;
