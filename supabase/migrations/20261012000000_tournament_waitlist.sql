-- yourrank:migration-phase: expand
-- Tournament waitlist: when a signup limit is reached and waitlist is on, new
-- entries join the queue and are promoted automatically when a spot opens.
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS waitlist_enabled boolean DEFAULT false;

COMMENT ON COLUMN public.tournaments.waitlist_enabled IS
  'When true, signups past entry_cap are stored with status waitlist and promoted to pending as spots free up. NULL reads as false.';
