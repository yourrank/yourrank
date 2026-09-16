-- STAGED CONTRACT MIGRATION — NOT PART OF THE AUTOMATIC MIGRATION HISTORY.
--
-- Promotion procedure:
--   1. Deploy every expand migration through
--      20260915000500_prepare_privileged_function_execute.sql.
--   2. Confirm all production Workers exclusively serve that compatible
--      release and close the N-1 rollback window.
--   3. Move this file to supabase/migrations/ without changing its version.
--   4. Add immediately below the phase marker:
--        -- yourrank:contract-requires-release: <deployed 40-char commit sha>
--   5. Run only through .github/workflows/contract-migration.yml with every
--      required confirmation. Never include it in an automatic deploy.
--
-- yourrank:migration-phase: contract
--
-- C01/F01: privileged SECURITY DEFINER functions kept PostgreSQL's default
-- PUBLIC EXECUTE grant. The expand phase explicitly grants every intentional
-- backend caller before this contract phase removes the public path.

REVOKE EXECUTE ON FUNCTION public.place_bet(uuid, uuid, text, integer, jsonb, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_round_outcome(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.settle_round(uuid, numeric, integer, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.maintain_site_credit_ledger_aggregate()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.maintain_site_credit_balance_aggregate()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.maintain_site_redemption_aggregate()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION app_private.ensure_clicks_partition(date)
  FROM PUBLIC, anon, authenticated;

-- Per-schema default ACLs are additive and cannot subtract PostgreSQL's
-- built-in global PUBLIC EXECUTE default.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
