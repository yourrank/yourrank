-- yourrank:migration-phase: expand
-- New nullable provider keys leave all N-1 rows valid (NULL is not unique).
-- No uniqueness requirement is added to existing payment references.
ALTER TABLE public.subscriptions ADD COLUMN provider_subscription_id text UNIQUE;
ALTER TABLE public.subscriptions ADD COLUMN cancel_at_period_end boolean DEFAULT false;
ALTER TABLE public.payments ADD COLUMN polar_order_id text UNIQUE;

CREATE TABLE app_private.polar_accounts (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  customer_id text UNIQUE,
  checkout_url text,
  checkout_plan text,
  checkout_interval text,
  checkout_expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app_private.polar_webhook_events (
  id text PRIMARY KEY,
  event_type text NOT NULL,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);
-- Existing backend-only schema denies anon/authenticated access and is not
-- exposed through PostgREST. Workers still enforce account ownership.
GRANT SELECT, INSERT, UPDATE, DELETE ON app_private.polar_accounts, app_private.polar_webhook_events TO yourrank_app;
-- Rollback: roll back the Worker and retain these additive fields and records.
