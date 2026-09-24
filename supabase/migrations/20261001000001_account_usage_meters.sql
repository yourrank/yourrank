-- yourrank:migration-phase: expand
-- Monthly usage meters for the commercial plan model: Telegram interactions
-- and broadcast deliveries are counted per UTC month and bounded by
-- PLAN_LIMITS telegram_interactions_per_month / broadcast_deliveries_per_month.
CREATE TABLE IF NOT EXISTS public.account_usage_meters (
  account_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  meter text NOT NULL CHECK (meter IN ('telegram_interactions','broadcast_deliveries')),
  period_start date NOT NULL,               -- first day of the UTC month
  used bigint NOT NULL DEFAULT 0 CHECK (used >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, meter, period_start)
);

-- metered_at: set once when the update was evaluated for metering, so webhook
-- recovery never double-counts. quota_blocked rows are terminal (completed)
-- and never retried. quota_blocked is nullable (expand-phase rule forbids
-- ADD COLUMN NOT NULL): NULL and false both mean "not blocked".
ALTER TABLE public.telegram_webhook_updates
  ADD COLUMN IF NOT EXISTS metered_at timestamptz,
  ADD COLUMN IF NOT EXISTS quota_blocked boolean;

-- Monthly-quota pause bookkeeping for broadcasts. stop_reason is NULL while
-- the broadcast runs normally; paused_period_start records which UTC month
-- it was paused in so the cron auto-resume can pick it up next month.
ALTER TABLE public.broadcasts
  ADD COLUMN IF NOT EXISTS stop_reason text CHECK (stop_reason IN ('monthly_quota')),
  ADD COLUMN IF NOT EXISTS paused_period_start date;

-- Rollback: roll back the Workers and retain these additive columns/tables.
