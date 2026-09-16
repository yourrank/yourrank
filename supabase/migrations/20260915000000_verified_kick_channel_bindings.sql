-- yourrank:migration-phase: expand

-- A channel identifier is routing input from a signed provider event, not proof
-- that the Site owner controls that channel. Keep historical bindings available
-- for review while marking only bindings corroborated by the owner's OAuth-linked
-- provider identity as verified.
ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS kick_channel_verified_at timestamptz;

COMMENT ON COLUMN public.sites.kick_channel_verified_at IS
  'Provider-verified ownership time for the current Kick channel binding. NULL bindings must not receive provider events.';

UPDATE public.sites AS s
   SET kick_channel_verified_at = u.kick_linked_at
  FROM public.users AS u
 WHERE u.id = s.user_id
   AND s.kick_channel_verified_at IS NULL
   AND s.kick_channel_external_id IS NOT NULL
   AND u.kick_user_id IS NOT NULL
   AND u.kick_linked_at IS NOT NULL
   AND s.kick_channel_external_id = u.kick_user_id;
