---
name: dashboard-product-ui
description: Designs dashboards, admin panels, settings, monitoring, and operational workspaces for scanability, information density, task completion, status visibility, and repeated daily use. Use for product UI behind login rather than marketing pages.
metadata: {"category":"ui-ux","priority":"high"}
---

# Dashboard / Product UI

A dashboard is not a collection of cards.

Optimize:
- scanability,
- status visibility,
- comparison,
- actionability,
- repeated use,
- sensible density,
- fast navigation.

Structure around:
- status,
- work queue,
- actions,
- analysis,
- configuration.

Use cards only when containment/grouping semantics justify them.
Prefer lists/tables when records need comparison.
Keep chrome calm.
Avoid oversized headings/empty space that push work below the fold.
Use metrics only when they help a decision.

Design first-run, partial setup, normal, dense, disconnected and degraded states.

Returning-user test:
Can an experienced user land here and act within seconds?

## Non-technical product guardrails
- Keep internal architecture, provider details and implementation jargon out of normal task flows unless the user must act on them.
- Prefer one clear primary action per current task; secondary/advanced controls recede or use progressive disclosure.
- Do not fill available screen area merely because it exists.
- Whitespace is useful, but excessive hero-like empty space is harmful when it pushes recurring work away.
- A visually exciting treatment is a regression if it makes a repeated task harder to understand.
