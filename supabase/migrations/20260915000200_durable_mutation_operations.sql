-- yourrank:migration-phase: expand

CREATE TABLE IF NOT EXISTS app_private.manual_credit_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  operation_id text NOT NULL,
  request_hash text NOT NULL,
  site_viewer_id uuid NOT NULL REFERENCES public.site_viewers(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  delta integer NOT NULL CHECK (delta <> 0),
  reason text NOT NULL,
  ledger_id uuid NOT NULL REFERENCES public.credit_ledger(id),
  balance_after integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, operation_id)
);

COMMENT ON TABLE app_private.manual_credit_operations IS
  'Committed Site-scoped idempotency receipts for manual balance adjustments; inserted in the same transaction as balance and ledger mutations.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yourrank_app') THEN
    GRANT SELECT, INSERT ON app_private.manual_credit_operations TO yourrank_app;
  END IF;
END $$;
