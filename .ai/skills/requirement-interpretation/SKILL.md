---
name: requirement-interpretation
description: Resolves materially ambiguous implementation or UX requirements against repository structure, existing product behavior, and rendered evidence before coding. Use when one phrase can imply different architectures, navigation models, ownership boundaries, or user flows.
metadata: {"category":"verification","priority":"critical"}
---

# Requirement Interpretation

1. Extract the ambiguous phrase.
2. List materially different interpretations.
3. Inspect repository architecture and current product behavior.
4. Compare each interpretation against canonical ownership, existing interaction patterns, business rules, and rendered behavior.
5. Choose the best-supported interpretation.
6. Record it in the task/spec/decision note.
7. Ask the user only if evidence cannot resolve the ambiguity.

Do not turn ambiguity into architecture drift.
