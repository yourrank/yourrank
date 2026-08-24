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

## Guarantees, and how they were rehearsed

Rehearsal seeds nine legacy shapes into all 27 jsonb columns of the migrated
schema (174 rows) plus FK-valid `game_rounds`/`credit_ledger` rows, then runs the
repair twice and the rollback once.

| Row shape | Behaviour | Rehearsal |
| --- | --- | --- |
| double-encoded object/array | repaired to object/array | 34 rows across 17 columns, plus `game_rounds.params`/`outcome` and `credit_ledger.metadata` on FK-valid rows |
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

## Known ambiguity

A column that legitimately stored the *text* of a JSON object is
indistinguishable from a double-encoded row. This is why the scope is an
allowlist of columns whose writers provably pre-serialised, and why the
pre-images are retained rather than discarded at the end of the run.
