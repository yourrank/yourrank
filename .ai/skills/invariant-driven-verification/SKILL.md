---
name: invariant-driven-verification
description: Turns recurring bugs and 'must never regress' requirements into explicit properties and named invariant tests or gates. Use when a fix should apply across a class of routes, components, permissions, states, APIs, or architectural implementations.
metadata: {"category":"verification","priority":"critical"}
---

# Invariant-Driven Verification

Trigger signals:
- never again
- always
- across all pages
- exactly one
- must not regress
- permanently fixed
- single source of truth

Procedure:
1. Identify visible failure.
2. Generalize the class.
3. State the invariant.
4. Identify canonical scope source.
5. Decide whether automation can enforce it.
6. Update `INVARIANTS.md`.
7. Add/update named invariant test/gate.
8. Run across derived scope.
9. Report exact coverage.

Do not confuse "the failing example passes" with "the class is prevented."
