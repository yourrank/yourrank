---
name: forms-ux
description: Designs usable forms and settings flows with field grouping, labels, defaults, validation timing, error recovery, submission feedback, dependent fields, destructive settings, and progressive disclosure.
metadata: {"category":"ui-ux","priority":"high"}
---

# Forms UX

1. Group fields by user intent.
2. Order them by natural task sequence.
3. Keep labels persistent.
4. Make required/optional status clear.
5. Use safe defaults.
6. Hide rare advanced fields until needed.

Validation:
- avoid hostile first-keystroke error noise,
- show errors next to fields,
- make errors actionable,
- preserve input after failure,
- help users reach the first invalid field after submit.

Submission:
- prevent accidental duplicate submission while in flight,
- show progress and outcome,
- communicate autosave honestly,
- do not silently lose unsaved changes.

Settings:
- show current state,
- distinguish immediate vs save-required changes,
- warn for consequential changes,
- prefer recovery/undo when feasible.
