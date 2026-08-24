---
name: ai-slop-detection
description: Detects recurring AI-generated frontend smells such as card grids, decorative metrics, excessive pills, gratuitous gradients, nested surfaces, duplicate UI systems and copied template structure without treating heuristics as proof.
metadata: {"category":"ui-ux","priority":"high"}
---

# AI-Slop Detection

This skill is a detector, not a design doctrine.

## Heuristic signals
- cards wrapping content that needs no containment;
- cards nested inside cards;
- every section uses the same title/subtitle/card rhythm;
- decorative KPIs with no decision/action;
- excessive badges/pills/chips;
- gradients/glow/glass used as default identity;
- repeated icon tile above headings;
- huge heading + muted subtitle consuming operational space;
- every section centered;
- too many visual container layers;
- multiple button/form/table/component dialects;
- mock/fabricated stats standing in for unavailable behavior;
- technical backend vocabulary leaking into normal user UI.

## Procedure
1. Run deterministic source heuristics when available: `python scripts/audit_ai_slop.py <paths>`.
2. Treat hits as review candidates, not automatic failures.
3. Compare against `PRODUCT.md` surface mode and `DESIGN.md`.
4. Inspect rendered UI for actual hierarchy/task impact.
5. Fix only confirmed problems.

## Important
A plain or conventional UI is not automatically bad. A distinctive UI is not automatically good. Product task success, coherence and accessibility outrank novelty.
