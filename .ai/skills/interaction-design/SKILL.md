---
name: interaction-design
description: Chooses and specifies interaction patterns such as inline editing, drawers, dialogs, pages, popovers, tabs, menus, undo, confirmations, and multi-step flows based on scope, reversibility, frequency, focus, and context.
metadata: {"category":"ui-ux","priority":"high"}
---

# Interaction Design

Choose patterns based on:
- task complexity,
- context preservation,
- reversibility,
- frequency,
- deep-link/history needs,
- mobile behavior,
- focus management,
- async behavior.

Typical fit:
- inline edit: small contextual change
- popover: lightweight transient choice/detail
- menu: secondary actions
- dialog: short focused interruption
- drawer: contextual work with background context
- full page: complex/deep-linkable/multi-step work
- toast: outcome/status, not complex decisions
- undo: reversible destructive action when practical
- confirmation: consequential/irreversible action

Avoid nested dialogs, modal megaflows, hover-only essentials, and hiding primary actions in overflow menus.

Specify:
trigger → state → feedback → completion → cancel/recovery → focus.
