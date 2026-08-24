---
name: data-table-ux
description: Designs tables, lists, filtering, sorting, search, pagination, selection, bulk actions, row actions, density, and responsive behavior for data-heavy product interfaces.
metadata: {"category":"ui-ux","priority":"high"}
---

# Data Table / List UX

First ask whether users actually need comparison across repeated records. If not, a table may be wrong.

Columns:
- prioritize decision-relevant fields,
- avoid exposing every backend field,
- align numbers for comparison,
- use readable identifiers,
- make status understandable without color alone.

Controls:
- search for lookup,
- filters for known dimensions,
- sorting for comparison,
- pagination/virtualization based on scale,
- bulk actions only when multi-selection creates real value.

Row actions:
Keep common actions discoverable. Do not hide everything in overflow menus.

States:
loading, no records, no search results, filtered empty, error, partial data.

Responsive:
Do not squeeze every column. Prioritize, stack, transform, or deliberately scroll based on the task.
