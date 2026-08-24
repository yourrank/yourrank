-- The tournament signup flow listens to a Kick chat channel, but the channel
-- was only held in a form field and never stored, so it was lost on reload and
-- the server could not enforce it as a precondition for opening signups.
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS chat_channel text;
