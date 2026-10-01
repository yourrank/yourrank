# Template System Roadmap

How yourrank's template system grows from "same design, different colors" to
big-company-level flexibility, where every new template is a genuinely
different product — while staying dashboard-editable and safe.

## Where we are

Merged foundation (PRs #261–#263):

- Every template is a self-contained design package: own `compose` (page
  structure), scoped CSS, own Google Fonts, curated presets.
- Contract gates in `src/__tests__/templates.test.js`: singleton `data-*`
  hooks, CSS scoping (`body[data-template="<id>"]` only), WCAG AA contrast
  check that throws in CI.
- Per-template editable options schema: each template declares `schema`, the
  dashboard auto-builds the form, `resolveOptions()` validates everything so
  hostile `theme_json` can't break a page. Values render as `--opt-*` CSS
  vars and `data-opt-*` body attributes.

## The rule that makes templates feel different

Colors are the last 10% of a design. The levers, in impact order:

1. **Layout structure** — hero position, grid vs single column, what's above
   the fold. If two templates share a `compose` shape, they're one design.
2. **Typography** — different font pairings (display + body + mono), scales,
   casing, letter-spacing. Type alone changes the whole vibe.
3. **Shape language** — border radius (0px brutalist vs 24px soft), borders
   vs shadows vs glass.
4. **Density & spacing** — compact data-table vs airy marketing page.
5. **Motion** — snappy/terminal, floaty/luxury, bouncy/playful.
6. **Texture & depth** — gradients, noise, glows, scanlines. Colors last.

Workflow for every new template: write a 5-line design brief first, then
build the `compose` structure, then tokens, then colors. **If you can't
describe how it differs without mentioning color, it's not a new template.**

## Phase 1 — prove the spectrum (build, no new deps)

Three radically different templates so the system demonstrably supports
anything:

- **noir** (this PR) — "old-money editorial ledger": Playfair Display serif
  masthead, hairline gold rules, honour-roll podium with Roman numerals,
  ledger table, optional film grain. Knobs: accent color, grain toggle,
  podium style (roman/numbers).
- **broadcaster** — "live sports lower-third": oversized tabular stats,
  ticker strip, sponsor bar, dense information hierarchy built for embedding
  on stream overlays. Knobs: accent, ticker on/off, stat size.
- **arcade** — "retro cabinet": pixel display font, chunky borders, scanline
  dividers, saturated neon on near-black. Knobs: accent pair, glow
  intensity, CRT curvature frame.

Each ships with ≥3 curated presets and passes all contract gates.

### New schema field types (when a template needs them, not before)

1. `range` — numeric slider within min/max (glow intensity, grain opacity).
2. `font` — curated font-pair picker (template declares allowed pairs; users
   never get freeform fonts, that's how designs stay unbreakable).
3. `layout` — layout variant select (sidebar vs stacked); consumed in
   `compose()` via `parts.options`, not just CSS.

Add the renderer + dashboard control for a type only when a real template
uses it. No speculative abstraction.

## Phase 2 — harden (small, deliberate)

- **Contrast gate upgrade**: replace the hand-rolled luminance math in
  `templates/index.js` with [`culori`](https://culorijs.com) (~3kB, zero-dep,
  ESM). This is the **only dependency worth taking** — it makes the existing
  gate stricter (check `--opt-accent` defaults against panel backgrounds
  too) and gives us color manipulation for auto-generated preset variants.
- **Preset live-swap thumbnails** in the dashboard using the existing
  preview endpoint. No new infra.
- **Per-template option docs**: `docs/templates.md` gets a section per
  template generated from its schema (script, not hand-written).

## What we deliberately do NOT adopt

- **react-jsonschema-form / JSON Forms** — the right tools for schema-driven
  forms, but they require React-ifying the dashboard. Our auto-form is ~50
  lines, zero deps, and our `schema` blocks already follow JSON-Schema-ish
  shape, so migrating later (at ~10+ templates) is trivial. Not now.
- **Style Dictionary / Tokens Studio** — solve token compilation across
  platforms (iOS/Android/email). We render SSR strings in one Worker; our
  tokens live fine in scoped CSS vars. Wrong problem.
- **Tailwind / CSS-in-JS** — conflicts with the scoped-CSS contract gate and
  adds a build step for zero gain at this size.
- **Freeform user CSS** — never. Guardrails are the product: curated choices
  that can't break the design (Shopify `settings_schema.json` model).

## Adding a template: the checklist

1. Write the 5-line design brief (no colors allowed).
2. New module `src/templates/<id>.jsx`: `id, name, description, css, fonts,
   presets (≥3), schema, compose`.
3. Register in `src/templates/index.js` (`TEMPLATES` map, end of list — ids
   are immutable, order is the catalog order).
4. Update the two hardcoded expectations in `templates.test.js`
   (`TEMPLATE_IDS`, catalog length) and add a schema test.
5. `bun test` — every contract gate must pass with zero new warnings.
6. Dashboard gets its form for free. If you touched dashboard code, you
   either added a new field type (update this doc) or did something wrong.
