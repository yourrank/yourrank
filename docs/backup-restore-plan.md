# Backup & Restore Plan — YourRank

**Date:** 2026-07-08
**Status:** Pending S M action

## Current State

Supabase project: `lygcqzjxlqbvymkfjvel`
- Automated backups: **unknown** (needs verification in Supabase dashboard)
- PITR: **unknown** (needs verification)

## Action Items (requires S M)

### 1. Enable PITR in Supabase

1. Go to Supabase Dashboard → Project → Settings → Backups
2. Enable Point-in-Time Recovery (PITR)
3. Set retention to at least 7 days
4. Document the RPO (Recovery Point Objective): ≤ 5 minutes with PITR

### 2. Perform Restore Drill

The drill is executable: `.github/workflows/restore-drill.yml` (manual dispatch)
driving `scripts/restore-drill.mjs`. It restores the newest backup into an
isolated scratch database, runs integrity checks (required tables, non-empty
`users`/`sites`, validated foreign keys, RLS on server-only tables, migration
history, application roles) and Worker read paths, measures RTO/RPO, retires the
scratch copy, and publishes a secret-free evidence document. A failed restore or
failed check exits red and the evidence is `success:false`; nothing is recorded
automatically.

One-time setup (GitHub environment `recovery-drill`, credentials separate from
the Worker identity `yourrank_worker` and from release secrets):

1. Create a dedicated scratch Supabase project (never the production ref
   `lygcqzjxlqbvymkfjvel`); set variable `RESTORE_TARGET_ID` to its ref and
   secret `RESTORE_TARGET_DATABASE_URL` to its `postgres` connection URL.
2. `provider-backup` drills: secret `SUPABASE_ACCESS_TOKEN` (Management API,
   read backup metadata) and, per run, secret `RESTORE_BACKUP_DOWNLOAD_URL` — the
   short-lived download link of the newest completed backup from Dashboard →
   Database → Backups. The Management API restore endpoints target the same
   project (which would overwrite production), so a download link is the
   automation-compatible input for an isolated restore.
3. `logical-dump` drills: secret `RESTORE_SOURCE_DATABASE_URL`, a dedicated
   read-only production credential (not `yourrank_worker`).

Recording the result (F-058): an admin with fresh step-up 2FA posts the evidence
to `POST /api/admin/backup-verifications`:

```json
{ "provider": "supabase", "target": "restore-drill:<RESTORE_TARGET_ID>",
  "startedAt": "<evidence.startedAt>", "completedAt": "<evidence.completedAt>",
  "rtoSeconds": <evidence.rtoSeconds>, "rpoSeconds": <evidence.rpoSeconds>,
  "releaseSha": "<evidence.releaseSha>",
  "evidence": { "workflowRunId": "...", "sourceBackupId": "...", "restoreTargetId": "...",
                "restoreTargetRetired": true, "integrityChecks": [...], "applicationReadChecks": [...] } }
```

The API and a database trigger reject future `completedAt` (beyond 5 min skew),
`startedAt > completedAt`, negative RTO/RPO, and credential-like strings.
Freshness for `/api/health/backup` is computed from the server-stamped
`verified_at`, not the supplied timestamps.

### 3. Document RTO/RPO

| Metric | Target | Actual |
|--------|--------|--------|
| RPO (data loss window) | ≤ 5 min | TBD |
| RTO (restore time) | ≤ 30 min | TBD |
| Backup retention | 7 days | TBD |

## Emergency Restore Procedure

1. Go to Supabase Dashboard → Project → Settings → Backups
2. Select the restore point (timestamp)
3. Confirm restore (this overwrites the current database)
4. Wait for restore to complete
5. Verify health: `GET /health` should return `db: true`
6. Verify data: check a known board and user

## Related

- Phase 4.1 of launch plan
- Supabase docs: https://supabase.com/docs/guides/platform/backups
