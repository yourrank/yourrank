-- Independent points-only event standings within a site. Membership/rewards stay site-scoped.
-- yourrank:migration-phase: expand
CREATE TABLE app_private.site_event_leaderboards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  players jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(players) = 'array' AND jsonb_array_length(players) <= 5000),
  published boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX site_event_leaderboards_site ON app_private.site_event_leaderboards(site_id, created_at);
-- The existing app_private schema is inaccessible to anon/authenticated and is
-- not exposed through PostgREST. Only the backend group receives table access;
-- every Worker operation also enforces site ownership/capability.
GRANT SELECT, INSERT, UPDATE, DELETE ON app_private.site_event_leaderboards TO yourrank_app;
-- Rollback: DROP TABLE app_private.site_event_leaderboards (discards event standings).
