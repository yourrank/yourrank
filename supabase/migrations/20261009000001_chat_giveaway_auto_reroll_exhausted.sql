-- yourrank:migration-phase: expand
-- Auto re-roll exhaustion: persist when an automatic re-roll stopped because no
-- eligible entrants remained, so the dashboard can surface it instead of the
-- giveaway silently waiting on a winner who will never be replaced.
ALTER TABLE public.chat_giveaway_sessions
  ADD COLUMN auto_reroll_exhausted_at timestamptz;
