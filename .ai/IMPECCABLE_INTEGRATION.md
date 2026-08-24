# Impeccable Integration

Upstream: https://github.com/pbakaus/impeccable

Reviewed: 2026-08-24

The upstream project currently presents itself as a frontend design guidance layer for AI coding agents, with one main skill, task-oriented commands, live browser iteration and deterministic frontend detectors. It can be useful, but importing another large instruction corpus blindly would recreate the exact context-conflict problem this pack is designed to prevent.

## Recommended relationship

```text
PROJECT_TRUTH / PRODUCT / DESIGN
        ↓ authority
v7 skill router
        ↓
impeccable-bridge (only when relevant)
        ↓
external Impeccable operation
        ↓
canonical implementation + legacy cleanup
        ↓
accessibility/runtime/bounded visual QA
        ↓
final/adversarial verification
```

## Why this pack does not clone its rules

- avoids duplicated or competing design doctrine;
- keeps third-party code/versioning outside the core pack;
- allows upstream updates without freezing copied instructions;
- keeps project-specific product UI constraints above generic style preferences;
- reduces context waste.

Before executing imported third-party scripts/skills, use the included `skill-security-review` workflow.
