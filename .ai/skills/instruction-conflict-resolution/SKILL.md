---
name: instruction-conflict-resolution
description: Resolves conflicting repository rules, skills, external design guidance and user/task requirements using explicit authority and specificity instead of silently following whichever instruction was read last.
metadata: {"category":"governance","priority":"critical"}
---

# Instruction Conflict Resolution

## Authority
Use the repository's declared authority order. By default:

```text
1. explicit current owner/user requirement
2. PROJECT_TRUTH.md / protected acceptance contract
3. safety/security/data invariants
4. PROJECT_RULES.md + DESIGN.md/PRODUCT.md for their domains
5. task-specific skill
6. generic pack skill
7. imported/third-party skill guidance
8. current implementation patterns
9. model preference/memory
```

More specific instructions within the same authority level outrank generic ones.

## Conflict examples
- External design skill says “make it bolder”; `PRODUCT.md` says calm low-density non-technical workspace → product context wins.
- Existing component uses legacy theme; `PROJECT_TRUTH.md` marks theme deprecated → existing code does not win.
- User asks a narrow bug fix; generic cleanup skill discovers unrelated debt → stopping criteria wins; defer debt.

## Procedure
1. Name the conflicting instructions.
2. Resolve using authority + scope + specificity.
3. Do not merge incompatible instructions into a compromise that satisfies neither.
4. Record a durable decision only if it affects future tasks.
5. If two same-authority product requirements are truly irreconcilable and evidence cannot resolve them, mark the conflict instead of guessing.
