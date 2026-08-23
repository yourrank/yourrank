---
name: non-technical-user-ux
description: Translates technical configuration and system concepts into goal-oriented workflows with sensible defaults, progressive disclosure, plain language, and safe advanced options. Use when product users are not engineers or should not need technical knowledge.
metadata: {"category":"ui-ux","priority":"high"}
---

# Non-Technical User UX

Do not expose implementation concepts unless users genuinely need them.

Prefer:
```text
Connect account
→ choose desired outcome
→ confirm
→ see clear status
→ advanced settings only when needed
```

Procedure:
1. Identify real user outcome.
2. Separate required knowledge from implementation detail.
3. Choose sensible defaults.
4. Hide uncommon controls behind progressive disclosure.
5. Explain consequences in user language.
6. Make connection/status/error states clear.
7. Use guided setup for risky multi-step configuration.
8. Preserve expert controls only where justified.

Quality test:
Can a motivated first-time user complete the main task without understanding backend architecture?
