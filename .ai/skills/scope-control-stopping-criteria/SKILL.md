---
name: scope-control-stopping-criteria
description: Prevents scope creep, recursive hardening loops, goal drift, verification rabbit holes, and endless task expansion by defining a finish line and classifying newly discovered work as blocker, current-change safety work, or deferred debt.
metadata: {"category":"autonomy-control","priority":"critical"}
---

# Scope Control and Stopping Criteria

## Start with a task contract
```text
Goal:
In scope:
Out of scope:
Acceptance criteria:
Required verification:
Stop condition:
```

## New finding decision
1. Does it block an acceptance criterion? Fix now.
2. Was it introduced by the current change and is it a regression? Fix now.
3. Does it make the current change unsafe? Fix or block completion.
4. Does it invalidate required verification? Fix enough to restore valid evidence.
5. Otherwise record it as deferred/optional and DO NOT create a new phase.

## Product-context check
Match hardening to the real project: personal/local, internal, public, multi-user, multi-tenant, regulated/high-risk.
Do not escalate requirements by imagining a different product.

## Stop rule
When acceptance criteria and required verification pass, and current-change regressions/safety blockers are resolved, the task is DONE.

## Anti-rationalizations
Reject:
- "While I'm here..."
- "For completeness..."
- "To make it production-ready..." when production readiness is not the task
- "One more hardening pass..."
- "This could be improved further..."

Possible improvement is not the same as required work.
