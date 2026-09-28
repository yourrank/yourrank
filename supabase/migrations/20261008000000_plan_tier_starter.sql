-- supabase: disable-transaction
-- yourrank:migration-phase: expand

ALTER TYPE public.plan_tier ADD VALUE IF NOT EXISTS 'starter' BEFORE 'pro';
