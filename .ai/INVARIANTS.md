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
