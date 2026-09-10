-- yourrank:migration-phase: expand
-- Durable marker survives an uncertain provider response or checkout URL write.
ALTER TABLE app_private.polar_accounts ADD COLUMN IF NOT EXISTS checkout_attempt_id uuid;
