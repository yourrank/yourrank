-- yourrank:migration-phase: expand
--
-- Streamer-finalized winner acceptance for Chat Giveaways: the manual
-- "Confirm Winner" action records who confirmed and when. Distinct from
-- winner_confirmed_at, which is the winner's own reply in Kick chat.
-- Additive only; both columns stay NULL until a streamer confirms, so old
-- code and new code both read every row safely.

ALTER TABLE public.chat_giveaway_sessions
  ADD COLUMN IF NOT EXISTS winner_finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS winner_finalized_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.chat_giveaway_sessions.winner_finalized_at IS
  'Streamer confirmed the drawn winner (manual "Confirm Winner"). Distinct from winner_confirmed_at, which is the winner replying in Kick chat.';
COMMENT ON COLUMN public.chat_giveaway_sessions.winner_finalized_by IS
  'User who confirmed the winner.';
