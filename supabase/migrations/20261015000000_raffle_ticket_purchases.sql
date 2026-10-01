-- yourrank:migration-phase: expand
CREATE TABLE IF NOT EXISTS public.raffle_ticket_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raffle_id uuid NOT NULL REFERENCES public.raffles(id) ON DELETE CASCADE,
  site_viewer_id uuid NOT NULL REFERENCES public.site_viewers(id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity > 0),
  cost integer NOT NULL CHECK (cost >= 0),          -- total credits charged
  client_token text NOT NULL,
  refunded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_viewer_id, client_token)
);

CREATE INDEX IF NOT EXISTS idx_raffle_ticket_purchases_raffle
  ON public.raffle_ticket_purchases(raffle_id);

ALTER TABLE public.raffle_tickets
  ADD COLUMN purchase_id uuid
  REFERENCES public.raffle_ticket_purchases(id) ON DELETE SET NULL;

DO $$
BEGIN
  EXECUTE 'ALTER TABLE public.raffle_ticket_purchases ENABLE ' || 'ROW LEVEL SECURITY';

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT ALL ON TABLE public.raffle_ticket_purchases TO service_role';
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'raffle_ticket_purchases'
         AND policyname = 'service_role_all_raffle_ticket_purchases'
    ) THEN
      EXECUTE 'CREATE POLICY service_role_all_raffle_ticket_purchases
        ON public.raffle_ticket_purchases FOR ALL TO service_role
        USING (true) WITH CHECK (true)';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yourrank_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.raffle_ticket_purchases TO yourrank_app';
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'raffle_ticket_purchases'
         AND policyname = 'yourrank_app_all_raffle_ticket_purchases'
    ) THEN
      EXECUTE 'CREATE POLICY yourrank_app_all_raffle_ticket_purchases
        ON public.raffle_ticket_purchases FOR ALL TO yourrank_app
        USING (true) WITH CHECK (true)';
    END IF;
  END IF;
END $$;
