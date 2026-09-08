-- Retain deleted rewards for claims history. Media bytes belong in R2.
-- yourrank:migration-phase: expand
ALTER TABLE public.shop_items ADD COLUMN deleted_at timestamptz;
-- Rollback: roll back the Worker first; retain this nullable column.
