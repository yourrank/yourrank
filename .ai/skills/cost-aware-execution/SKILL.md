---
name: cost-aware-execution
description: Controls AI token and rework waste by batching investigation, preventing repeated speculative patches, reusing verified evidence and stopping when acceptance criteria are satisfied without trading away correctness.
metadata: {"category":"workflow","priority":"high"}
---

# Cost-Aware Execution

Optimize for accepted outcomes per unit of work, not for cheap-looking individual diffs.

## Cost rules
- inspect broadly once before editing instead of rediscovering the same area every attempt;
- batch searches and related verification;
- persist durable findings in project docs, not conversation-only memory;
- do not rerun expensive checks that remain valid for unchanged scope;
- run narrow checks during implementation, full required gates at the finish line;
- fix a batch of confirmed visual defects, not one pixel per turn;
- do not add optional polish after stop criteria pass;
- do not reduce testing/security to save tokens.

## Rework signals
Escalate when:
- the same acceptance criterion fails after two implementation attempts;
- new patches keep adding conditions/overrides around the same ownership boundary;
- diff size grows while root cause remains uncertain;
- the agent is reopening previously “fixed” code without new evidence.

Then use `failed-attempt-recovery` rather than patching again.

## Metric mindset
Track useful project-level signals when practical: reopened tasks, revert rate, repeated bug class, duplicate implementations, accepted-task cost and verification cost. Lines changed are not a quality metric.
