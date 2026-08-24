---
name: ui-review
description: Reviews product flow, UI states, consistency, layout, accessibility, and technical integration after interface changes. Use after building or redesigning UI.
---

# UI/UX Review

Check:
- primary action,
- navigation/dead ends,
- feedback,
- permissions,
- loading/empty/error/success/disabled,
- canonical components/tokens,
- no parallel UI systems,
- responsive layout,
- realistic content,
- semantics/keyboard/focus/labels/contrast,
- no fake data replacing missing behavior,
- no duplicate state or legacy page left active.

## v7 review additions
- compare rendered states against `PRODUCT.md` and `DESIGN.md`;
- verify no deprecated UI path remains reachable when replacement was requested;
- distinguish root-cause resolution from a screenshot-only patch;
- use `bounded-visual-qa` to avoid open-ended polish loops.
