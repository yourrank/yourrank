-- yourrank:migration-phase: expand
-- Nullable: N-1 rows stay valid. Set by the Worker on the first past_due
-- reconciliation and cleared when the subscription leaves past_due.
ALTER TABLE public.subscriptions ADD COLUMN past_due_since timestamptz;
-- Rollback: roll back the Worker and retain this additive column.
