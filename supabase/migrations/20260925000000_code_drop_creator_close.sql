-- yourrank:migration-phase: expand
--
-- Creator-controlled Code Drop closure.
-- A drop the creator ends early is recorded as an expired drop with
-- `closed_at` set, so every existing reader already treats it as ended while
-- the dashboard can still tell "Ended by creator" from a natural expiry.
-- Prior claims and history stay intact; only new claims are rejected.
--
-- Additive only: one nullable column.

ALTER TABLE public.code_drops
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
