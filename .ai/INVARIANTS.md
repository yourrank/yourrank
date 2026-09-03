# Project Invariants

This file contains properties that must remain true across the system.

Use it for rules that should be enforced repeatedly and, where practical, by automated tests.

## Invariant format

```text
Name:
Scope:
Property:
Why it matters:
Source of truth:
How coverage is derived:
Named enforcement/test:
Intentional exclusions:
```

Requirements containing words such as `never`, `always`, `across all`, `exactly one`, `must not regress`, `permanently`, or `single source of truth` should be considered for promotion into an invariant.

## NAV-001 — One Navigation Owner Per Destination

A feature destination must not appear in competing navigation scopes at the same time unless explicitly allowed.

Typical competing scopes:
- global/sidebar navigation
- top-level product navigation
- feature-local tabs/subnavigation

Breadcrumbs may legitimately repeat location context and should be modeled separately.

## NAV-002 — Feature Tabs Stay Inside Their Route Family

Feature-specific tabs/subnavigation render only inside the route family they belong to.

Coverage derives from the real router/route manifest.

## NAV-003 — Rendered Route Coverage Comes From the Router

When route scope is machine-enumerable, verification must derive route patterns from the router or canonical route manifest, not a hand-written list.

Dynamic route patterns may use representative fixtures.

Coverage reports distinguish:
- route patterns defined
- route patterns verified
- intentional exclusions
- unverified patterns

## ARCH-001 — One Canonical Active Implementation

One concept should have one canonical active implementation unless deliberate versioning or migration is documented.

## ARCH-002 — No Casual V2/New/Final Forks

No duplicate implementation may exist merely because modifying the canonical implementation was harder.

## REL-001 — Production Cron Capacity Is Validated Before Mutation

Name: Cloudflare production Cron Trigger capacity gate

Scope: Production Wrangler configuration for Leaderboard, Bot, Consumer, and Monitor Workers.

Property: The repository must declare exactly one, three, one, and one production Cron Triggers respectively; every trigger must use a valid `[triggers]` object table; and the six-trigger total must fit the explicitly declared Cloudflare Workers plan before any production database or Worker mutation starts.

Why it matters: Wrangler uploads Worker code before applying Cron Trigger changes. An invalid or over-capacity schedule update can therefore report deployment failure after production code has already changed.

Source of truth: `apps/*/wrangler.toml`, `scripts/check-production-cron-capacity.mjs`, and the `CLOUDFLARE_WORKERS_PLAN` GitHub repository variable.

How coverage is derived: The preflight's inventory names every production Worker with a `[triggers]` table and reads each canonical Wrangler file directly.

Named enforcement/test: `.github/workflows/deploy.yml` release preflight and `apps/leaderboard/src/__tests__/release-config.test.js`.

Intentional exclusions: The Web Worker has no scheduler. Staging is separately blocked until its isolated infrastructure is provisioned and is not counted against this production inventory.

## REL-002 — Failed Production Releases Reconcile Actual Mutated State

Name: Deterministic post-mutation Worker recovery

Scope: Production migrations and the Leaderboard, Bot, Consumer, smoke, and Monitor stages in `.github/workflows/deploy.yml`.

Property: Exact Cloudflare Worker version allocations and Supabase migration history are captured before mutation. An always-evaluated finalizer observes production after every failed or cancelled mutation stage, retains migrations, and restores only Workers whose active version allocations differ from the captured state. Failed recovery commands, state mismatch, or bounded health failure leave the workflow red.

Why it matters: GitHub skips dependent jobs after an upstream failure by default, while Wrangler can change the active Worker version before returning a later deployment error. Job success is therefore not a reliable proxy for production state.

Source of truth: `.github/workflows/deploy.yml` and `scripts/release-recovery-state.mjs`.

How coverage is derived: The recovery model enumerates the canonical production Worker inventory and every mutation/finalization job in the workflow.

Named enforcement/test: `apps/leaderboard/src/__tests__/release-config.test.js` covers failures at each deploy boundary, smoke failure, preflight failure, cancellation, exact state capture, and recovery failure behavior.

Intentional exclusions: Database migrations are never rolled back. Compatibility with retained expand migrations is enforced by DB-001. A GitHub force-cancel or platform outage can prevent any in-workflow recovery and remains an operational incident.

## DB-001 — Pre-deploy Migrations Preserve the N/N-1 Window

Name: Expand-only automatic production migrations

Scope: `supabase/migrations/*.sql` newer than the production migration baseline.

Property: Applied migration history is immutable and new migration versions sort after it. The automatic production migration job accepts only explicitly marked expand-phase SQL and rejects contract operations that can make the deployed or immediately previous Worker version incompatible.

Why it matters: Production migrations run before Worker deployment, and a later deployment failure leaves the schema ahead of code. Additive schema is safe in that state; destructive contraction is not.

Source of truth: `supabase/migration-policy.json`, `scripts/check-migration-compatibility.mjs`, and `supabase/migrations/README.md`.

How coverage is derived: The preflight hashes every migration at or below the recorded production baseline and validates every higher migration in filename order.

Named enforcement/test: The production release preflight, the PR migration dry-run, and `apps/leaderboard/src/__tests__/release-config.test.js`.

Intentional exclusions: Contract migrations are not silently accepted by the automatic pre-deploy path. They require a later release whose deployed and rollback versions no longer depend on the retired contract.

## MEM-001 — Membership Requires Deliberate or Qualifying Action

Name: Canonical Viewer Membership creation boundary

Scope: Viewer Account authentication, public creator-site reads, global `/me`, explicit Join, free code-drop Claims, and provider-signed Kick credit grants.

Property: `site_viewers` may be created only by the canonical authenticated Join mutation or atomically with a successfully committed approved safe action. Anonymous reads, authenticated passive reads, generic OAuth, unavailable/failed/rejected/rate-limited actions, and replays never create Membership. Join is site-bound, Viewer-session-bound, CSRF/origin protected, rate-limited, idempotent, and never sets `last_active_at`.

Why it matters: Membership drives viewer product truth, Wave I New members, creator operations, and future viewer expansion. Passive or replay-created rows corrupt all four.

Source of truth: `apps/leaderboard/src/viewer-membership.js`, `apps/leaderboard/src/site-data.js`, `apps/leaderboard/src/handlers/viewer-auth.js`, `apps/leaderboard/src/handlers/events.js`, and `packages/shared/src/kick-credits.ts`.

How coverage is derived: search all production `INSERT INTO site_viewers` / upsert callers, then exercise passive reads, generic and explicit OAuth, target substitution, Join replay, two-community isolation, and safe-action success/failure paths.

Named enforcement/test: `apps/leaderboard/src/__tests__/viewer-membership.test.js`, `site-data.test.js`, `kick-oauth-state.test.js`, `events-raffles-drops.test.js`, and `credits-lifecycle.test.js`.

Intentional exclusions: restricted legacy Games/wagering systems are not redesigned or adopted as Membership-creation examples. Reward redemption requires an existing Membership because credits cannot exist without one.

## MEM-002 — Presence and Billable Activity Stay Separate

Name: Viewer presence/activity separation

Scope: `site_viewers.last_seen_at`, `site_viewers.last_active_at`, active-viewer billing usage, and Wave I Membership counts.

Property: A passive read may throttle-update `last_seen_at` only for an existing Membership. Explicit Join sets neither presence nor activity. Only a newly committed qualifying safe action advances `last_active_at`; failed, rejected, rate-limited, anonymous, passive, and idempotent replay paths do not.

Why it matters: presence is not billable engagement, and Membership creation is not qualifying activity.

Source of truth: `apps/leaderboard/src/site-data.js`, `packages/shared/src/plan-usage.ts`, `apps/leaderboard/src/handlers/events.js`, and `packages/shared/src/kick-credits.ts`.

Named enforcement/test: `apps/leaderboard/src/__tests__/site-data.test.js`, `events-raffles-drops.test.js`, `credits-lifecycle.test.js`, and the existing billing/plan-usage suites.

Intentional exclusions: historical `last_active_at` provenance is not rewritten because the source caller cannot be reconstructed safely.

## MEM-003 — Membership History Requires Exact Safe Ownership

Name: Viewer Membership history isolation and evidence boundary

Scope: creator-scoped My Community Participation and Claims on apex and custom domains.

Property: Participation may read only successfully persisted free code-drop Claims whose `site_id`, canonical `viewer_id`, and exact `site_viewer_id` all match the current request, excluding system Viewers and every restricted or inferred source. Claims must reuse the canonical Wave G adapter, use audit events rather than `updated_at` for terminal timestamps, omit internal identifiers/private actor data, and remain bounded. Non-members receive no history reads. Recognition remains absent until a safe persisted selected-site source has explicit Viewer/Membership linkage.

Why it matters: a cross-site, cross-account, inferred, or fabricated history entry would turn the Viewer Account into an identity/privacy failure rather than a persistent membership record.

Source of truth: `apps/leaderboard/src/site-data.js`, `apps/leaderboard/src/handlers/claims.js`, `apps/leaderboard/src/site-routes.js`, and `packages/shared/src/site-render.ts`.

Named enforcement/test: `apps/leaderboard/src/__tests__/viewer-participation.test.js`, `claims.test.js`, `site-data.test.js`, `site-routes.test.js`, `viewer-rewards-credits.test.js`, `viewer-membership.test.js`, and `viewer-privacy-boundary.test.js`.

Intentional exclusions: leaderboard/archive/Hall-of-Fame names, tournament operations, Reviews, daily quests, provider event payloads, and restricted legacy Games/wagering/chance systems are not Recognition or Participation evidence.

## AUT-001 — Only Explicit Safe Activity Kinds Are Automatable

Name: Server-owned automation allowlist

Scope: template APIs, schedule APIs, due-job queries, and scheduled execution.

Property: Only the explicit `safe_code_drop` kind may enter Automation. A client-supplied type can never select a handler dynamically.

Why it matters: a generic type/handler bridge could make unattended restricted behavior reachable through API manipulation.

Source of truth: `apps/leaderboard/src/code-drop-service.js`, `apps/leaderboard/src/handlers/activity-automation.js`, `apps/leaderboard/src/automation-scheduler.js`, and the Wave K schema checks.

Named enforcement/test: `apps/leaderboard/src/__tests__/activity-automation.test.js` and `activity-automation-home.test.js`.

Intentional exclusions: Games, wagering, stakes, predictions, paid chance, raffles, tournament operations, payout, settlement, Telegram, Discord delivery, and generic Communication.

## AUT-002 — One Occurrence Creates At Most One Activity

Name: Durable scheduled-Activity idempotency

Scope: duplicate cron delivery, retry, concurrent Worker execution, and execution/cancellation races.

Property: One `(schedule_id, occurrence_at)` may create at most one `code_drops` Activity. The guarantee must hold under real concurrent Postgres transactions, not a check-then-insert convention.

Why it matters: unattended duplicate rewards corrupt creator intent and viewer fairness.

Source of truth: `activity_schedule_occurrences` uniqueness, `code_drops.automation_occurrence_id` uniqueness, and the locked transaction in `apps/leaderboard/src/automation-scheduler.js`.

Named enforcement/test: `apps/leaderboard/src/__tests__/activity-automation.test.js`, `activity-automation-postgres.test.js`, and the `wave-k-safe-activity-automation` isolated E2E scenario.

Intentional exclusions: different intended recurrence instants deliberately create distinct Activities.

## AUT-003 — Manual and Automated Creation Share One Domain Boundary

Name: Canonical free code-drop creation parity

Scope: manual Activity creation, template validation, schedule revalidation, and executor creation.

Property: Manual and scheduled free code drops use the same validation and persistence service. Templates and schedules cannot maintain divergent validators or creation behavior.

Why it matters: two creation paths would drift on reward limits, expiry, secret handling, and viewer history.

Source of truth: `apps/leaderboard/src/code-drop-service.js` and `apps/leaderboard/src/handlers/events.js`.

Named enforcement/test: `apps/leaderboard/src/__tests__/activity-automation.test.js`, `events-raffles-drops.test.js`, and `activities-foundation.test.js`.

Intentional exclusions: a Template is inert configuration and is not an Activity instance.

## AUT-004 — Invalid Execution Context Fails Closed

Name: Scheduled execution reauthorization

Scope: cancelled schedules, site lifecycle, creator lifecycle, Moderator membership, and effective owner entitlement.

Property: Cancelled, unsupported, invalid-site, draft/unpublished, suspended-owner/creator, removed-Moderator, or entitlement-ineligible schedules cannot create an Activity. Authorization is rechecked at execution, not inherited indefinitely from the browser session that scheduled it.

Why it matters: unattended execution must not outlive the authority or site state that made it legitimate.

Source of truth: `apps/leaderboard/src/automation-scheduler.js`, canonical Team capabilities, and shared plan metadata.

Named enforcement/test: `apps/leaderboard/src/__tests__/activity-automation.test.js` and `activity-automation-postgres.test.js`.

Intentional exclusions: a short platform delay within the documented six-hour window is not invalid context by itself.

## AUT-005 — Restricted Legacy Cannot Enter Automation

Name: Restricted workflow isolation from scheduled execution

Scope: APIs, persistence constraints, executor dispatch, Home, audit, and creator UI.

Property: Restricted legacy mechanics cannot be represented, dispatched, or rendered as Wave K automation. The scheduler has no generic handler registry or arbitrary payload dispatch.

Why it matters: Automation is not permission to redesign or run restricted financial/chance mechanics unattended.

Source of truth: the `safe_code_drop` schema constraints and explicit conditionals in the Wave K handler/executor.

Named enforcement/test: `apps/leaderboard/src/__tests__/activity-automation.test.js`, `activity-automation-home.test.js`, and repository restricted-isolation suites.

Intentional exclusions: legacy systems and their own operational scheduler behavior remain unchanged and separately owned.

## AUT-006 — Downgrade Preserves Configuration Without Releasing Backlog

Name: Safe automation entitlement lifecycle

Scope: Free/Pro/Team transitions, due execution, recurrence advancement, and rescheduling.

Property: Plan downgrade preserves templates and schedules, blocks new paid automation, and pauses due execution. Restored entitlement cannot fire missed work until an authorized creator explicitly chooses a new future time; recurrence advances to the first future fixed UTC interval rather than generating historical backlog.

Why it matters: deleting creator configuration loses durable work, while silently releasing old scheduled rewards violates current intent.

Source of truth: `packages/shared/src/plans.ts`, `apps/leaderboard/src/handlers/activity-automation.js`, and `apps/leaderboard/src/automation-scheduler.js`.

Named enforcement/test: `apps/leaderboard/src/__tests__/activity-automation.test.js` and `activity-automation-home.test.js`.

Intentional exclusions: deleting/cancelling configuration remains an explicit creator action; manual Free Activities and viewer rights are unaffected.

## VER-001 — Claims Cannot Exceed Evidence

Completion claims may not be broader than the verified scope.

## VER-002 — Permanent Claims Require Named Enforcement

Words such as `permanent`, `permanently fixed`, `cannot regress`, `fully prevented`, or `guaranteed across the app` require a named invariant test or automated gate that would fail if the behavior returned.

## VER-003 — Intentional Exclusions Are Explicit

Any excluded route, package, API, permission, feature, or state must be named and justified.

Silent exclusions are not coverage.

## REQ-001 — Material Ambiguity Is Resolved Against Evidence

When a requirement has multiple materially different interpretations:

```text
inspect repository structure
→ inspect rendered/product behavior
→ compare interpretations
→ choose the interpretation most consistent with existing architecture
→ record it
→ ask only if evidence cannot resolve it
```

Do not silently choose the easiest implementation.
