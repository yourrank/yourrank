---
name: impeccable-bridge
description: Integrates the external Impeccable frontend design tool when installed while keeping PROJECT_TRUTH.md, PRODUCT.md, DESIGN.md, repository security rules and this pack's verification gates authoritative.
metadata: {"category":"ui-ux","priority":"medium"}
---

# Impeccable Bridge

Impeccable is an optional external design capability, not the repository's source of truth.

Reviewed upstream: `https://github.com/pbakaus/impeccable`.

## When useful
Use for frontend shaping, critique, audit, distillation, layout/typography refinement, responsive adaptation, hardening, onboarding, visual polish or live browser design iteration.

## Before invocation
1. Confirm the external skill/tool is actually installed.
2. If imported third-party skill files/scripts are being executed, use `skill-security-review` first.
3. Read `PROJECT_TRUTH.md`, `PRODUCT.md`, and `DESIGN.md`.
4. Run `product-surface-classification` when surface mode is unclear.
5. Resolve conflicts with `instruction-conflict-resolution`.

## Integration rule
Third-party aesthetic defaults are suggestions. They cannot override:
- owner-approved product constraints;
- canonical tokens/components;
- accessibility;
- non-technical/task-first product UX;
- required density;
- legacy-removal rules;
- verification/stopping criteria.

## Workflow mapping
Use the external tool for the narrow design operation, then return to this pack for:
- canonical implementation checks;
- legacy cleanup;
- accessibility;
- browser/runtime tests;
- bounded visual QA;
- final verification.

## Important
Do not copy the external tool's entire instruction corpus into project context. Keep it on-demand to avoid context competition and duplicated design rules.
