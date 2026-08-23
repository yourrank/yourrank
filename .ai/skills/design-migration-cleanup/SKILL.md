---
name: design-migration-cleanup
description: Replaces a legacy UI or design system completely by migrating consumers, removing old routes/styles/state/providers and proving the obsolete design is no longer reachable.
metadata: {"category":"ui-ux","priority":"critical"}
---

# Design Migration Cleanup

Use when a redesign must replace, not coexist with, an older UI.

## Protocol
1. Identify canonical target and every competing implementation.
2. Enumerate consumers from the real route/import/component graph.
3. Define migration acceptance criteria including alternate states and responsive variants.
4. Migrate one ownership boundary at a time.
5. Remove obsolete routes, redirects, imports, providers, stylesheets, tokens, flags and storage branches.
6. Search for zero remaining references to deprecated identifiers.
7. Render/test canonical states on desktop and narrow viewport.
8. Update `PROJECT_TRUTH.md`, `DESIGN.md`, and `.ai/FORBIDDEN_PATTERNS.txt` with proven legacy identifiers when appropriate.

## Compatibility rule
Keep a compatibility layer only when an explicit external/runtime requirement needs it. Give it a removal condition and owner. “Just in case” is not a requirement.

## Completion proof
- old implementation has zero active consumers;
- old route/design cannot be reached through known state variants;
- no duplicate design-system owner remains;
- verification covers routes/states derived from canonical sources, not a hand-picked screenshot.
