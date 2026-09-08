# Recent changes reconciled with main — 2026-09-08

The PR was prepared after fetching every remote branch from
`https://github.com/yourrank/yourrank.git` and reading GitHub PR history.
The base is `24aac440` (PR #696). This checkout has two pre-existing local
branches and one worktree; no other local checkout was found.

## Already in main

- `feat/local-changes-2026-09-07` at `1dd140ad`: merged by #696. Its complete
  committed tree is identical to `24aac440`, despite the different commit IDs
  created by the squash merge. The previous dashboard redesign, viewer shell,
  design system, tests, documentation and E2E assertion correction are retained.
- Recent product work: #663–#680 (public viewer, architecture, billing,
  creator navigation, Community, People, safe Activities, Reviews, Claims,
  Moderator operations, Insights, viewer membership, automation).
- Recent release work: #681–#695 (release readiness, safe free code drops,
  neutral defaults, release and migration safety, staging, database identity,
  recovery, queues, and monitor deployment). Branch tips were compared with
  their merged PR head SHAs for all 34 non-dependency branch heads dated
  August 28 onward.
- Two tips differed from their original merged PR: the extra
  `codex/release-readiness` patch is exactly the patch merged in #682, and the
  extra `codex/monitor-alert-secrets-release-push` patch is exactly the patch
  merged in #695. Stable patch IDs match in both cases. Neither fix is missing.

## Included in this PR

All current source/test/design/documentation/Windows-startup edits and new files
from the working tree, including the earlier local improvements and the audit
corrections documented in `audit-findings-verification.md`. This includes the
canonical generated asset bundle, already tracked by the repository.

The missing historical #643–#649 release notes from open PR #650 were reconciled
into the current changelog. Its unrelated `.aig`, `DQL` and route spelling
regressions were not copied. The original PR remains untouched.

Local logs, browser screenshots, PR inventory downloads and temporary runtime
files remain on disk and are excluded by `.local-logs/` in `.gitignore`.

## Explicit exclusions

- Open Dependabot major-version upgrades remain separate dependency PRs; they
  are not the user's recent AI-authored feature/fix work.
- Historical July/August closed alternatives and abandoned branch snapshots
  were not merged wholesale over the newer canonical implementation. Older
  unassociated branch examples were inspected: account-deletion single ownership
  and SPA site selection already exist in the current owners; old route-title
  tables have been replaced by the canonical shared route model. The older
  lifecycle-audit branch changes overlap the later lifecycle/player-rules work
  and are outside this recent-work consolidation. This is not a claim that
  every historical unmerged commit should be released.
- No branch was deleted, no existing PR was closed, and main was not force-pushed
  or merged by this task. Deployment remains separate from opening the PR.

## Verification and release prerequisites

The audited working tree passed lint, typecheck, 2,215 tests (108 skips), the
migration compatibility gate, renderer/browser regressions and local R2 tests.
See `audit-findings-verification.md` for the precise executed scope. The base
reconciliation changes no application code because the base trees were identical.

Provision the private production/staging R2 buckets and apply the additive
migrations before deploying. Legacy local experimental Postgres pictures are
preserved but need re-upload. Actual production resources, database application,
OAuth, Claims and the full creator upload browser journey are not verified here.
