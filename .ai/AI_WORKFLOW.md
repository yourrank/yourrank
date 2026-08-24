# Default Coding Workflow

Scale depth to risk. A typo does not need an architecture review. A migration does.

## Phase 1 — Understand Outcome

Record internally:

```text
Current behavior:
Desired behavior:
User/product goal:
Likely affected area:
Risk:
Verification needed:
```

Separate the desired outcome from the user's suggested implementation.

## Phase 2 — Inspect Repository

Before asking questions, discover what the repository can tell you.

Inspect:
- manifests/lockfiles,
- config,
- active routes/entry points,
- relevant components/services,
- state ownership,
- tests,
- installed versions,
- existing design system,
- related business logic.

## Phase 3 — Establish Canonical Implementation

Search for similarly named/duplicate implementations.

Determine:
- which file is actually imported,
- which route is production,
- which state is authoritative,
- which UI library/tokens are canonical,
- which files are legacy/dead.

Do not edit until you know what is active for important flows.

## Phase 4 — Diagnose / Design

For bugs:
1. reproduce/reconstruct,
2. find first incorrect state,
3. identify root cause,
4. choose correct ownership layer.

For features:
1. map user flow,
2. map data,
3. map permissions,
4. map states/errors,
5. check compatibility.

For redesign:
1. identify canonical route,
2. identify shared components,
3. identify design tokens,
4. identify duplicated UI,
5. plan in-place repair or controlled migration.

## Phase 5 — Choose Change

Prefer:

```text
smallest correct change
+ one source of truth
+ clean integration
+ preserved behavior
+ clear verification
```

If replacement is required, use the replacement protocol.

## Phase 6 — Implement

- reuse canonical systems,
- follow real installed stack conventions,
- handle important failures,
- preserve data and permissions,
- avoid unrelated cleanup,
- remove code made obsolete by this change,
- do not fake unimplemented behavior.

## Phase 7 — Verify

Run relevant:
- targeted tests,
- typecheck,
- lint,
- broader tests,
- build,
- runtime/manual flow,
- logs/console,
- responsive/accessibility checks,
- migration/permission checks.

## Phase 8 — Final Diff Review

Search for:
- accidental V2/new/final files,
- dead old implementations,
- TODO/FIXME,
- mock/placeholder data,
- temporary logs,
- duplicate state,
- new dependencies,
- stale comments,
- weakened tests,
- unrelated changes.

## Phase 9 — Report

```text
Changed
Verified
Not verified
Risks / remaining issues
```

Never invent verification.

## Phase 0 — Define the Finish Line

Before Phase 1 for non-trivial work, establish:
```text
Goal:
In scope:
Out of scope:
Acceptance criteria:
Required verification:
Stop condition:
```

During later phases, new findings do not automatically change this contract.

Classify findings using `STOPPING_CRITERIA.md`:
```text
BLOCKER
CURRENT-CHANGE SAFETY
DEFERRED
```
Only the first two categories may expand implementation automatically.

After required verification passes, perform one closure review. If criteria, regressions, safety, and evidence are clean, stop.

## v7 Pro-Max Workflow Extensions

### Before Phase 1 — Authority / Truth
For broad, contested, or inherited projects, establish or review:
- `PROJECT_TRUTH.md`
- `PRODUCT.md`
- `DESIGN.md` for UI work

If instructions conflict, use `instruction-conflict-resolution` before implementation.

### Before Phase 4 — Impact Map
For shared, multi-route, cross-layer, previously patched, or migration work, use `change-impact-map` to enumerate owners, consumers, legacy paths, tests and deletion scope.

### UI bug / old design path
Use `ui-root-cause-forensics` before visual editing. Include route, layout, state, styles, persisted preferences/cache and responsive/permission branches when relevant.

### Redesign replacement
Use `design-migration-cleanup`. The new UI existing is not proof that the old UI is gone.

### Failed-attempt stop-loss
After two implementation attempts fail the same acceptance criterion, stop Phase 6 and use `failed-attempt-recovery` before another edit.

### Visual verification
Use `bounded-visual-qa`: one batched inspection, one batched fix, at most one confirmation round unless a real acceptance/regression/safety failure remains.

### High-confidence completion
For broad migrations, recurring bug classes, security/data changes or expensive work, use `adversarial-verification` before the final report.
