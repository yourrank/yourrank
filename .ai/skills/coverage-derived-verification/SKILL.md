---
name: coverage-derived-verification
description: Derives verification scope from canonical registries such as router tables, workspace graphs, API registries, permission matrices, migrations, or story registries instead of hand-picked lists. Use for broad claims or any system that can enumerate its own scope.
metadata: {"category":"verification","priority":"critical"}
---

# Coverage-Derived Verification

Goal: make coverage follow the system, not the agent's memory.

Sources:
- router table / route manifest
- workspace config
- API route registry
- permission matrix
- migration history
- feature registry
- component/story registry

Procedure:
1. Identify canonical registry.
2. Enumerate scope automatically.
3. Classify static vs dynamic patterns.
4. Create representative fixtures for dynamic patterns.
5. Execute verification over the inventory.
6. Fail when a defined item lacks verification unless explicitly excluded.
7. Emit coverage summary.

Never maintain a smaller hand-written list when the canonical system can provide a complete one.
