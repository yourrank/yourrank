-- yourrank:migration-phase: expand
-- Per-viewer per-item redemption cooldown, in seconds. NULL/0 means "no
-- cooldown"; the Worker enforces the 0..604800 (7 days) bound on write and
-- coalesces NULL to 0 on read, so a nullable column is expand-safe. The
-- NOT NULL DEFAULT 0 + CHECK tightening is a documented contract-phase change.
ALTER TABLE public.shop_items
  ADD COLUMN cooldown_seconds integer;
-- Rollback: roll back the Worker first; the column is nullable and additive.
-- ALTER TABLE public.shop_items DROP COLUMN cooldown_seconds;
