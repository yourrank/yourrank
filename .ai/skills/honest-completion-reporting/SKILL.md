---
name: honest-completion-reporting
description: Constrains completion language to actual executed evidence and requires named tests for permanent/global claims. Use before reporting completion for broad fixes, migrations, cross-route changes, or 'never regress' requirements.
metadata: {"category":"verification","priority":"critical"}
---

# Honest Completion Reporting

Evidence defines the maximum strength of the claim.

Report:

```text
Verified
- exact routes/tests/checks actually executed

Not verified
- anything not checked

Invariant enforcement
- named test/gate, if one exists

Coverage
- derived source and counts
```

Only use app-wide or permanent wording when a named invariant test/gate would fail if the behavior returned and the enforced scope matches the claim.

Never convert partial evidence into universal confidence.
