# Data repair: double-encoded jsonb rows

`../migrations/20260903000000_repair_double_encoded_jsonb.sql` normalises rows
that an earlier build wrote with `JSON.stringify(value)` bound to a `::jsonb`
parameter, so the column stored a JSON *string* instead of an object/array.
Deploy it **after** the writer fixes are live, and only against a database whose
writers no longer double-encode — otherwise new rows re-corrupt behind it.

## Scope

An explicit allowlist of the 20 columns some commit actually wrote from a
pre-serialised binding, derived by scanning every historical version (2,813
blobs, 890 commits) of every source file under `apps/` and `packages/` and
attributing each offending write to its `INSERT INTO`/`UPDATE` target. The seven
remaining jsonb columns in the schema (`account_export_jobs.manifest`,
`archives.top3_json`, `audit_log.details`, `bot_commands.buttons`,
`broadcasts.buttons`, `oauth_states.payload`, `viewer_export_jobs.manifest`) have
no such writer in any commit and are deliberately not touched.

A schema-wide loop was rejected: seeded with production-shaped legacy rows it
aborted on the first table on a malformed `{`-prefixed string and repaired zero
rows.

## Preflight: run this before the migration

`preflight_20260903000000.sql` is a READ-ONLY report that enumerates the rows the
migration would rewrite, using the same allowlist and the same candidate
predicate. Run it against production first and judge every candidate against the
column's application contract:

```bash
psql "$READONLY_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/repair/preflight_20260903000000.sql
```

It is read-only by construction: the script runs inside `SET TRANSACTION READ
ONLY` and ends in `ROLLBACK`, creates nothing (the guarded parse the migration
gets from `jsonb_repair_parse()` is done here by a plpgsql `EXCEPTION` block),
and emits everything through `RAISE NOTICE`.

The role needs `SELECT` **and** must not be filtered by row-level security — the
migration runs as the table owner and sees every row, so an RLS-filtered role
would under-report. The script refuses such a table and lists it under
`could NOT be inspected` rather than reporting a false zero; rehearsal with a
plain `SELECT`-only role reported 14 of 37 candidates and 13 uninspectable
columns, and the same role with `BYPASSRLS` reported all 37.

Sensitive payloads are never dumped. Per candidate the report gives the primary
key, the current jsonb type, the parsed target type, the text length, an md5
fingerprint, and a structural shape (object keys with each value's type and
length, or array length and element types). Key names are printed; values are
not. It also reports totals, counts per table/column, columns with zero
candidates, and any column it could not inspect.

## Guarantees, and how they were rehearsed

Rehearsal seeds nine legacy shapes into all 27 jsonb columns of the migrated
schema, including FK-valid `game_rounds`/`credit_ledger` parents (176 rows), then
runs the preflight, the repair twice and the rollback.

| Row shape | Behaviour | Rehearsal |
| --- | --- | --- |
| double-encoded object/array | repaired to object/array | 37 rows across all 20 allowlisted columns |
| malformed `{`/`[`-prefixed string | preserved | 42 rows still `string` |
| scalar JSON string (`"hello world"`) | preserved | 21 rows |
| JSON `null` | preserved | 21 rows |
| SQL `NULL` | preserved | 23 rows |
| already object/array | untouched | unchanged in every column |
| column outside the allowlist | untouched even when double-encoded | 7 columns unchanged |

Every cast goes through `jsonb_repair_parse()`, which returns `NULL` instead of
raising on invalid JSON, so one malformed legacy value cannot abort the
deployment. The function is dropped again at the end of the migration.

Idempotency: the second run reported `0 row(s)` and wrote no new pre-images.

The preflight cross-checks the repair: on the same fixture it reported 37
candidates before the run, 0 after it, and 37 again after the rollback — matching
the migration's own `37 row(s)` exactly.

## Recovery

Every rewritten row's previous value is stored in
`public.jsonb_repair_preimage` (`table_name`, `column_name`, `row_key` as the
primary key as jsonb, `before_value`). The migration aborts if the pre-image
count and the repaired count ever disagree, and refuses any allowlisted table
without a primary key.

To revert, run `rollback_20260903000000.sql`. It restores each row from its
pre-image by primary key, and only where the current value still equals what the
repair wrote, so rows edited by the application after the repair are left alone.
In rehearsal it returned all 27 columns to a byte-identical pre-repair snapshot.

Drop `public.jsonb_repair_preimage` deliberately once the repair has been
accepted in production; nothing reads it at runtime.

## Deployment checklist

1. The writer fixes (#620) are live on every deployment that can write these
   columns — leaderboard, bot, monitor and the consumer Worker — with no older
   version still serving.
2. Preflight run against production with a read-only, RLS-exempt role; the report
   says `PREFLIGHT COMPLETE` and every candidate is classified.
3. Candidate count recorded, so it can be compared with the migration's own
   `jsonb repair complete: N row(s)` notice.
4. The migrating role may create `public.jsonb_repair_preimage`.
5. `rollback_20260903000000.sql` is to hand before the run, not after.
6. After the run, re-run the preflight: it must report 0 candidates.
7. Nothing else ships in the same deployment.

## Known ambiguity

Within an allowlisted column, a jsonb string whose text parses to an object or an
array **is a candidate and will be rewritten**. A row that deliberately stored
the *text* of a JSON object is indistinguishable from a legacy double-encoded
row, so the predicate alone cannot tell them apart. Three things bound that risk:

1. the allowlist restricts it to the 20 columns with a provably pre-serialising
   writer — no other jsonb column is touched, even when double-encoded;
2. the preflight enumerates the real candidates read-only, so each one is
   classified against its column's contract before anything is written;
3. pre-images are retained, so a misjudgement is reversible per row.

Everything else is preserved unconditionally: malformed strings, scalar JSON
strings, JSON `null`, SQL `NULL`, and values already stored as an object or an
array.
