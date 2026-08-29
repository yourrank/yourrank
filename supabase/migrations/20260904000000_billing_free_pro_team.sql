-- Billing Phase 2A: launch plans, account-pooled active-viewer usage, and grace.
--
-- This migration deliberately aborts if unexpected Lifetime billing rows exist.
-- The product is pre-launch; such rows would contradict the approved zero-customer
-- cleanup premise and require operator review rather than automatic migration.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.payments WHERE provider::text = 'nowpayments_lifetime')
     OR EXISTS (SELECT 1 FROM public.subscriptions WHERE provider::text = 'nowpayments_lifetime') THEN
    RAISE EXCEPTION 'Lifetime billing rows exist; stop Billing Phase 2A and investigate before cleanup';
  END IF;
END $$;

CREATE TYPE public.plan_tier_next AS ENUM ('free', 'pro', 'team');

ALTER TABLE public.users ALTER COLUMN plan DROP DEFAULT;
ALTER TABLE public.users
  ALTER COLUMN plan TYPE public.plan_tier_next
  USING (CASE plan::text
    WHEN 'starter' THEN 'free'
    WHEN 'agency' THEN 'team'
    WHEN 'pro' THEN 'pro'
    ELSE 'free'
  END)::public.plan_tier_next;

ALTER TABLE public.payments
  ALTER COLUMN plan_tier TYPE public.plan_tier_next
  USING (CASE plan_tier::text
    WHEN 'starter' THEN 'free'
    WHEN 'agency' THEN 'team'
    WHEN 'pro' THEN 'pro'
    WHEN 'free' THEN 'free'
    ELSE NULL
  END)::public.plan_tier_next;

ALTER TABLE public.subscriptions
  ALTER COLUMN plan TYPE public.plan_tier_next
  USING (CASE plan::text
    WHEN 'starter' THEN 'free'
    WHEN 'agency' THEN 'team'
    WHEN 'pro' THEN 'pro'
    ELSE 'free'
  END)::public.plan_tier_next;

DROP TYPE public.plan_tier;
ALTER TYPE public.plan_tier_next RENAME TO plan_tier;
ALTER TABLE public.users ALTER COLUMN plan SET DEFAULT 'free'::public.plan_tier;

DROP INDEX IF EXISTS public.uq_payments_nowpayments_txref;
DROP INDEX IF EXISTS public.uq_payments_stars_txref;
CREATE TYPE public.pay_provider_next AS ENUM (
  'crypto',
  'telegram_stars',
  'manual',
  'nowpayments',
  'trial'
);
ALTER TABLE public.payments ALTER COLUMN provider DROP DEFAULT;
ALTER TABLE public.payments
  ALTER COLUMN provider TYPE public.pay_provider_next
  USING provider::text::public.pay_provider_next;
ALTER TABLE public.subscriptions
  ALTER COLUMN provider TYPE public.pay_provider_next
  USING provider::text::public.pay_provider_next;
DROP TYPE public.pay_provider;
ALTER TYPE public.pay_provider_next RENAME TO pay_provider;
ALTER TABLE public.payments ALTER COLUMN provider SET DEFAULT 'manual'::public.pay_provider;
CREATE UNIQUE INDEX uq_payments_nowpayments_txref
  ON public.payments (tx_ref) WHERE provider = 'nowpayments'::public.pay_provider;
CREATE UNIQUE INDEX uq_payments_stars_txref
  ON public.payments (tx_ref) WHERE provider = 'telegram_stars'::public.pay_provider;

ALTER TABLE public.site_viewers
  ADD COLUMN last_active_at timestamptz;
ALTER TABLE public.viewers
  ADD COLUMN is_system boolean NOT NULL DEFAULT FALSE;
ALTER TABLE public.users
  ADD COLUMN active_viewer_grace_started_at timestamptz;

CREATE INDEX idx_site_viewers_billing_active
  ON public.site_viewers (site_id, last_active_at, viewer_id)
  WHERE last_active_at IS NOT NULL;
CREATE INDEX idx_sites_owner_billing_usage
  ON public.sites (user_id, id);

COMMENT ON COLUMN public.site_viewers.last_active_at IS
  'Last server-verified authenticated community action; canonical billing activity timestamp.';
COMMENT ON COLUMN public.viewers.is_system IS
  'Excludes test/system identities from commercial active-viewer usage.';
COMMENT ON COLUMN public.users.active_viewer_grace_started_at IS
  'Start of the Free active-viewer overage grace period; cleared after upgrade or usage recovery.';
