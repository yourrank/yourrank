# Stopping Criteria / Finish-Line Control

Every non-trivial task must have an explicit finish line before implementation begins.

## Task Contract

```text
Goal:
In scope:
Out of scope:
Acceptance criteria:
Required verification:
Stop condition:
```

The stop condition must describe what makes the current task complete, not what would make the entire repository perfect.

## New-Finding Classification

When implementation or verification discovers another issue, classify it before doing more work.

### A. BLOCKS CURRENT FINISH LINE — fix now

Fix now only when at least one is true:
1. it makes an acceptance criterion fail,
2. it is a regression introduced by the current change,
3. it makes the current implementation unsafe for the stated task,
4. it invalidates evidence required to claim the task works,
5. it prevents required build/test/runtime verification.

### B. CURRENT-CHANGE SAFETY — fix or block completion

Examples:
- current change bypasses authorization,
- current migration can lose existing user data,
- current code exposes a secret,
- current implementation can duplicate a destructive action.

This is not optional hardening. It is part of making the requested change safe.

### C. ADJACENT / PRE-EXISTING / OPTIONAL — defer

Examples:
- unrelated old test weakness,
- nice-to-have refactor,
- extra monitoring,
- speculative optimization,
- cleanup outside the affected path,
- public-SaaS hardening for a private personal tool,
- extra device/browser coverage beyond the agreed finish line.

Record it as deferred work and do not create a new phase automatically.

## No Automatic New Phases

Do not invent:
```text
Phase 6 — extra hardening
Phase 7 — harden the hardening
Phase 8 — production readiness
Phase 9 — future-proofing
```
unless required by the current finish line or explicitly requested.

Verification may reveal blockers. Verification does not grant permission to enlarge the product scope.

## Completion Rule

Once all are true:
```text
acceptance criteria pass
+ required verification passes
+ no regression introduced by this change remains
+ no safety defect introduced by this change remains
```
the task is DONE.

Then:
1. stop modifying code,
2. report exact verification evidence,
3. list optional findings as deferred,
4. do not create a new hardening phase,
5. do not move the finish line.

## Preserve Product Context

Engineering rigor must match the real product context.

Do not silently transform:
```text
personal/local tool
```
into:
```text
public multi-tenant SaaS
```
and then block completion on requirements that belong only to the second system.

Still apply correctness, data safety, and security appropriate to the real project.
