# Recovery & Restoration Runbook

This runbook outlines the procedures for verifying backups and restoring the YourRank production database in the event of data loss, corruption, or catastrophic failure.

## 1. Backup Strategy (Supabase)

YourRank relies on Supabase's managed Postgres infrastructure. The repository does not prove that production automated backups or point-in-time recovery are enabled. Treat both as **NOT VERIFIED** until the provider dashboard is checked and a restore into an isolated scratch project succeeds. Record a successful drill through the admin backup-verification endpoint; `/api/health/backup` remains degraded without that evidence.

### 1.1 Verifying Backup Status
1. Log in to the [Supabase Dashboard](https://app.supabase.com).
2. Navigate to the YourRank production project.
3. Go to **Database** -> **Backups**.
4. Verify that **Point in Time Recovery** is enabled.
5. Check the list of daily physical backups to ensure they are being completed successfully.

## 2. Restoration Procedures

### Scenario A: Minor Data Corruption (Partial Restore)
If only a specific table or set of rows was corrupted (e.g., bad migration or accidental deletion):
1. **Do NOT overwrite production immediately.**
2. Go to the Supabase Dashboard -> **Database** -> **Backups** -> **PITR**.
3. Spin up a **Recovery Project** restoring to a timestamp *just before* the corruption event.
4. Once the Recovery Project is active, use `pg_dump` to export the clean data:
   ```bash
   pg_dump -h <RECOVERY_DB_HOST> -U postgres -d postgres -t corrupted_table --data-only > clean_data.sql
   ```
5. Apply the clean data to the production database:
   ```bash
   psql -h <PROD_DB_HOST> -U postgres -d postgres -f clean_data.sql
   ```

### Scenario B: Catastrophic Failure (Full Restore)
If the entire database is corrupted or dropped:
1. Go to the Supabase Dashboard -> **Database** -> **Backups** -> **PITR**.
2. Select the exact time before the catastrophic event.
3. Choose the option to **Restore to this project** (or restore to a new project if you want to verify first and then redirect DNS/Hyperdrive connection strings).
4. Wait for the restoration to complete (can take several minutes depending on database size).
5. Verify application functionality on staging/production.
6. If a new project was created, update the `DATABASE_URL` in Cloudflare Secrets and `wrangler.toml` Hyperdrive configs to point to the new database.

## 3. Disaster Recovery Testing
To ensure readiness, this restore procedure should be tested quarterly:
1. Create a dummy project in Supabase.
2. Trigger a PITR restore of production data into the dummy project.
3. Run `bun run test` against the dummy project to verify data integrity.
4. Delete the dummy project after successful verification.
