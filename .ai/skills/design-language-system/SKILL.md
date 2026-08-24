---
name: design-language-system
description: Builds or updates the repository's canonical DESIGN.md from existing UI evidence, product context, tokens, components, and intentional decisions. Use when UI work lacks a reliable shared design-language source or design drift is occurring.
metadata: {"category":"ui-ux","priority":"high"}
---

# Design Language System

## Goal
Create one durable design-language source instead of re-deciding style per page.

## Evidence order
1. Existing design tokens/theme/config.
2. Canonical shared components.
3. Repeated production UI patterns.
4. Existing product/brand documentation.
5. Explicit user direction/reference.
6. New decisions only when the project genuinely lacks an answer.

## Procedure
1. Audit active product surfaces.
2. Identify consistent patterns vs accidental drift.
3. Classify surface: product/workspace, marketing/brand, data/dashboard, or hybrid.
4. Record typography, color semantics, spacing, depth, radius, density, navigation, responsive and motion principles.
5. Distinguish established, inferred, and newly chosen decisions.
6. Update `DESIGN.md`.
7. Do not force existing UI to match a newly invented document.

## Exit criteria
Future agents can answer how UI here should look and behave using `DESIGN.md` plus canonical components.

## v7 canonicalization rules
- Read `PRODUCT.md` and run `product-surface-classification` before deriving visual defaults when the surface mode is unclear.
- Filter known legacy implementations before treating repeated styles as design evidence.
- Record canonical token/component paths and concrete deprecated visual paths in `DESIGN.md`.
- Imported design skills may propose changes, but durable decisions must be reconciled through `instruction-conflict-resolution`.
