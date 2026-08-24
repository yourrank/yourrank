---
name: repo-truth-bootstrap
description: Builds or repairs PROJECT_TRUTH.md by separating owner-approved product intent from repository evidence, legacy behavior, and unresolved unknowns before broad or risky engineering work.
metadata: {"category":"governance","priority":"critical"}
---

# Repository Truth Bootstrap

## Purpose
Create a compact authority map so the agent does not treat accidental legacy code as the specification.

## Trigger
Use when:
- a repository is being brought under this pack for the first time;
- major behavior/design conflicts exist;
- multiple implementations disagree;
- the user says the current code/design is not trustworthy;
- broad refactoring or redesign depends on knowing what is canonical.

## Procedure
1. Read explicit owner/product requirements first.
2. Inspect routes, manifests, schemas, tests, shared components, deployment config and runtime evidence.
3. Separate findings into:
   - owner-approved truth,
   - verified current implementation,
   - legacy/deprecated behavior,
   - unresolved product decision.
4. Populate `PROJECT_TRUTH.md` with concise canonical paths and invariants.
5. Never promote a repo pattern to owner-approved truth merely because it is common.
6. Every deprecated entry must name a concrete path/identifier.
7. If a fact is discoverable, investigate it rather than asking.
8. If a fact is a genuine product choice, mark it `OWNER-REVIEW-REQUIRED` instead of guessing.

## Exit criteria
An unfamiliar agent can identify the intended product, canonical architecture/UI, forbidden legacy paths, and unresolved decisions without reading the whole history.
