-- yourrank:migration-phase: expand

ALTER TABLE public.chat_giveaway_draws
  ADD COLUMN username text,
  ADD COLUMN confirmed_at timestamptz;

UPDATE public.chat_giveaway_draws d
   SET username = e.username
  FROM public.chat_giveaway_entries e
 WHERE e.id = d.entry_id
   AND d.username IS NULL;

UPDATE public.chat_giveaway_draws d
   SET confirmed_at = s.winner_finalized_at
  FROM public.chat_giveaway_sessions s
 WHERE s.winner_finalized_at IS NOT NULL
   AND d.id = (
     SELECT latest.id
       FROM public.chat_giveaway_draws latest
      WHERE latest.giveaway_session_id = s.id
        AND latest.entry_id = s.winner_entry_id
      ORDER BY latest.drawn_at DESC, latest.id DESC
      LIMIT 1
   );

COMMENT ON COLUMN public.chat_giveaway_draws.username IS
  'Snapshot of the entrant username so history survives Clear list.';
COMMENT ON COLUMN public.chat_giveaway_draws.confirmed_at IS
  'Timestamp when the streamer confirmed this draw.';
