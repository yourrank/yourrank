-- yourrank:migration-phase: expand
--
-- Per-draw winner response rules for Chat Giveaways: whether the winner had
-- to reply in chat, and the response window length, are captured at draw
-- time so a reload or another device renders the same claim state. Additive
-- only; NULL means "not required" so old rows and old code stay safe.

ALTER TABLE public.chat_giveaway_sessions
  ADD COLUMN IF NOT EXISTS winner_response_required boolean,
  ADD COLUMN IF NOT EXISTS winner_response_timeout_seconds integer;

COMMENT ON COLUMN public.chat_giveaway_sessions.winner_response_required IS
  'Whether the drawn winner had to reply in Kick chat for this draw; captured at draw time and fixed for that draw.';
COMMENT ON COLUMN public.chat_giveaway_sessions.winner_response_timeout_seconds IS
  'Response window in seconds for this draw, measured from drawn_at.';
