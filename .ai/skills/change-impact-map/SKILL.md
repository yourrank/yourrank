---
name: change-impact-map
description: Maps behavior ownership, consumers, routes, tests, data contracts and legacy implementations before non-trivial edits so the agent fixes the complete affected surface rather than a locally convenient file.
metadata: {"category":"engineering","priority":"critical"}
---

# Change Impact Map

Before implementation, produce a compact internal map:

```text
Requested outcome:
Observed current behavior:
Owning implementation(s):
Entry points/routes:
Upstream dependencies:
Downstream consumers:
State/data ownership:
Tests/acceptance oracles:
Legacy/duplicate paths:
Files expected to change:
Files expected to delete:
Files deliberately out of scope:
Verification scope source:
```

## Rules
- derive consumers with imports/callers/routes/registries rather than filename guessing;
- map state and server/data ownership for cross-layer behavior;
- use canonical registries/manifests when they exist;
- do not make “small diff” a goal;
- do not expand into unrelated cleanup;
- update the map if evidence changes the root-cause model.

## Exit
The planned change is complete enough to address the behavior class and bounded enough to preserve unrelated working areas.
