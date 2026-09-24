-- yourrank:migration-phase: expand
-- supabase: disable-transaction
-- Broadcast pause state for the monthly delivery quota. 'paused' rows keep
-- their cursor and resume automatically at the next billing period or via
-- the dashboard resume endpoint.
-- Must run non-transactionally: ALTER TYPE ADD VALUE cannot run inside a
-- transaction.
ALTER TYPE public.broadcast_status ADD VALUE IF NOT EXISTS 'paused';
