---
name: visual-composition
description: Improves visual hierarchy, spacing, typography, color semantics, density, depth, imagery, and emphasis so interfaces communicate clearly without generic AI aesthetics or over-decoration.
metadata: {"category":"ui-ux","priority":"high"}
---

# Visual Composition

## Hierarchy
Primary information/actions should be visually obvious.
Secondary information recedes.
Not every button or heading gets equal weight.

## Spacing
Use proximity to communicate relationships.
Whitespace separates meaning; it is not a luxury tax.

## Typography
Use a restrained scale and weights.
Keep body content readable.
Use tabular figures for comparisons when useful.

## Color
Neutrals build structure.
Semantic color communicates state.
Accent color is intentional.

## Depth
Use one coherent surface strategy rather than random borders + shadows + blur + glass.

## Density
Match task type.
Operational UI may be dense without being cramped.

AI-slop warnings:
- repeated same-sized cards,
- giant generic heading + muted subtitle,
- gradient blobs as identity,
- excessive pills/badges,
- decorative metrics,
- every section centered.

## v7 product-context rule
Visual novelty is never a default requirement. Check `PRODUCT.md` surface mode first. For product/dashboard surfaces, prioritize comprehension, task hierarchy and calm consistency. Use expressive brand techniques only when the surface and product intent justify them.
Run `ai-slop-detection` when the interface shows repeated AI-template patterns.
