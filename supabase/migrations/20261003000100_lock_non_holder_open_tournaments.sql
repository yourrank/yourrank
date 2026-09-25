-- yourrank:migration-phase: expand
-- Split from 20261003000000_provider_webhook_receipts.sql so databases that
-- already recorded that version (staging) still get the normalization: any
-- open tournament that is not its site's lock-table holder can no longer
-- receive chat signups, so it becomes locked.

-- Backfill again: idempotent for fresh databases (ON CONFLICT DO NOTHING) and
-- grants a holder to any site whose open tournament postdates the first
-- backfill.
INSERT INTO tournament_open_signups (site_id, tournament_id)
SELECT DISTINCT ON (site_id) site_id, id FROM tournaments
 WHERE signup_state = 'open' AND status NOT IN ('completed','cancelled')
 ORDER BY site_id, created_at DESC
ON CONFLICT DO NOTHING;

-- Normalize legacy rows: any open tournament that is not its site's holder
-- can no longer receive chat signups, so it becomes locked. Completed and
-- cancelled tournaments are untouched.
UPDATE tournaments t
   SET signup_state = 'locked', updated_at = now()
 WHERE t.signup_state = 'open'
   AND t.status NOT IN ('completed','cancelled')
   AND NOT EXISTS (
     SELECT 1 FROM tournament_open_signups l WHERE l.tournament_id = t.id
   );
