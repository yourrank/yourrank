-- yourrank:migration-phase: expand
-- Phase 1 of smart account linking: silent signal collection only. Every
-- persisted IP/device value is a keyed HMAC; raw values are never stored.
CREATE TABLE public.device_links (
  device_hash text NOT NULL,
  viewer_id uuid NOT NULL REFERENCES public.viewers(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  seen_count integer NOT NULL DEFAULT 1,
  PRIMARY KEY (site_id, device_hash, viewer_id)
);
CREATE INDEX idx_device_links_viewer ON public.device_links(viewer_id);
CREATE TABLE public.ip_observations (
  id bigserial PRIMARY KEY,
  ip_hash text NOT NULL,
  viewer_id uuid NOT NULL REFERENCES public.viewers(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('drop_claim','checkin','giveaway_verify')),
  observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ip_observations_site_ip ON public.ip_observations(site_id, ip_hash, observed_at);
CREATE INDEX idx_ip_observations_observed ON public.ip_observations(observed_at);
CREATE TABLE public.viewer_identity_events (
  id bigserial PRIMARY KEY,
  viewer_id uuid NOT NULL REFERENCES public.viewers(id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_user_id text NOT NULL,
  event text NOT NULL CHECK (event IN ('linked','revoked')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_viewer_identity_events_ext ON public.viewer_identity_events(provider, external_user_id);
-- RLS + the yourrank_app policy must ship in a later contract-phase migration;
-- no anon/authenticated grants are issued here, so those roles get no access.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT ALL ON public.device_links TO service_role;
    GRANT ALL ON public.ip_observations TO service_role;
    GRANT ALL ON public.viewer_identity_events TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='yourrank_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_links TO yourrank_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.ip_observations TO yourrank_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.viewer_identity_events TO yourrank_app;
  END IF;
END $$;
COMMENT ON TABLE public.device_links IS 'Anti-abuse signal: HMAC of the client device fingerprint per viewer+site. Never a raw fingerprint.';
COMMENT ON COLUMN public.device_links.device_hash IS 'Server-side HMAC-SHA256 of the client device fingerprint. Never the raw fingerprint.';
COMMENT ON TABLE public.ip_observations IS 'Anti-abuse signal: keyed HMAC of the action IP per viewer+site. Deleted after 30 days; never a raw IP.';
COMMENT ON COLUMN public.ip_observations.ip_hash IS 'Server-side HMAC-SHA256 of the normalized client IP. Never a raw IP. Rows expire after 30 days.';
COMMENT ON TABLE public.viewer_identity_events IS 'History of which external account was linked to which viewer. Stores external account ids, never secrets.';
