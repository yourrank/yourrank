-- yourrank:migration-phase: expand
-- A tournament without a game stores an empty game_name. 'Game' was the old
-- placeholder written when the streamer left the field blank; it is not a
-- real game, so clear it so the dashboard can hide the Game row.
ALTER TABLE public.tournaments ALTER COLUMN game_name SET DEFAULT '';
UPDATE public.tournaments SET game_name = '' WHERE game_name = 'Game';
