---
name: adversarial-verification
description: Reviews a completed change as an independent falsification exercise, searching for unproven assumptions, reachable legacy paths, weakened tests, security gaps and neighboring regressions instead of defending the implementation.
metadata: {"category":"verification","priority":"critical"}
---

# Adversarial Verification

Prefer a reviewer/agent context that did not author the implementation when available.

## Mindset
The claim “this task is complete” is a hypothesis to falsify.

## Questions
- What acceptance statement lacks executable evidence?
- What assumption came from model intuition rather than repo/runtime evidence?
- Is any old route/component/style/state still reachable?
- Did the implementation satisfy the test instead of the real requirement?
- Were assertions, snapshots or fixtures weakened/rewritten?
- Is there duplicated ownership or compatibility layering?
- Could auth/authz/data/concurrency behavior differ in a neighboring state?
- Did a dependency/config/environment change slip in?
- Does UI evidence cover alternate, responsive and permission/error states relevant to the change?
- Does the completion claim exceed verified scope?

## Output
Classify findings as:
- blocker;
- current-change regression/safety;
- deferred/pre-existing.

Only the first two reopen implementation under normal stopping rules.
