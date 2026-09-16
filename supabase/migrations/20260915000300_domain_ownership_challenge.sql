-- yourrank:migration-phase: expand

-- A shared CNAME target/TLS certificate is not proof that this Site owner
-- controls a domain. Stage a Site-specific DNS challenge before assignment.
-- Existing domains retain their routing data; no ownership is inferred/backfilled.
ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS domain_auth_challenge text,
  ADD COLUMN IF NOT EXISTS domain_auth_challenge_host text;

COMMENT ON COLUMN public.sites.domain_auth_challenge IS
  'Site-bound TXT ownership challenge; replacement/removal invalidates in-flight domain verification writes.';
