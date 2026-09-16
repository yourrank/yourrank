-- READ-ONLY preflight for the historical effects of
-- migrations/20260831000002_redeem_idempotency_durable.sql (C17/F17).
--
-- That applied migration deleted duplicate redemptions (same site_viewer_id +
-- client_token) keeping only one row per token, WITHOUT recording preimages or
-- reconciling the credit ledger. This preflight inventories the evidence a
-- later reconciliation decision needs. It changes nothing: read-only
-- transaction, ROLLBACK at the end, RAISE NOTICE output only.
--
-- It reports the surviving evidence that can still identify deleted claims.
-- The deleted rows themselves (including their client tokens and statuses)
-- cannot be reconstructed from the live database unless a backup/PITR image
-- from before the migration is available.
--   * ledger consistency: credit_ledger rows (types spend/revoke with
--     metadata.redemption_id) whose redemption row no longer exists, and
--     vice versa;
--   * aggregate drift: site_credit_aggregates redemption counters vs the
--     truth recomputed from surviving redemptions;
--   * balance drift: each site_viewer's balance vs the sum of its ledger.
--
-- Run with a read-only, RLS-exempt role (see preflight_20260903000000.sql):
--   psql "$READONLY_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/repair/preflight_20260831000002_redemption_dedup.sql
--
-- Interpretation guide:
--   * ledger rows pointing at deleted redemption ids prove money movement for
--     claims that no longer exist -> candidates for historical reconciliation;
--   * aggregate/balance drift quantifies how far counters have walked from
--     the surviving history;
--   * ZERO everywhere means the dedup deleted rows whose side effects were
--     already absent (e.g. cancelled duplicates) and no repair is needed.
--
-- No repair statement is included: destructive recovery requires the evidence
-- this script produces plus a separately reviewed decision.

BEGIN;
SET TRANSACTION READ ONLY;

DO $$
DECLARE
  ledger_orphans int;
  redemption_orphans int;
  groups_affected int;
  rows_deleted_estimate int;
  drift_rows int;
  balance_drift_rows int;
  rec record;
BEGIN
  RAISE NOTICE 'redemption dedup preflight (READ ONLY) on database % at %', current_database(), now();
  RAISE NOTICE 'server: %', version();

  -- 1. Ledger entries whose redemption was deleted by the dedup.
  SELECT count(*) INTO ledger_orphans
    FROM public.credit_ledger l
   WHERE l.metadata ? 'redemption_id'
     AND l.metadata ->> 'redemption_id' IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.redemptions r
        WHERE r.id::text = l.metadata ->> 'redemption_id'
     );
  RAISE NOTICE 'ledger entries referencing missing redemptions (spend/revoke orphans): %', ledger_orphans;
  IF ledger_orphans > 0 THEN
    FOR rec IN
      SELECT l.site_viewer_id, l.type, count(*) AS entries,
             sum(l.amount) AS total_amount, min(l.created_at) AS first_at, max(l.created_at) AS last_at
        FROM public.credit_ledger l
       WHERE l.metadata ? 'redemption_id'
         AND NOT EXISTS (
           SELECT 1 FROM public.redemptions r
            WHERE r.id::text = l.metadata ->> 'redemption_id'
         )
       GROUP BY l.site_viewer_id, l.type
       ORDER BY total_amount DESC
       LIMIT 20
    LOOP
      RAISE NOTICE '  orphan ledger: site_viewer=% type=% entries=% total_amount=% between % and %',
        rec.site_viewer_id, rec.type, rec.entries, rec.total_amount, rec.first_at, rec.last_at;
    END LOOP;
  END IF;

  -- 2. Surviving redemptions with no ledger entry at all (created before the
  --    ledger discipline, or deleted counterpart left no trace).
  SELECT count(*) INTO redemption_orphans
    FROM public.redemptions r
   WHERE r.client_token IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.credit_ledger l
        WHERE l.metadata ->> 'redemption_id' = r.id::text
     );
  RAISE NOTICE 'surviving redemptions with no matching ledger entry: %', redemption_orphans;

  -- 3. Duplicate groups: how many (site_viewer_id, client_token) groups exist
  --    today, and an estimate of what the dedup removed, from the audit trail.
  SELECT count(*) INTO groups_affected
    FROM (
      SELECT 1
        FROM public.redemptions
       WHERE client_token IS NOT NULL
       GROUP BY site_viewer_id, client_token
      HAVING count(*) > 1
    ) duplicate_groups;
  groups_affected := coalesce(groups_affected, 0);
  RAISE NOTICE 'duplicate redemption groups still present (should be 0 after the migration): %', groups_affected;

  -- Audit-trail evidence of the deletion: claim_cancelled/claim_completed
  -- entries whose source_id no longer resolves.
  SELECT count(*) INTO rows_deleted_estimate
    FROM public.audit_log a
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        NULLIF(a.details ->> 'source_id', ''),
        CASE WHEN a.entity_id LIKE 'redemption:%'
             THEN substring(a.entity_id FROM length('redemption:') + 1)
        END
      ) AS redemption_ref
    ) ref
   WHERE a.entity_type = 'claim'
     AND a.action IN ('claim_completed', 'claim_cancelled')
     AND ref.redemption_ref IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.redemptions r
        WHERE r.id::text = ref.redemption_ref
     );
  RAISE NOTICE 'audit claim rows whose redemption no longer exists (deleted by dedup or cascade): %', rows_deleted_estimate;

  -- 4. Aggregate drift: stored counters vs recomputed truth.
  RAISE NOTICE '--- site_credit_aggregates drift (redemption counters) ---';
  FOR rec IN
    SELECT a.site_id,
           a.redemptions_pending  AS stored_pending,
           a.redemptions_fulfilled AS stored_fulfilled,
           a.redemptions_cancelled AS stored_cancelled,
           truth.true_pending,
           truth.true_fulfilled,
           truth.true_cancelled
      FROM public.site_credit_aggregates a
      CROSS JOIN LATERAL (
        SELECT count(*) FILTER (WHERE r.status = 'pending')   AS true_pending,
               count(*) FILTER (WHERE r.status = 'fulfilled') AS true_fulfilled,
               count(*) FILTER (WHERE r.status = 'cancelled') AS true_cancelled
          FROM public.redemptions r
          JOIN public.site_viewers sv ON sv.id = r.site_viewer_id
         WHERE sv.site_id = a.site_id
      ) truth
     WHERE a.redemptions_pending  IS DISTINCT FROM truth.true_pending
        OR a.redemptions_fulfilled IS DISTINCT FROM truth.true_fulfilled
        OR a.redemptions_cancelled IS DISTINCT FROM truth.true_cancelled
     LIMIT 20
  LOOP
    RAISE NOTICE '  site=% stored(p=%,f=%,c=%) true(p=%,f=%,c=%)',
      rec.site_id, rec.stored_pending, rec.stored_fulfilled, rec.stored_cancelled,
      rec.true_pending, rec.true_fulfilled, rec.true_cancelled;
  END LOOP;

  SELECT count(*) INTO drift_rows
    FROM public.site_credit_aggregates a
    CROSS JOIN LATERAL (
      SELECT count(*) FILTER (WHERE r.status = 'pending')   AS true_pending,
             count(*) FILTER (WHERE r.status = 'fulfilled') AS true_fulfilled,
             count(*) FILTER (WHERE r.status = 'cancelled') AS true_cancelled
        FROM public.redemptions r
        JOIN public.site_viewers sv ON sv.id = r.site_viewer_id
       WHERE sv.site_id = a.site_id
    ) truth
   WHERE a.redemptions_pending  IS DISTINCT FROM truth.true_pending
      OR a.redemptions_fulfilled IS DISTINCT FROM truth.true_fulfilled
      OR a.redemptions_cancelled IS DISTINCT FROM truth.true_cancelled;
  RAISE NOTICE 'sites with redemption aggregate drift: %', coalesce(drift_rows, 0);

  -- 5. Per-viewer balance vs ledger truth.
  SELECT count(*) INTO balance_drift_rows
    FROM public.site_viewers sv
   WHERE sv.balance IS DISTINCT FROM (
     SELECT coalesce(sum(
       CASE l.type
         WHEN 'earn' THEN l.amount
         WHEN 'refund' THEN -l.amount
         WHEN 'spend' THEN -l.amount
         WHEN 'revoke' THEN l.amount
         ELSE 0
       END), 0)
       FROM public.credit_ledger l
      WHERE l.site_viewer_id = sv.id
   );
  RAISE NOTICE 'site_viewers whose balance differs from ledger sum: %', coalesce(balance_drift_rows, 0);

  RAISE NOTICE '--- summary ---';
  RAISE NOTICE 'ledger orphans: % | redemptions without ledger: % | audit orphans: % | aggregate drift sites: % | balance drift viewers: %',
    coalesce(ledger_orphans, 0), coalesce(redemption_orphans, 0), coalesce(rows_deleted_estimate, 0),
    coalesce(drift_rows, 0), coalesce(balance_drift_rows, 0);
  RAISE NOTICE 'Nothing was modified. Reconcile only from this evidence under a separately reviewed decision.';
END $$;

ROLLBACK;
