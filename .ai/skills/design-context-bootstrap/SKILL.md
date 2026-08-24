---
name: design-context-bootstrap
description: Establishes canonical PRODUCT.md and DESIGN.md context from real product evidence before redesign work, preventing page-by-page invention and design-over-design drift.
metadata: {"category":"ui-ux","priority":"critical"}
---

# Design Context Bootstrap

## Why
Do not let every UI task re-decide the product identity.

## Evidence order
1. Owner-approved product intent and constraints.
2. `PROJECT_TRUTH.md` / `PRODUCT.md`.
3. Canonical tokens/theme and shared components.
4. Approved rendered screens/baselines.
5. Repeated active patterns after legacy filtering.
6. New design decisions only where evidence is genuinely absent.

## Procedure
1. Run `product-surface-classification`.
2. Locate all active layouts/themes/token sources/component libraries.
3. Identify obvious legacy/parallel design systems before deriving patterns.
4. Populate/update `PRODUCT.md` and `DESIGN.md`.
5. Mark decisions as established, owner-approved, or inferred-needs-review.
6. Record explicit anti-references/anti-goals where they prevent recurring drift.
7. Do not rebuild UI merely to make the document internally consistent.

## Non-goals
- no invented rebrand;
- no automatic “modernization”;
- no copying one reference product wholesale;
- no using existing inconsistency as proof that all variants are valid.

## Exit
Later UI tasks can answer what mode, density, vocabulary, token source, canonical components and anti-patterns apply without improvisation.
