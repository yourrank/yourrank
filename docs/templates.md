# Template author guide

Public leaderboard pages (`/<slug>`) are rendered by a **template**: a
self-contained design package. Templates are not skins over one layout —
each owns its page structure, tokens, typography, and presets. Picking a
template changes the whole page, the way Webflow/Wix templates do.

## Anatomy

Each template is one module: `apps/leaderboard/src/templates/<id>.jsx`,
exporting a single object registered in `templates/index.js`:

```js
export const MY_TEMPLATE = {
  id: "mytemplate",          // immutable API name (see rules below)
  name: "My Template",       // dashboard gallery label
  description: "...",        // gallery sublabel
  css: `...`,                // design tokens + layout CSS, scoped (see rules)
  fonts: ["Sora:wght@400;600;700;800"],   // Google Fonts css2 params
  presets: [                 // >= 3 accent pairs, valid #rrggbb
    { id: "signal", name: "Signal", accentA: "#4fc3f7", accentB: "#3b82f6" },
  ],
  compose: (p) => `...`,     // the page structure (see below)
  // Optional — full ownership beyond <main>:
  header: (sp) => `...`,     // replaces the shared nav header entirely
  footer: (sp) => `...`,     // replaces the shared footer entirely
  parts: {                   // redesign the INSIDE of shared blocks
    row: (pl, rank, h) => `...`,      // one standings row (rank >= 4)
    top3Card: (pl, rank, h) => `...`, // one podium card (rank 1-3)
  },
};
```

A template owns as much of the page as it wants. `compose()` defines
`<main>`; `header`/`footer` replace the chrome around it; `parts` overrides
the markup inside the shared data-bound blocks. Anything omitted falls back
to the shared defaults in `render.jsx` — a template that only defines `css`
still works. `header(sp)`/`footer(sp)` receive escaped shell parts (`b`,
`esc`, `navLogo`, `hasPartner`, `socials`, `legalLinks`, `disclaimer`,
`options`); part builders receive `(player, rank, helpers)` where helpers
are `{ esc, initials, moneyS, moneyShortS, moneyPrizeS, playerHrefS, cur,
hidePrizes }`. Custom chrome must keep the multi-element hooks the client
fills (`data-brand-name`, `data-tagline`, `data-year`).

`compose(parts)` receives the shared, already-escaped building blocks from
`buildParts()` in `render.jsx` (`streamWindow`, `heroLogo`, `timerGrid`,
`partnerPanel`, `top3`, `findRank`, `table`, `rules`, `pastSec`,
`socialsSec`, `titleGroup`, `poolSpan`, `periodSpan`, `ctaBtn()`,
`sCount`, ...) and returns an HTML string (or JSX) for `<main>`.
Data lives in the CMS layer (`sites.theme_json` / `extra_json`); templates
only read and arrange it.

## The rules (enforced in CI — templates.test.js)

1. **Ids are immutable.** `theme_json.template` is user data. Never rename
   or reuse an id; only add new ones. Unknown/removed ids fall back to
   `classic` automatically.
2. **Scope every CSS rule** under `body[data-template="<id>"]`. No `:root`,
   no bare selectors — templates must never leak into each other (preview
   compare, live switching).
3. **Keep the client contract.** `leaderboard.js` drives countdown, rows,
   top-3, reward details, socials, and live updates via `data-*` hooks.
   Single-element hooks (`data-rows`, `data-top3`, `data-timer-grid`,
   `data-countdown`, `data-count`, `data-payouts`, `data-find-rank`,
   `data-find-result`, `data-rules`, `data-past-grid`, `data-socials`,
   `data-player-count-badge`, `data-live-badge`, `data-copy-status`) may
   appear **at most once**; `data-rows` and `data-top3` are **required**.
   Optional sections can be omitted — the JS is null-safe.
4. **Keep section-toggle classes.** The dashboard can hide sections via
   `sections.*` toggles keyed to shared class names: `.hero`, `.hero-timer`,
   `.hero-cta`, `.top3`, `.find-rank-bar`, `.rules`, `#partner`,
   `.socials-sec`, `.past-sec`, `.payouts`, `.countdown`. Reuse these
   classes in your composer or the toggles silently stop working.
5. **Declare your fonts** in `fonts`. Pages load only the template's
   families plus the streamer's picker font — if you use a family and don't
   declare it, it won't load.
6. **Contrast is gated.** At registration, your `--ink*` tokens are checked
   against `--bg`/`--panel` for WCAG AA (throws in CI, warns in prod).
   Preset accent pairs must be `#rrggbb`.
7. **No per-template client JS.** Solve it in the composer or CSS. The
   single shared `leaderboard.js` is deliberate.
8. **Reduced motion is global.** A `prefers-reduced-motion` block in
   `leaderboard.css` kills all animations/transitions; don't add motion
   that conveys essential state (rank changes use color + text, not just
   movement).

## Testing

```sh
cd apps/leaderboard
bun test src/__tests__/templates.test.js   # contract, scoping, fonts, contrast
bun run test                               # full suite (one file per process — required)
```

Note: `bun test` over the whole `__tests__` directory fails spuriously —
several test files mock the same modules and bun's `mock.module` bindings
are process-global. Always use `bun run test` (per-file runner) or run a
single file.

To eyeball a template: `wrangler dev`, create a board, pick the template in
Dashboard → Design, and use the preview device toggle.
