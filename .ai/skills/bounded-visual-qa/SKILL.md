---
name: bounded-visual-qa
description: Runs visual verification in a bounded two-pass cycle so UI work gets real rendered inspection without endless micro-polish loops that consume tokens and introduce drift.
metadata: {"category":"verification","priority":"high"}
---

# Bounded Visual QA

## Goal
Inspect the real rendered result without turning verification into infinite redesign.

## Cycle
### Pass 1: batch inspection
After the implementation is complete enough to evaluate:
- render desktop and narrow/mobile together;
- include normal + relevant empty/error/loading/permission/dense states;
- inspect hierarchy, clipping, overflow, spacing, focus, interactions and legacy residue;
- collect all confirmed defects before editing.

### Fix batch
Fix the confirmed defects together at their owning layer.

### Pass 2: confirmation
Re-render the affected states once. Confirm defects are gone and no current-change regressions appeared.

## Stop rule
If acceptance and required verification pass after confirmation, stop polishing.

Additional iteration is allowed only for:
- a remaining acceptance failure;
- a regression introduced by the current change;
- a safety/accessibility blocker;
- a newly proven root cause invalidating the prior implementation.

Do not spend repeated rounds nudging pixels because the agent can imagine further aesthetic variations.
