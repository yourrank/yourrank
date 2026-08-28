# START HERE — v7 Pro-Max

Put this folder at the repository root and expose `AGENTS.md` to the coding agent.

## One-time repository bootstrap

The agent should inspect the repository and populate/review:

1. `PROJECT_TRUTH.md`
2. `../docs/YOURRANK_PRODUCT_ARCHITECTURE.md` for TARGET product direction
3. `PRODUCT.md`
4. `PROJECT_RULES.md`
5. `PROJECT_STATE.md` for CURRENT implementation state
6. `../ARCHITECTURE.md` plus code/tests for CURRENT runtime/deployment truth
7. `DESIGN.md` for UI projects
8. `.ai/FORBIDDEN_PATTERNS.txt` only with concrete proven legacy identifiers

Do not ask the user for stack facts the repository can prove. Do not let the agent invent product decisions that only the owner can make.

## For a normal task

Start with `skills/using-skills/SKILL.md`. Load only the selected skills.

## If UI keeps showing old design

Use the route:

```text
ui-root-cause-forensics
→ change-impact-map
→ canonical-implementation
→ design-migration-cleanup if replacement is intended
→ browser/runtime verification
→ bounded-visual-qa
→ adversarial-verification for broad claims
```

Do not create another dashboard/page/theme to hide the old one.

## If the agent fails twice

Use `failed-attempt-recovery` before a third implementation attempt.

## Impeccable

Use `impeccable-bridge` only when the external tool is installed and useful. Project product/design constraints remain authoritative.
