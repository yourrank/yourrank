---
name: failed-attempt-recovery
description: Resets the debugging approach after repeated failed implementations of the same acceptance criterion, preventing a third speculative patch from compounding the wrong root-cause model.
metadata: {"category":"workflow","priority":"critical"}
---

# Failed Attempt Recovery

Trigger when the same acceptance criterion fails after two materially different implementation attempts, or when repeated patches keep accumulating in the same area without explaining the behavior.

## Reset protocol
1. Stop editing.
2. Preserve evidence from failed attempts: symptoms, commands, traces and why each approach failed.
3. Return to the last known-good baseline/commit when safely possible, or isolate the accumulated diff for analysis.
4. Re-run `codebase-exploration`, `change-impact-map`, and relevant root-cause forensics.
5. Challenge the original assumptions about ownership, state, environment, route and acceptance oracle.
6. Search for competing implementations/legacy branches again.
7. Define a new root-cause statement that explains why the previous attempts failed.
8. Only then implement again.

## Prohibited
- third speculative patch because it is cheaper than re-investigation;
- arbitrary delays/retries/overrides;
- declaring the acceptance criterion “flaky” without evidence;
- weakening the test/requirement.

This is a workflow stop-loss, not permission to discard user work or reset destructive state without safeguards.
