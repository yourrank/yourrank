# Verification Standard

## Level 0 — Documentation Only
- inspect diff,
- verify references/format.

## Level 1 — Small Local Change
- targeted behavior check,
- typecheck/lint when available,
- diff review.

## Level 2 — Feature/UI/API Change
- relevant tests,
- typecheck,
- lint,
- build,
- happy path,
- important failure states,
- regression check.

## Level 3 — Shared Architecture
- targeted + broader tests,
- typecheck/lint/build,
- dependent flows,
- final diff review,
- canonical source-of-truth check.

## Level 4 — High Risk
For auth, permissions, billing, migrations, deletion, secrets, user data, production config:
- automated checks,
- failure-path validation,
- existing-user/data compatibility,
- authorization validation,
- rollback/recovery consideration,
- destructive-operation review,
- explicit unverified areas.

---

# Mandatory Final Checks

## Canonicalization
- [ ] Edited implementation is actually active.
- [ ] No accidental `v2/new/final/backup/copy` implementation was introduced.
- [ ] No duplicate state/service/component now represents the same concept.
- [ ] Obsolete implementation was removed if replacement was completed.

## Stack
- [ ] Version-sensitive code matches installed versions.
- [ ] No deprecated API was introduced unknowingly.
- [ ] No unnecessary dependency/framework upgrade.

## Behavior
- [ ] Requested behavior works.
- [ ] Related behavior still works.
- [ ] Important failure path is handled.
- [ ] No fake/mock substitute remains.

## UI/UX
- [ ] Primary action/flow works.
- [ ] Loading/empty/error/success states considered.
- [ ] Responsive behavior checked where relevant.
- [ ] Long/realistic content considered.
- [ ] Keyboard/focus/accessibility considered.
- [ ] Existing design system remains canonical.

## Backend/Data
- [ ] Server validation.
- [ ] Authorization/ownership.
- [ ] Existing data compatibility.
- [ ] Duplicate requests/races considered.
- [ ] Destructive changes intentional and recoverable.

## Tests
- [ ] Tests validate behavior.
- [ ] Existing tests were not weakened merely to pass.
- [ ] Mocks do not hide the critical integration.

## Evidence Vocabulary

Use these accurately:

```text
Verified = executed or directly checked.
Reasoned = inspected and concluded, but not executed.
Not verified = could not validate.
```

## Generated / Workspace / Flag Checks

- [ ] No generated file was manually patched when a source generator exists.
- [ ] Correct workspace/package boundary was used.
- [ ] Authoritative lockfile/package manager was respected.
- [ ] Temporary feature flags have an owner/removal condition.
- [ ] Completed migrations do not leave both old and new implementations active.
- [ ] New environment variables/config are validated and documented.

## Invariant / Coverage Verification

For class-wide claims:

- [ ] The invariant/property is stated.
- [ ] Scope source is named.
- [ ] Coverage is derived from the canonical system when possible.
- [ ] Dynamic patterns use representative fixtures.
- [ ] Intentional exclusions are explicit.
- [ ] A named test/gate enforces the invariant where practical.
- [ ] Completion wording matches the actual evidence.

### Coverage report

```text
Coverage source:
Defined scope:
Verified:
Intentional exclusions:
Not verified:
Invariant enforcement:
```

If this information is unavailable, do not make an application-wide claim.

## Verification Is Not an Infinite Work Generator

Verification exists to determine whether the agreed change works.

### Fix now
Only when a finding:
- fails current acceptance criteria,
- is a regression introduced by this change,
- makes the current change unsafe,
- invalidates required verification.

### Defer
When it is:
- unrelated pre-existing debt,
- speculative hardening,
- optional optimization,
- additional polish,
- broader production-readiness work outside current product scope.

Before creating another phase, ask:
```text
Does this finding prevent honest completion of the current task?
```
If no, record it, report it, and stop expanding scope.

## v7 UI Replacement Proof

When the task replaces an old design/system:
- [ ] Canonical target is named.
- [ ] Legacy routes/components/styles/providers/state/flags are enumerated.
- [ ] Consumers were derived from route/import/registry evidence.
- [ ] No unrequired legacy implementation remains reachable.
- [ ] Relevant alternate data/permission/responsive states were checked.
- [ ] Visual baselines were not silently rewritten to bless a regression.
- [ ] `DESIGN.md` and `PROJECT_TRUTH.md` match the post-migration reality.

## v7 Adversarial Closure

For broad/high-risk claims:
- [ ] A reviewer attempted to falsify completion.
- [ ] Unproven assumptions were surfaced.
- [ ] Findings were classified as blocker, current-change safety/regression, or deferred.
- [ ] Completion wording does not exceed verified scope.

## v7 Cost / Loop Check

- [ ] No expensive check was rerun without a scope-changing reason when valid evidence already existed.
- [ ] No third speculative patch followed two failed attempts without root-cause reset.
- [ ] Optional visual polish stopped after required verification passed.
