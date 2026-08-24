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
