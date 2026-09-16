-- yourrank:migration-phase: expand

-- Custom-domain authentication authority is tied to one verified assignment
-- incarnation. Rotating or clearing the binding invalidates local sessions
-- without changing Viewer Account or Membership identity.
ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS domain_auth_binding_id uuid,
  ADD COLUMN IF NOT EXISTS domain_auth_verified_at timestamptz;

COMMENT ON COLUMN public.sites.domain_auth_binding_id IS
  'Opaque generation for the currently provider-verified custom-domain assignment.';
COMMENT ON COLUMN public.sites.domain_auth_verified_at IS
  'Time the exact custom-domain assignment and provider hostname record were verified.';

-- Existing sessions intentionally remain unclassified. Scope-aware readers reject
-- them so a legacy bearer cannot be upgraded to global authority by replaying it
-- on the platform origin.
ALTER TABLE public.viewer_sessions
  ADD COLUMN IF NOT EXISTS authority text,
  ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES public.sites(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS hostname text,
  ADD COLUMN IF NOT EXISTS domain_binding_id uuid;

CREATE INDEX IF NOT EXISTS idx_viewer_sessions_site_authority
  ON public.viewer_sessions (site_id, authority)
  WHERE authority = 'site';

COMMENT ON COLUMN public.viewer_sessions.authority IS
  'Viewer bearer audience: global for platform account authority, site for one verified custom-domain assignment.';
COMMENT ON COLUMN public.viewer_sessions.domain_binding_id IS
  'Copy of sites.domain_auth_binding_id at local session issuance; must still match at resolution.';
