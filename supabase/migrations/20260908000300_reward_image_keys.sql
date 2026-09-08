-- yourrank:migration-phase: expand
-- Private R2 object reference only; never persist encoded image bytes here.
ALTER TABLE public.shop_items ADD COLUMN image_key text;
-- The earlier, local-only image_data experiment is deliberately not dropped:
-- retain those bytes for recovery/re-upload, with no active readers or writers.
-- Rollback: roll back the Worker first; retain image_key and the R2 objects.
