-- yourrank:migration-phase: expand
CREATE TABLE IF NOT EXISTS public.site_earning_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  rule_type text NOT NULL CHECK (rule_type IN ('daily_checkin')),
  amount integer NOT NULL CHECK (amount > 0 AND amount <= 1000),
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (site_id, rule_type)
);
CREATE TABLE IF NOT EXISTS public.earning_rule_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES public.site_earning_rules(id) ON DELETE CASCADE,
  site_viewer_id uuid NOT NULL REFERENCES public.site_viewers(id) ON DELETE CASCADE,
  period date NOT NULL,
  amount integer NOT NULL CHECK (amount > 0),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (rule_id, site_viewer_id, period)
);
CREATE INDEX IF NOT EXISTS idx_earning_rule_claims_site_viewer ON public.earning_rule_claims (site_viewer_id, created_at DESC);
