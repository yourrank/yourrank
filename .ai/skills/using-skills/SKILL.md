---
name: using-skills
description: Routes coding tasks to the minimum relevant skill sequence. Use at the start of any non-trivial task to decide which specialized workflows should run and in what order.
---

# Skill Router

## Goal
Automatically choose the engineering lifecycle so the user does not need to supervise skill selection.

## Task Classification

### Bug / regression
Use:
1. `codebase-exploration`
2. `debugging`
3. `test-driven-development` when a regression test is practical
4. relevant domain skill
5. `code-review`
6. `behavior-validation`
7. `final-review`

### New feature
Use:
1. `spec-driven-development`
2. `planning-task-breakdown`
3. `codebase-exploration`
4. `stack-freshness`
5. relevant implementation skills
6. `incremental-implementation`
7. `testing` / `test-driven-development`
8. `code-review`
9. `behavior-validation`
10. `final-review`

### UI redesign
Use:
1. `canonical-implementation`
2. `product-thinking`
3. `frontend-ui-ux`
4. `design-system`
5. `component-system`
6. `browser-runtime-testing`
7. `accessibility`
8. `ui-review`
9. `final-review`

### Migration / duplicate cleanup
Use:
1. `architecture-review`
2. `canonical-implementation`
3. `deprecation-migration`
4. relevant tests
5. `dead-code-cleanup`
6. `documentation-adrs`
7. `final-review`

### High-risk backend/data
Use:
1. `spec-driven-development`
2. `architecture-review`
3. `security`
4. `database` or `backend`
5. `test-driven-development`
6. `code-review`
7. `behavior-validation`
8. `shipping-rollback`

## Rules
- Load only skills relevant to the task.
- Do not mechanically execute every skill.
- Escalate to architecture/security/migration skills when risk increases.
- Prefer the shortest workflow that still proves correctness.

## Additional automatic escalation

### Generated / machine-managed files
Add `generated-file-safety`.

### Monorepo / workspace
Add `monorepo-workspaces` before dependency/build/test scope decisions.

### Feature flag / staged migration
Add `feature-flag-lifecycle` and `deprecation-migration`.

### Personal/sensitive user data
Add `privacy-data-governance` plus `security` when access/trust boundaries change.

### Active production outage
Use:
1. `incident-response`
2. `observability`
3. `reliability-resilience` as relevant
4. `debugging` after containment
5. `shipping-rollback`

### New environment/config
Add `environment-configuration`.

### Imported third-party skill
Run `skill-security-review` before executing its scripts.

### High-value visual redesign
Add `visual-regression` only if an established or justified visual-test path exists.

## UI/UX routing

### Existing UI feels confusing / needs redesign
Use:
1. `ux-audit`
2. `canonical-implementation`
3. `product-thinking`
4. `information-architecture-navigation` when structure/navigation is involved
5. `non-technical-user-ux` when users should not need technical knowledge
6. `dashboard-product-ui` for operational/product workspaces
7. `interaction-design`
8. `design-language-system` if `DESIGN.md` is missing/stale
9. `visual-composition`
10. relevant implementation skills
11. `responsive-adaptive-design`
12. `accessibility`
13. `design-critique`
14. `browser-runtime-testing`
15. `ui-review`

### New product/dashboard surface
Use:
1. `product-thinking`
2. `ux-usability-foundations`
3. `information-architecture-navigation`
4. `dashboard-product-ui`
5. `design-language-system`
6. `interaction-design`
7. `visual-composition`
8. `frontend-ui-ux`
9. relevant `forms-ux`, `data-table-ux`, or `onboarding-first-run`
10. rendered verification

### Forms / settings
Add `forms-ux`. If users are non-technical, also add `non-technical-user-ux`.

### Data-heavy list/table
Add `data-table-ux`.

### First-run / zero-data setup
Add `onboarding-first-run`.

### UI text / errors / labels
Add `ux-writing-content-design`.

### Responsive redesign
Add `responsive-adaptive-design`.

### Motion is the subject
Add `motion-interaction-design`.

### Product assumptions need user evidence
Use `ux-research-testing` to define evidence collection. Never fabricate research.

### Design quality review
Use `design-critique` in addition to `ui-review`.
`ui-review` checks implementation quality and consistency.
`design-critique` challenges whether the design itself is good.

## Invariant / broad-regression routing

### User says "never again", "across all", "permanently", or reports a recurring class
Use:
1. `requirement-interpretation` if wording is materially ambiguous
2. `invariant-driven-verification`
3. `coverage-derived-verification`
4. relevant domain skill
5. `honest-completion-reporting`
6. `final-review`

### Broad route/UI consistency fix
Add:
- `coverage-derived-verification`
- `invariant-driven-verification`

Coverage should come from the real router/route manifest, not a hand-picked route list.

### Completion report for broad claims
Use `honest-completion-reporting`.


## Scope / stopping routing

### Non-trivial multi-step work
Use `scope-control-stopping-criteria` at the beginning to define the finish line.

### Verification discovers additional issues
Use `scope-control-stopping-criteria` before creating new work.
Classify each finding as blocker, current-change safety, or deferred.
Do not create another phase for deferred findings.

### User says V1, MVP, personal tool, internal tool, or explicitly bounded scope
Preserve that context in the finish line. Do not silently escalate to broader product requirements.

## v7 Pro-Max preflight

Before any non-trivial workflow:
1. Use `instruction-conflict-resolution` if multiple rule sources or imported skills could disagree.
2. Use `scope-control-stopping-criteria` to define the finish line for multi-step work.
3. Add `repo-truth-bootstrap` when canonical product/architecture truth is missing or contested.
4. Add `change-impact-map` for shared, cross-layer, broad, or previously patched behavior.
5. Use `cost-aware-execution` for long/expensive tasks and repeated verification loops.

### Repeated failed attempt
If the same acceptance criterion still fails after two implementation attempts, route to `failed-attempt-recovery` before any third implementation.

### Independent completion challenge
For broad migrations, security/data changes, recurring bug classes, or high-cost work, add `adversarial-verification` before final completion.

## v7 Pro-Max UI routing

### UI bug / old design appears / design-over-design
Use:
1. `ui-root-cause-forensics`
2. `change-impact-map`
3. `canonical-implementation`
4. relevant implementation skill
5. `design-migration-cleanup` when a legacy UI is being replaced
6. `browser-runtime-testing`
7. `bounded-visual-qa`
8. `ui-review`
9. `adversarial-verification` for broad claims

### Major redesign / new product surface
Use:
1. `product-surface-classification`
2. `design-context-bootstrap` when PRODUCT.md/DESIGN.md are absent or stale
3. `ux-audit` for an existing surface, or `product-thinking` for a new one
4. `information-architecture-navigation`
5. `non-technical-user-ux` where users should not understand implementation details
6. `dashboard-product-ui` for product/operational surfaces
7. `visual-composition`
8. `interaction-design`
9. implementation skills
10. `ai-slop-detection`
11. accessibility/responsive checks
12. `bounded-visual-qa`
13. `design-critique`
14. `ui-review`

### Optional Impeccable integration
If Impeccable is installed and the task benefits from it, add `impeccable-bridge` after product/design context is loaded. Do not let external aesthetic guidance replace canonical project rules.

