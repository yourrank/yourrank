---
name: ui-root-cause-forensics
description: Diagnoses visual and UX regressions by tracing routes, component ownership, styles, state, feature flags, cache/storage, responsive branches and legacy paths before changing UI code.
metadata: {"category":"ui-ux","priority":"critical"}
---

# UI Root-Cause Forensics

Use before fixing any UI bug where the wrong/old design appears, behavior differs by route/state, or prior fixes have stacked CSS/components.

## Forensic map
Trace the rendered experience through:

```text
URL/entry
→ router/layout
→ page/component tree
→ state/flags/permissions
→ data
→ theme/tokens/stylesheets
→ responsive branch
→ persisted storage/cache/service worker
→ DOM/rendered result
```

## Mandatory checks
- all routes/redirects that can reach the surface;
- all competing layout/page/component implementations;
- global + module + utility + inline style ownership;
- duplicated tokens/themes/providers;
- feature flags and A/B/migration branches;
- local/session storage, cookies and server-persisted UI state;
- cache/service worker/CDN behavior when stale assets are plausible;
- mobile/desktop conditional rendering;
- permission/empty/loading/error variants;
- tests/snapshots that may preserve old behavior.

## Root-cause statement
Before editing, state the earliest verified cause that explains every observed symptom. If there are multiple independent causes, list them explicitly.

## Forbidden fixes
- CSS override pile without ownership analysis;
- new `*V2/*New/*Final` page;
- hiding the old path without proving it is unreachable;
- changing only the screenshot state while alternate states still render legacy UI.

## Exit
You know exactly why the wrong UI appears, what owns it, what legacy paths exist, and how to prove the entire affected class is fixed.
