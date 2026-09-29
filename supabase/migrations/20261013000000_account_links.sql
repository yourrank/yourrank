-- yourrank:migration-phase: expand
CREATE TABLE public.account_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  viewer_a uuid NOT NULL REFERENCES public.viewers(id) ON DELETE CASCADE,
  viewer_b uuid NOT NULL REFERENCES public.viewers(id) ON DELETE CASCADE,
  confidence integer NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  reasons text[] NOT NULL DEFAULT '{}',
  same_time_claims integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','watching','restricted','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_detected_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT account_links_ordered CHECK (viewer_a < viewer_b),
  CONSTRAINT account_links_pair UNIQUE (site_id, viewer_a, viewer_b)
);
CREATE INDEX idx_account_links_site_status ON public.account_links(site_id, status);
CREATE INDEX idx_account_links_viewer_a ON public.account_links(viewer_a);
CREATE INDEX idx_account_links_viewer_b ON public.account_links(viewer_b);
-- RLS + the yourrank_app policy must ship in a later contract-phase migration;
-- no anon/authenticated grants are issued here, so those roles get no access.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT ALL ON public.account_links TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='yourrank_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_links TO yourrank_app;
  END IF;
END $$;
COMMENT ON TABLE public.account_links IS 'Likely same-person viewer pairs per site, detected once a day from device/IP/identity/claim signals. Status decisions are always made by the streamer; detection never restricts.';
COMMENT ON COLUMN public.account_links.confidence IS 'Detection score 0-100; rows are only written at 60+ (below-threshold pairs are counted in logs only).';
COMMENT ON COLUMN public.account_links.reasons IS 'Signal codes that produced the link: same_device, same_identity, same_ip_24h, same_time_claims.';
COMMENT ON COLUMN public.account_links.same_time_claims IS 'Number of code-drop claims the pair made within 2 seconds of each other.';
COMMENT ON COLUMN public.account_links.decided_by IS 'Dashboard user who made the last status decision; NULL while undecided.';
