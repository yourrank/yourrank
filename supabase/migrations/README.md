# Database Migrations

This directory contains the canonical database migration history for YourRank.

## Migration Format

Migrations use Supabase's conventional timestamped naming format: `YYYYMMDDHHMMSS_description.sql`

## Recent Migration History

The following migrations were consolidated from the previous `db/migrations/` directory:

- `20260625000000_payments_stars_idempotency.sql` (was `001_payments_stars_idempotency.sql`)
- `20260625000001_click_daily_index.sql` (was `002_click_daily_index.sql`)
- `20260625000002_rls_enable.sql` (was `003_rls_enable.sql`)
- `20260625000003_money_numeric.sql` (was `004_money_numeric.sql`)
- `20260625000004_money_constraints.sql` (was `005_money_constraints.sql`)
- `20260625000005_rls_fix_anon_access.sql` (was `006_rls_fix_anon_access.sql`)
- `20260628000000_referral_program.sql` (was `008_referral_program.sql`)
- `20260702000000_multi_board.sql` (was `009_multi_board.sql`)
- `20260702000001_custom_domain.sql` (was `010_custom_domain.sql`)
- `20260702000002_trial.sql` (was `011_trial.sql`)
- `20260702000003_player_subscriptions.sql` (was `012_player_subscriptions.sql`)
- `20260703000000_drop_referral_schema.sql` (was `013_drop_referral_schema.sql`)
- `20260703000001_admin_2fa.sql` (was `014_admin_2fa.sql`)
- `20260703000002_custom_domain_tls.sql` (was `015_custom_domain_tls.sql`)

## Critical Bug Fixes

- `20260625000005_rls_fix_anon_access.sql` - Fixes RLS policies that were too permissive (was migration 006). Resolves security issue where anon role had full access to all tables between migrations 003-006.
- `20260703000003_fix_missing_columns_and_enums.sql` - Fixes missing `suspended` column on sites table and casinos.created_by foreign key (BUG-002, BUG-007)
- `20260703000004_add_missing_enum_values.sql` - Adds missing enum values for pay_provider ('trial') and plan_tier ('starter') (BUG-003, BUG-004). Note: This migration must run non-transactionally due to Postgres limitations.

## Migration Order

When applying migrations, they should be applied in timestamp order (oldest to newest) to ensure the database schema evolves correctly.

Production has recorded every migration through `20260907000000`. Do not edit,
rename, remove, or insert a lower-versioned migration; the immutable baseline is
recorded in `../migration-policy.json` and checked in CI and before production
migration execution.

Every later migration must begin with:

```sql
-- yourrank:migration-phase: expand
```

The automatic deployment path accepts expand-phase changes only. It rejects
contract operations such as dropping or renaming schema objects, narrowing
column types/nullability, adding write constraints, destructive data removal,
and revoking privileges. Introduce additive schema first, deploy code that works
with both old and new schema, backfill safely, and perform contract removal only
in a later deliberately reviewed release after the rollback window is compatible.

Contract migrations are marked `-- yourrank:migration-phase: contract` plus
`-- yourrank:contract-requires-release: <commit sha>` and are refused by
`deploy.yml`. They run only through the manual `contract-migration.yml`
workflow, which verifies that every production Worker serves that release
exclusively before applying them (see `DEPLOY.md`).

## Deprecated Directory

The `db/migrations/` directory is deprecated and should no longer be used. All new migrations should be added to this `supabase/migrations/` directory using the timestamped format.
