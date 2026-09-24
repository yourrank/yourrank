-- yourrank:migration-phase: expand
-- Nullable cache of the provider's exact product interval and scheduled change,
-- reconciled from Polar on every sync. N-1 rows stay valid; entitlement still
-- derives from plan/status/current_period_end only.
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS billing_interval text;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS pending_plan text;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS pending_interval text;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS pending_applies_at timestamptz;
-- Rollback: roll back the Worker and retain these additive columns.
