-- Wave H: converge the pre-launch team role model to Owner + Moderator.
-- Owner remains represented by sites.user_id; delegated rows can only be Moderator.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.site_members WHERE role NOT IN ('moderator', 'manager')
  ) THEN
    RAISE EXCEPTION 'Wave H aborted: site_members contains an unexpected role';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.site_invites WHERE role NOT IN ('moderator', 'manager')
  ) THEN
    RAISE EXCEPTION 'Wave H aborted: site_invites contains an unexpected role';
  END IF;
END
$$;

-- Keep a deterministic, append-only recovery record before mapping the dead
-- pre-launch Manager value to Moderator. No invite email or bearer token is copied.
INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, details)
SELECT NULL,
       'team_role_migrated',
       'site_member',
       sm.id::text,
       jsonb_build_object(
         'site_id', sm.site_id,
         'target_user_id', sm.user_id,
         'old_role', 'manager',
         'role', 'moderator'
       )
  FROM public.site_members sm
 WHERE sm.role = 'manager';

INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, details)
SELECT NULL,
       'team_role_migrated',
       'site_invite',
       si.id::text,
       jsonb_build_object(
         'site_id', si.site_id,
         'old_role', 'manager',
         'role', 'moderator',
         'status', si.status
       )
  FROM public.site_invites si
 WHERE si.role = 'manager';

UPDATE public.site_members SET role = 'moderator', updated_at = now() WHERE role = 'manager';
UPDATE public.site_invites SET role = 'moderator' WHERE role = 'manager';

ALTER TABLE public.site_members DROP CONSTRAINT IF EXISTS site_members_role_check;
ALTER TABLE public.site_members
  ADD CONSTRAINT site_members_role_check CHECK (role = 'moderator');

ALTER TABLE public.site_invites DROP CONSTRAINT IF EXISTS site_invites_role_check;
ALTER TABLE public.site_invites
  ADD CONSTRAINT site_invites_role_check CHECK (role = 'moderator');

COMMENT ON COLUMN public.site_members.role IS 'Wave H V1 delegated role. Owner is represented by sites.user_id; only moderator is persisted here.';
COMMENT ON COLUMN public.site_invites.role IS 'Wave H V1 invitation role; only moderator may be invited.';
