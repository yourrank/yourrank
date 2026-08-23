---
name: frontend-ui-ux
description: Implements or redesigns user interfaces around user goals while preserving canonical routes, components, design systems, responsive behavior, states, and accessibility.
---

# Frontend UI/UX

1. Identify primary user/task.
2. Identify active route/component tree.
3. Identify canonical tokens/components.
4. Identify duplicate/legacy UI.
5. Distinguish inspiration vs exact reproduction.
6. Define hierarchy.
7. Hide technical concepts users do not need.
8. Cover loading/empty/error/success/disabled/unauthorized/partial states.
9. Test realistic content.
10. Adapt for mobile.
11. Check keyboard/focus/accessibility.
12. Reuse or repair canonical components.
13. Remove obsolete UI after migration.

Never use `DashboardV2` as a redesign strategy.

## Surface Mode

Before implementation classify the surface:

- Product/workspace: optimize utility, density, status and repeated use.
- Data/dashboard: optimize scanning, comparison, filters, tables and drill-down.
- Marketing/brand: optimize comprehension, narrative, differentiation and conversion.

Do not apply one mode's visual defaults to another.

For deeper product behavior use:
- `dashboard-product-ui`
- `interaction-design`
- `information-architecture-navigation`

For visual craft use:
- `visual-composition`
- `design-language-system`

## v7 preflight
When the wrong/old design appears, do not start with visual edits. Run `ui-root-cause-forensics` first.
For complete redesign replacement, finish with `design-migration-cleanup` and `bounded-visual-qa`.
For AI-template smells, use `ai-slop-detection` as a review aid, not a universal style ban.
