-- yourrank:migration-phase: expand
-- Additive. Commit enum addition before the following migration uses it.
ALTER TYPE public.pay_provider ADD VALUE IF NOT EXISTS 'polar';
