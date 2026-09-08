# Audit findings verification — 2026-09-08

Scope: verify the supplied audit against the existing uncommitted work, repair
confirmed regressions, preserve that work and the project's restricted legacy
boundaries. No commits, deployments, remote resource creation or database
mutations were performed in this task.

## Finding dispositions

| Finding | Evidence and disposition |
| --- | --- |
| 2.1 JSONB binding | Already corrected on arrival: event INSERT/UPDATE bind the raw player array. Contract test PASSED. The first cold scan exceeded its default five-second timeout; its isolated rerun and the full root run passed. |
| 2.2 Expand migrations | Already corrected on arrival: the event table uses the existing backend-only `app_private` schema with explicit Worker grants. The inline nullable-column constraint passed the gate. No RLS/REVOKE protections were removed. The unshipped image-bytes addition was subsequently removed for 3.1. |
| 2.3 Shop INSERT signature | Existing test already accounts for the seventh nullable value; it passed before this task. This was a SQL assertion change, not a changed JavaScript handler signature. The seventh value is now an R2 key. |
| 2.4 Channels heading | Intentional channel navigation; the regression assertions were already updated and passed. No duplicate heading was restored. |
| 2.5 Brand-link snapshot | Intentional community-local navigation; the existing snapshot already matched and passed. No snapshot update was required in this task. |
| 3.1 Database media storage | Confirmed; replaced active `image_data` persistence with a private R2 bucket and nullable `image_key`. JSON responses still contain only `has_image`. |
| 3.2 Decoding and caching | Read-time `atob` was removed with database media storage. Invalid/cross-site keys and missing objects return 404; missing/offline storage returns 503. Public-path images can still be password-protected or unpublished, so shared CDN caching would bypass current access checks. Private browser copies now revalidate with ETag after authorization. |
| 4.1 Unavailable event | Document requests recover to main standings with a status message. Invalid/stale event pagination requests continue returning 404 so they cannot append main-board players into an event list. Both slug and custom-domain document paths are covered. |
| 4.2 Switcher hierarchy | Confirmed and fixed: title precedes the selector. Explicit “View leaderboard” submission is retained for predictable keyboard and no-JavaScript operation; lack of auto-submit is not a functional defect. |
| 4.3 Search clears loaded pages | Confirmed. The unfiltered snapshot now includes appended pages. Query changes restore that snapshot, invalidate outstanding requests and reset loading controls. Browser test reproduced the old 200→100 regression and passed after rebuilding. |
| 4.4 Incomplete podium | Confirmed. Three distinct eligible top ranks are required; one/two-player and tied boards retain ordinary rows. |
| 4.5 Template preview sizing | Not reproduced from the implementation: `applyViewerTemplate` calls `markDirty`, the draft subscriber renders the preview, and the new iframe's load callback calls `fitPreviewMount`. Unsaved-template renderer test passes. Full creator-browser template switching was not exercised in this task. No duplicate refresh path was added. |
| 4.6 In-canvas editing | Confirmed. Explicit field markers select only the creator's name span and tagline, preserving surrounding heading copy. Removed dead `yr_preview_update` and player-edit branches. Parent validates origin/current iframe/field allowlist and dispatches a bubbling input to the canonical draft owner. Edit listeners are removed after completion. |
| 4.7 Creator picture visibility | Confirmed. Reward list rows now render a lazy, site-scoped thumbnail for items with pictures, using existing row styling. |

## Executed verification

- PASSED: `bun run lint`, `bun run typecheck`.
- PASSED: full `bun run test`: **2,215 passed, 108 skipped, zero failed**.
  The build initially hit sandbox `Access denied` in esbuild; the authorized
  build/root run outside the sandbox succeeded. No test or security gate was
  weakened. After the final preview-listener cleanup, its eight handler tests
  and the browser regression were rerun.
- PASSED: shared compilation and canonical asset build; generated bundles come
  from their source owners.
- PASSED: `node scripts/check-migration-compatibility.mjs`; immutable production
  baseline and additive migration admission are preserved.
- PASSED: `node scripts/verify-viewer-audit.mjs` with the bundled Playwright
  runtime and local Chrome. Real renderer, preview handler and built browser
  assets; fixture persistence only. Covers pagination→remote search→clear→next
  page, locally matched search, late-page races, 1/2/3-player Spotlight boards
  at 390px and 1440px, no horizontal overflow, heading order, edit/Enter/Escape,
  repeated editing, and an uneditable Leaderboard heading. No page errors.
  Screenshots are under ignored `.local-logs/viewer-audit/`; mobile two-player
  and desktop three-player screenshots were visually inspected.
- PASSED: `node scripts/verify-reward-media.mjs` with real local workerd/R2 and
  fixture database collaborators. Covers byte-for-byte delivery, ETag 304,
  password gating before conditional responses, old-object deletion on replace,
  explicit picture removal, and reward deletion retaining the claim row.
- PASSED: final `git diff --check`.
- SKIPPED: 108 existing credential/integration-dependent root tests; these are
  not passes.

The browser script accepts `PLAYWRIGHT_MODULE_PATH` (path to Playwright's
`index.mjs`) and `CHROMIUM_EXECUTABLE` for machines without default installs.
The R2 script uses the repository's existing Miniflare dependency.

## Deployment and data limits

- NOT RUN: production/staging deployment, remote R2 creation, actual database
  migration application, real OAuth/Claims, and the full creator upload/thumbnail
  browser journey. The new migration is gate-tested, not database-applied here.
- Before deploying, provision private `yourrank-reward-images` and
  `yourrank-reward-images-staging` buckets in their intended environments, bound
  as `REWARD_IMAGES`. Keep public bucket/custom-domain access disabled; delivery
  goes through the authorized Worker route. See the official
  [R2 Worker binding/API reference](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).
- Apply `20260908000300_reward_image_keys.sql` before this Worker. The earlier
  `20260908000100_reward_images.sql` is uncommitted and outside the immutable
  production baseline; it now adds only `deleted_at`. A local database that
  already ran its earlier experimental version should apply 003, not rerun 001.
  Its legacy `image_data` is preserved but no longer read or written. Those local
  experimental pictures need re-uploading through the new path; no old bytes
  were deleted or silently backfilled.
- Missing storage fails picture uploads explicitly; ordinary reward edits still
  work after the schema migration. Database state is authoritative. Cleanup of
  an old object runs after a successful commit; cleanup failures are logged.
  An uncertain database commit after a successful R2 upload deliberately retains
  the new object to avoid deleting a potentially committed picture. Such orphans
  need operational reconciliation; there is no automatic orphan collector.
- Rollback must keep database columns and bucket objects. Do not revert to the
  experimental Postgres-image writer. Nothing in this task alters the immutable
  production migration baseline or deploys a rollback.
