---
name: YourRank Community Workspace
description: A mineral creator workspace, a blue Channel guide for viewers, and separately scoped marketing material.
colors:
  viewer-action: "#205acc"
  viewer-action-hover: "#1648ac"
  viewer-canvas: "#f4f7fc"
  viewer-surface: "#ffffff"
  viewer-inset: "#e9eff8"
  viewer-text: "#142a48"
  viewer-text-soft: "#435a76"
  viewer-text-mute: "#526782"
  viewer-rail: "#dce9ff"
  viewer-rail-hover: "#c3d7fb"
  viewer-line: "#c9d5e5"
  viewer-line-soft: "#dce4ef"
  viewer-warning: "#91410b"
  viewer-success: "#126045"
  workspace-accent: "#4056b9"
  workspace-accent-hover: "#304398"
  workspace-accent-soft: "#edf0fc"
  workspace-canvas: "#f5f7fa"
  workspace-surface: "#ffffff"
  workspace-surface-soft: "#f0f3f8"
  workspace-surface-strong: "#e6ebf2"
  workspace-text: "#202b3c"
  workspace-text-soft: "#536176"
  workspace-text-mute: "#637187"
  workspace-chrome: "#edf1f7"
  workspace-chrome-raised: "#dde5f0"
  workspace-chrome-text: "#243348"
  workspace-chrome-line: "#d7dfe9"
  workspace-line: "rgba(20, 20, 12, 0.1)"
  workspace-line-strong: "rgba(20, 20, 12, 0.16)"
  primary: "#2200FF"
  primary-hover: "#1B00CC"
  production-chrome: "#121111"
  production-chrome-raised: "#232323"
  ink: "#191919"
  ink-muted: "#5C5C5C"
  ink-faint: "#6B6B6B"
  field: "#FFFFFF"
  surface: "#FCFCFC"
  surface-inset: "#EFEFEF"
  line: "rgba(0, 0, 0, 0.12)"
  line-soft: "rgba(0, 0, 0, 0.08)"
  success: "#1F8A68"
  warning: "#B76A12"
  danger: "#B42318"
typography:
  viewer-page:
    fontFamily: "Fira Sans, Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  viewer-section:
    fontFamily: "Fira Sans, Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "21px"
    lineHeight: 1.3
  viewer-body:
    fontFamily: "Fira Sans, Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "16px"
    lineHeight: 1.5
  viewer-control:
    fontFamily: "Fira Sans, Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
  viewer-record-number:
    fontFamily: "Fira Code, IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "14px"
    fontWeight: 700
  workspace-page:
    fontFamily: "Fira Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "28px"
    lineHeight: "36px"
    fontWeight: 700
  workspace-section:
    fontFamily: "Fira Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "20px"
    lineHeight: "28px"
  workspace-card:
    fontFamily: "Fira Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "17px"
    lineHeight: "24px"
  workspace-body:
    fontFamily: "Fira Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "15px"
    lineHeight: "22.5px"
  workspace-meta:
    fontFamily: "Fira Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "13px"
    lineHeight: "18px"
  workspace-label:
    fontFamily: "Fira Code, ui-monospace, monospace"
    fontSize: "11px"
    lineHeight: "16px"
  display:
    fontFamily: "Inter, Fira Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "clamp(3rem, 7vw, 5.5rem)"
    fontWeight: 500
    lineHeight: 0.98
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Inter, Fira Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "clamp(2.25rem, 5vw, 3rem)"
    fontWeight: 500
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Inter, Fira Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Inter, Fira Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Geist Mono, Fira Code, IBM Plex Mono, JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.1em"
rounded:
  viewer-control: "8px"
  viewer-module: "14px"
  workspace-control: "8px"
  workspace-module: "14px"
  workspace-pill: "999px"
  control: "2px"
  small: "6px"
  card: "16px"
  pill: "200px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  base: "16px"
  lg: "24px"
  xl: "32px"
  xxl: "48px"
  section: "64px"
  section-lg: "96px"
components:
  viewer-button-primary:
    backgroundColor: "{colors.viewer-action}"
    textColor: "{colors.viewer-surface}"
    rounded: "{rounded.viewer-control}"
    typography: "{typography.viewer-control}"
    padding: "10px 16px"
  viewer-button-secondary:
    backgroundColor: "{colors.viewer-surface}"
    textColor: "{colors.viewer-text}"
    rounded: "{rounded.viewer-control}"
    typography: "{typography.viewer-control}"
    padding: "10px 16px"
  viewer-code-input:
    backgroundColor: "{colors.viewer-inset}"
    textColor: "{colors.viewer-text}"
    rounded: "{rounded.viewer-control}"
    padding: "0 14px"
  viewer-code-panel:
    backgroundColor: "{colors.viewer-surface}"
    textColor: "{colors.viewer-text}"
    rounded: "{rounded.viewer-module}"
    padding: "24px"
  workspace-button-primary:
    backgroundColor: "{colors.workspace-accent}"
    textColor: "{colors.workspace-surface}"
    rounded: "{rounded.workspace-control}"
    height: "40px"
  workspace-button-secondary:
    backgroundColor: "{colors.workspace-surface}"
    textColor: "{colors.workspace-text}"
    rounded: "{rounded.workspace-control}"
    height: "40px"
  workspace-input:
    backgroundColor: "{colors.workspace-surface}"
    textColor: "{colors.workspace-text}"
    rounded: "{rounded.workspace-control}"
    height: "40px"
  workspace-module:
    backgroundColor: "{colors.workspace-surface}"
    textColor: "{colors.workspace-text}"
    rounded: "{rounded.workspace-module}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.field}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.field}"
    rounded: "{rounded.control}"
  button-dark:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "12px 16px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
    height: "44px"
  input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    rounded: "{rounded.small}"
    padding: "12px 14px"
    height: "44px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "24px"
  status-chip:
    backgroundColor: "{colors.surface-inset}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "4px 8px"
---

# Design System: YourRank Community Workspace

## Overview

**Creative North Star: "The Quiet Control Field"**

The authenticated creator workspace uses a cool mineral canvas, white work surfaces, quiet slate navigation, indigo actions, Fira Sans interface text, and measured Fira Code data. It organizes community work around one next action and readable activity. This is the user-authorized replacement of the incumbent dashboard world, recorded from the canonical stylesheet and shared shell contract.

The viewer world is **Channel guide**, direction seed `c2610fb4`: a visible blue community rail beside a flat ice reading field, navy Fira Sans copy, compact labeled controls, and divided working records. The account directory connects separate memberships; each creator destination keeps its community identity and personal state visible. This is a code-led replacement authorized by the user, without an approved comp or quality-bar image.

Frontmatter keys prefixed `workspace-` describe the creator workspace and `viewer-` describe the supported viewer shell. Unprefixed keys retain the incumbent marketing and legacy material record; they do not govern the viewer world. Marketing keeps its near-white, ink-black, electric-violet language and Inter/Geist Mono stacks. The retained North Star names that earlier record; Channel guide names only the viewer world. Transparent OBS overlays and restricted legacy Games surfaces retain their existing scope.

The product demonstration and the user's state carry each screen. Decoration stays quiet so the current state, the next action, and the selected account/site context remain obvious.

**Key Characteristics:**

- Cool mineral workspace fields, white modules, slate text, and indigo action cues.
- A quiet light-slate rail and white context bar around the authenticated workspace.
- Hairline dividers and shared outer boundaries instead of nested card stacks.
- Compact identity, clear purpose, visible action, and readable state in the first viewport.
- One coherent creator workspace with explicit account and selected-site context.
- A visible blue viewer guide with community identity and a wrapping mobile header.
- An account directory of separate memberships, with flat personal claims and activity records inside each community.

## Colors

The authenticated palette uses indigo for action and focus, a mineral canvas behind white work surfaces, and a slate rail for navigation. Workspace-prefixed frontmatter tokens map to the canonical `--ws-*` CSS tokens. Viewer-prefixed tokens record the overrides in `viewer-shell.css`: Channel Blue for actions and focus, Ice for the canvas, Navy for copy, and Pale Blue for the visible rail. White is reserved for fields and bounded tasks such as code entry; blue-gray lines divide records. Readable amber and green label claim states. The color names below describe the retained marketing/legacy palette; they must not override either replacement world.

### Primary

- **Electric Violet:** Primary calls to action, focus indicators, active product cues, links that need emphasis, and small live-state markers.
- **Deep Violet:** Hover and pressed treatment for violet actions.

### Neutral

- **Production Black / Raised Production Black:** Retained incumbent dark material tokens; they no longer describe the authenticated rail.
- **Ink Black:** Primary text and dark marketing actions.
- **Operational Gray:** Supporting copy and secondary labels that must remain comfortably readable.
- **Metadata Gray:** Quiet labels, timestamps, and compact supporting state.
- **White Field:** The page canvas and input field.
- **Paper Surface:** Cards, sticky bars, reading surfaces, and operator modules.
- **Inset Gray:** Selected rows, muted controls, and shallow inset regions.
- **Hairline / Soft Hairline:** Standard boundaries and lighter internal dividers.

### Tertiary

- **Success Green:** Completed, live, and healthy states.
- **Warning Amber:** Queued, pending, draft, and attention states.
- **Danger Red:** Destructive actions and errors only.

### Named Rules

**The Scoped Accent Rule.** Creator identity may retain its local accent; supported viewer actions and readable accent text use Channel Blue, marketing actions retain Electric Violet, and creator workspace actions use workspace indigo. Identity configuration does not own viewer layout or action colors.

**The State, Not Decoration Rule.** Success, warning, and danger appear in status text, dots, narrow cue bands, and alerts—not as ornamental card themes.

## Typography

The workspace uses Fira Sans for interface copy and Fira Code for real data and compact metadata. Its six roles are the `workspace-*` frontmatter entries and the Authenticated Workspace Contract below. Channel guide also uses Fira Sans, with the exact inherited stack recorded in `viewer-*`; Fira Code appears in record amounts, dates, and code entry. Membership balances and directory summaries use tabular Fira Sans numerals. Viewer page titles are bold and tighten slightly; introductory copy is 15px with a 65ch limit, record labels are 14px, and supporting record copy is 13px. At 900px page titles become 28px; membership titles become 26px at 600px. The following Inter/Geist hierarchy is retained for marketing/legacy surfaces only.

**Display Font:** Inter, falling back to Fira Sans and the system sans stack

**Body Font:** Inter, falling back to Fira Sans and the system sans stack

**Label/Mono Font:** Geist Mono, falling back through Fira Code, IBM Plex Mono, JetBrains Mono, and the system monospace stack

**Character:** Neutral sans typography gives the product a precise, contemporary voice without competing with data. Tight, medium-weight display type creates decisive marketing hierarchy; monospaced type marks real state, numbers, paths, timestamps, and compact metadata.

### Hierarchy

- **Display** (500, fluid 3–5.5rem, 0.98 line-height): Outcome-led marketing hero statements, balanced to short line lengths.
- **Headline** (500, fluid 2.25–3rem, 1.05 line-height): Section transitions and major product explanations.
- **Title** (500, 1.5rem, 1.2 line-height): Module and product-surface titles.
- **Body** (400, 1rem, 1.5 line-height): Product explanation and interface copy; explanatory reading text stays near 65–72 characters per line.
- **Label** (600, 0.6875rem, 0.1em tracking): Uppercase only when the label encodes real product scope, state, time, or data structure.

### Named Rules

**The Plain Speech Rule.** Interface copy names the visible outcome—Players, Commands, Broadcasts, Rewards, Fulfilment—not the underlying infrastructure.

**The Mono Has a Job Rule.** Monospace is reserved for data, state, paths, timestamps, compact labels, and technical metadata; it is not decorative display type.

## Layout

Marketing and product education use a centered reading frame of approximately 1152–1200px with 24px side padding, spacious 64–96px section intervals, and an editorial sequence: compact header, decisive heading, short explanation and action, then a large readable product surface. The first viewport visibly demonstrates the product instead of delaying it behind decorative copy.

The authenticated workspace uses a 232px slate rail by default, a 64px white context bar, and a mineral working field with 40px default inline padding. The stylesheet retains a 248px rail adjustment between 981px and 1180px and a 44px collapsed desktop rail. At 980px the rail becomes a drawer. Home places a launch region above a two-value summary, then activity and player lists; at 700px its columns stack and material Home actions have 44px minimum targets. The target creator IA is Home → Community → Activities → People → Rewards → Insights → Settings, while current labels and URLs remain implementation truth until migrated deliberately. Account and selected-site context stay visibly distinct. Comparable operational data uses divided rows, tables, and 8/4 or 12-column modules rather than isolated metric tiles.

Channel guide uses a 228px sticky rail and a reading column capped at 1180px, with 40px/48px/24px main padding and 32px section gaps. The rail owns community destinations and persistent account/help links. Community identity appears only in a community context; the account directory starts with My communities and does not repeat a YourRank context heading. At 900px the rail becomes a visible header: destinations and account links wrap onto their own rows, with community identity beside the brand. It does not become a drawer. Main padding becomes 28px/24px/20px, then 24px/18px at 600px. Membership activity and optional code entry stack at 600px; directory actions move below their community text. Record side columns wrap intrinsically when titles need room.

At narrow widths, marketing navigation becomes a disclosed menu while the primary Start free action remains visible; the creator workspace rail uses its separate drawer behavior. Wide data stays inside its own scroll container. Viewer primary controls and community destinations have at least 44px targets; compact viewer account links use a 40px minimum in the wrapping header.

**The First Viewport Rule.** Every primary route starts with compact identity, one decisive purpose, a visible next action, and enough real or explicitly illustrative product state to understand the surface.

**The One Workspace Rule.** Shell, account, help, and selected-site context remain consistent; simplification must not hide whether work is account-scoped or site-scoped.

## Elevation & Depth

The system is flat by default. White and near-white surfaces separate through hairline borders, shared outer boundaries, internal dividers, and tonal shifts. Cards and product previews rest without shadow. Elevation is reserved for temporary overlays, menus, and brief interactive lift; the standard overlay shadow is a soft black 16px/48px spread. Workspace focus uses indigo, marketing focus retains violet, and viewer focus uses a 2px Channel Blue outline with 4px offset. Channel guide adds no resting shadows, decorative lift, or entrance motion; inherited public control color/border/opacity transitions last 150ms and respect reduced motion.

### Shadow Vocabulary

- **Overlay:** A broad, soft shadow for dialogs and floating menus; never for ordinary cards.
- **Action hover:** The incumbent marketing/legacy controls retain their violet-tinted lift; workspace resting modules use `--ws-shadow: none`. Viewer controls change fill without a shadow.

### Named Rules

**The Hairline Before Shadow Rule.** Use boundaries and tonal layering for structure; add shadow only when a surface temporarily sits above the page or an action is responding to interaction.

## Brand Identity

One mark, one wordmark, one owner. `packages/shared/src/brand-assets.ts` is the single source of truth for every brand path in the repo; no surface — Worker, marketing page, downloadable file or favicon — inlines its own brand geometry.

- **Mark.** The triple-chevron "Y" (`LOGO_MARK_PATH`, rendered by `brandMarkSvg()`). Single colour via `currentColor`, so each surface's chrome supplies the colour; it sits on the cobalt brand square wherever a filled tile is required (`.lb-brand-mark`, `.gm-brand-mark`).
- **Wordmark.** The mark paired with the YourRank letterforms (`LOGO_FULL_PATH`, rendered by `brandLogoSvg()`), carrying the blue gradient `#315CFF → #5582FF → #8BAAFF`. Where a gradient cannot survive — dark chrome, favicons, downloadable badges, print — use the flat variant `brandLogoFlatSvg()` rather than redrawing the letterforms.
- **Loading identity.** `brandLoaderLogoSvg()` is the one animated lockup; the workspace loader is its only home.
- **Favicon / app icon.** `brandFaviconSvg()` reverses the mark out of the cobalt square so it still reads at 16px; served by the leaderboard Worker at `/favicon.ico`.
- **Downloadable assets.** `apps/web/public/brand/*.svg` are generated from the canonical paths by `bun run build:brand-assets` — never hand-edited — and the `/brand` page documents them.

**The One Identity Rule.** A bar chart, a lettered "YR" square, or any other locally drawn glyph is not the brand. Introducing brand geometry outside `brand-assets.ts` fails `apps/leaderboard/src/__tests__/brand-identity.test.js`.

## Shapes

Authenticated and viewer controls use their scoped 8px radius and modules use 14px. Viewer directory and membership records remain open divided rows; the code form is a bounded white panel. The near-square action language below is retained marketing/legacy guidance.

Geometry is restrained and role-based. Primary actions and compact controls are nearly square; fields and small identity marks receive a gentle curve; cards and substantial reading surfaces use the larger soft corner; pills are limited to statuses and compact navigation. Adjacent information in one workflow shares an outer boundary and internal dividers rather than accumulating nested rounded containers.

**The Restrained Geometry Rule.** Corners communicate scale and role: near-square actions, small-radius fields, large-radius modules, and pills only for genuinely compact status or navigation objects.

## Components

### Authenticated components

Workspace buttons and fields use the small workspace radius, white or indigo fills, and the shared focus outline. White modules use the workspace module radius, subtle borders, and no resting shadow. The rail uses a selected slate fill and indigo current-location cue. Status chips pair semantic color with a readable label. Home uses a divided summary band and open activity/player rows; this first-surface composition is not a mandatory layout for every route.

Rewards setup keeps the current step prominent with a 44px action, suppresses duplicate connection status while setup is visible, and places the secondary Hide control after the setup disclosure on mobile. These are route-specific applications of state-before-action and progressive disclosure, not additional visual tokens.

### Viewer components

Channel guide is owned by `packages/shared/src/viewer-shell.ts` and `apps/leaderboard/src/assets/viewer-shell.css`, with record, field, and public action primitives inherited from `site-shell.css`. The supported body is `.yr-site.viewer-shell`; supported public sections load site-shell followed by viewer-shell and omit `devin-system.css` and stored `data-template` overrides. The account directory is rendered by `apps/leaderboard/src/pages/viewer-dashboard.js`; community content is rendered by `packages/shared/src/site-render.ts`. Restricted Games keeps its legacy shell and is outside this replacement.

- **Navigation:** The visible rail carries enabled community pages with a filled blue current destination and `aria-current="page"`; hover uses the pale-blue selected tint. All communities returns to the global directory, Your account targets its identity section, and Help & contact remains a persistent utility. Account and membership scope must stay distinguishable. The viewer shell has no duplicate topbar or footer destination list.
- **Directory:** A 44px community mark precedes a title, scoped free-credit/claim summary, and Open membership action. Items share horizontal dividers. Account identity follows the directory; rare login actions live in a native Manage your login disclosure.
- **Membership:** Community identity and a compact free-credit balance precede full-width claims. Each row keeps reward title, cost/date, and an explicit status together. Credit activity and participation use native details disclosures, initially open when records exist. Optional code entry follows in a bounded panel. Empty, signed-out, absent-membership, unavailable, and blocked states are distinct.
- **Actions:** Directory/account buttons use a 44px minimum, 14px semibold text, and 10px/16px padding. Inherited community buttons use 48px height, 15px semibold text, and 22px inline padding; small code-submit and record actions use 44px height. Primary fill is Channel Blue; secondary fill is white or transparent with a blue-gray border. Disabled account buttons use 0.55 opacity; inherited disabled/busy community controls use 0.45 opacity and explicit state.
- **Fields and status:** Code fields use the inset blue-gray fill, 44px minimum height, 14px Fira Code, uppercase text, and 0.04em tracking. Status tags remain compact bordered text with readable semantic colors; they never substitute for the claim explanation. Inputs retain visible labels, adjacent feedback, and the viewer focus outline.

**The Membership Scope Rule.** The account page is a directory of relationships. Credits, claims, and participation stay attached to their community; visual grouping must not imply a global wallet, merged identity, or new shared persistence model.

Sources were scanned on 2026-09-06. Local synthetic review captures are `.impeccable/review/viewer-desktop.png`, `viewer-mobile.png`, `member-desktop.png`, and `member-mobile.png`. They show account and membership composition, including removal of redundant account rail context, not live customer data, all route states, or production deployment. Direction seed `c2610fb4` is provenance for this code-led world, not an approved visual comp.

The component descriptions below preserve the incumbent marketing/legacy guidance. Viewer tokens and the viewer components above take precedence inside the viewer shell; workspace tokens and the authenticated contract take precedence inside the dashboard shell.

### Buttons

- **Shape:** Primary and marketing actions use a near-square corner; standard marketing actions retain a 44px minimum target.
- **Primary:** Electric Violet with white text and compact 12px × 20px padding.
- **Dark:** Ink Black with a near-white label for the persistent header action.
- **Secondary / Ghost:** White or transparent with Ink Black text and a hairline border.
- **Hover / Focus / Active:** Primary actions deepen to Deep Violet, shared operator actions may lift by 1px, focus receives a visible violet ring, and active controls settle rather than float.
- **Disabled / Busy:** Preserve the component footprint, lower opacity, remove lift, change the cursor, and expose busy state semantically.

### Chips

- **Style:** Compact status and navigation chips use the pill radius, short padding, and either an inset neutral fill or a semantic border/text pairing.
- **State:** Live, pending, completed, and unavailable remain textually explicit; color never carries the state alone.

### Cards / Containers

- **Corner Style:** Soft card corner for incumbent marketing previews and legacy panels. Viewer record lists follow the scoped open-row treatment above.
- **Background:** Paper Surface on a White Field, with Inset Gray for selected or recessed regions.
- **Shadow Strategy:** Flat at rest; use the Elevation rules only for temporary layers.
- **Border:** Soft Hairline around the outer module; Hairline or Soft Hairline dividers within it.
- **Internal Padding:** Usually 24px, expanding to 28–32px for spacious marketing and authentication surfaces.

### Inputs / Fields

- **Style:** White field, readable Ink Black text, visible label, Hairline border, small corner, and a 44px target where practical.
- **Focus:** Border shifts to Electric Violet with a visible two-pixel violet outline or soft violet focus ring.
- **Error / Disabled:** Error copy stays adjacent to the field and uses a semantic alert treatment; disabled fields remain legible and visibly unavailable.

### Navigation

Marketing navigation is compact and quiet, with muted default text, ink hover, explicit current-page state, a persistent primary action, and a disclosed mobile menu. Operator navigation lives in Slate Rail, uses text plus line icons, and marks the active destination with raised slate and a narrow indigo inset cue. The sidebar owns section roots, local subnavigation owns tabs, and the topbar owns context and actions. Product-label changes must not silently redefine current route identity.

### Divided Data Surface

Leaderboard rows, reward catalogs, KPI bands, workflow steps, and operational tables share one outer boundary and separate comparable items with hairlines. Labels and numbers use the mono role only where it improves scanning; overflow stays inside the surface on small screens.

### Named Rules

**The State Before Action Rule.** When state affects a decision, show the truthful state immediately beside or before the action—published before Publish site, draft before Send, queued before Complete.

## Authenticated Workspace Contract

The unprefixed frontmatter and marketing/legacy guidance above retain the incumbent platform language. This section is the enforced contract for the authenticated
workspace — every surface inside `.v3-dash[data-auth-workspace]`, which is both the leaderboard dashboard
and the bot Worker's Telegram dashboard documents. It is executable: the tokens named here are defined once,
in the `ws-token-contract` block of `apps/leaderboard/src/assets/dashboard-v4.css`, and
`apps/leaderboard/src/__tests__/tokens.test.js` fails when a second definition, a second palette or a second
spacing scale appears. A workspace rule that hardcodes a value this contract names is a defect, not a style choice.

### Evidence and scope

Source: `apps/leaderboard/src/assets/dashboard-v4.css` (canonical token block) and `packages/shared/src/dashboard-chrome.ts` (shared shell and design contract). Home desktop/mobile captures are `.impeccable/review/desktop.png` and `mobile.png`. These captures document the observed Home composition, not all route behavior or deployment. The source is authoritative for the latest touch-target adjustment.

### Feel

Calm, modern, confident, creator-focused. The audience is streamers and their operators, not engineers:
approachable, non-technical, visually restrained. An operator often works mid-stream, on a second screen, in a
dark room, deciding one thing quickly. Within seconds a screen must answer where I am, what matters now, and
what I can do next.

### Hierarchy

Content outranks chrome — the production rail and top bar are quiet, and the working field carries the weight.
Every surface has exactly one obvious primary action; secondary controls recede to ghost or text treatment;
destructive actions are never the visual peer of the primary one. Advanced and rare controls are progressively
disclosed (a details panel, a secondary tab, an "Advanced" group) rather than presented alongside the common path.

### Typography roles

Six roles, each a token pair. A raw `font-size` in a workspace rule is drift.

| Role | Token | Value | Used for |
| --- | --- | --- | --- |
| Page title | `--ws-type-page-size` / `-leading` | 28 / 36px | The one H1 per route |
| Section title | `--ws-type-section-size` / `-leading` | 20 / 28px | H2, section heads |
| Card title | `--ws-type-card-size` / `-leading` | 17 / 24px | Module and card headings |
| Body | `--ws-type-body-size` / `-leading` | 15 / 22.5px | Interface and explanatory copy |
| Meta | `--ws-type-meta-size` / `-leading` | 13 / 18px | Supporting state, compact UI text |
| Label | `--ws-type-label-size` / `-leading` | 11 / 16px | Uppercase mono labels that encode real scope or state |

Families are `--ws-sans` (Fira Sans) and `--ws-mono` (Fira Code). Numbers and data may take the mono family where it improves
scanning; mono is never decoration.

### Spacing

`--ws-space-1` 4px, `-2` 8px, `-3` 12px, `-4` 16px, `-5` 20px, `-6` 24px, `-7` 32px, `-8` 48px. This is the only
spacing vocabulary in the workspace; there is no second scale and no off-scale value. Rhythm comes from
whitespace first — reach for space before a border, and for a border before a container.

### Surfaces

- `--ws-canvas` — the page field everything sits on.
- `--ws-surface` — a raised reading surface: a module, a table card, an overlay.
- `--ws-surface-soft` / `--ws-surface-strong` — inset and selected regions inside a surface.
- `--ws-line` / `--ws-line-strong` — the hairline that does most grouping work; `-strong` only where a boundary
  must survive against a soft fill.
- `--ws-chrome`, `--ws-chrome-raised`, `--ws-chrome-line`, `--ws-chrome-line-strong`, `--ws-chrome-text`,
  `--ws-chrome-text-soft` — the light-slate rail and related navigation chrome.
- `--ws-chrome-card` — a card resting inside navigation chrome (the rail's site card, the editor preview tabs).

**When to use no container at all.** A container must justify itself. One list, one form or one explanation on a
page needs a heading and space, not a box. Related items share one outer boundary and separate with hairlines
instead of becoming a stack of nested cards, and a card inside a card is always wrong.

### Radii

`--ws-radius-sm` 8px for controls, fields and compact objects; `--ws-radius` 14px for modules and overlays;
`--ws-radius-pill` for genuinely compact status and navigation objects only. Nothing else. Corners encode scale
and role, so a pill-shaped panel or a 24px-radius module is drift.

### Colour

Neutral surfaces dominate; the workspace is mostly canvas, surface, line and text. `--ws-accent` (indigo, with `--ws-accent-hover`, `--ws-accent-soft`, `--ws-accent-line`, `--ws-accent-text` and
`--ws-accent-on-chrome`) is the single action and focus accent — if an accent-coloured thing is not an action,
a focus cue or the current location, the colour is decoration and must go. Semantic state uses
`--ws-success*`, `--ws-warning*`, `--ws-danger*` and `--ws-info*`, always paired with words, never colour alone.
Decorative gradients are not part of the workspace language; the only gradient in the product is the wordmark.

### Shadows

`--ws-shadow` (`none`) for resting surfaces and `--ws-shadow-overlay` for temporary layers —
dialogs, menus, drawers. Borders, tonal shifts and spacing do the rest. A resting card has no shadow.

### Interaction states

Every interactive element defines all of these, and none of them may be communicated by colour alone:

- **Hover** — a tonal shift, never a layout shift.
- **Active** — the control settles; it does not float.
- **Focus-visible** — one treatment for the whole workspace: `--ws-focus-width` solid `--ws-focus` at
  `--ws-focus-offset`. Per-component focus rings are drift; a component may only override the offset (when the
  ring would otherwise be clipped) or, inside navigation chrome, the colour — and then only to
  `--ws-accent-on-chrome`, to preserve the rail's distinct focus treatment.
- **Disabled** — footprint preserved, opacity lowered, cursor changed, still legible.
- **Loading** — the element keeps its size and exposes busy state semantically (`aria-busy`), so nothing jumps.
- **Selected** — `--ws-surface-strong` fill or an accent inset cue, plus `aria-current` or `aria-selected`.
- **Destructive** — `--ws-danger` text and border on a neutral fill, never a filled red primary button.

Controls use `--ws-control-h` (40px), with `--ws-control-h-touch` (44px) for touch treatments. Material Home actions also reach 44px at the 700px breakpoint, and
motion respects `prefers-reduced-motion`.

### Density

Low to moderate. This is an operator tool for non-technical creators, not a trading terminal: fewer things per
screen, more room around each, and naturally tabular information rendered as a list or table rather than as a
wall of tiles. Copy names the visible outcome — "Connect Kick", not "Configure integration".

### References

Quality references, not layouts or brands to copy — nothing here should make the product look like another
company's app. Linear for precision, hierarchy, spacing restraint, navigation clarity and interaction polish;
Stripe for form and settings clarity; Notion for approachable simplicity; Raycast for interaction polish;
Resend for restrained data presentation; Vercel for clean status and settings surfaces.

### Where the workspace differs from the platform frontmatter

Workspace-prefixed frontmatter entries record the replacement palette and typography from the canonical token block. The workspace uses a cool mineral canvas, slate ink and rail, indigo actions, Fira Sans/Code, an 8px control radius, and a 14px module radius. The unprefixed values remain the marketing/legacy record; viewer-prefixed values separately record Channel guide. The frontmatter's
`rounded.control: 2px` currently matches neither layer — marketing is predominantly 6px — which is recorded
debt for whichever PR owns the marketing surfaces, not something the workspace should copy.

### Remaining implementation limits

Honest state of the implementation, so nobody reads this contract as a claim that all legacy CSS is gone:
class names still carry `v3`/`v4` generation labels; the workspace sheet retains raw pixel and color literals
under test ratchets (consult the current token test for the enforced ceilings); `app.css` remains a fallback layer; some surfaces retain local tab treatments; and existing controls may retain local styling beyond the shared primitives. `dashboard-v4.css` now owns workspace canvas,
rail, topbar, navigation, and every `--ws-*` token. `devin-system.css` supplies broader marketing/legacy material values; it is not a second workspace-token owner and is excluded from the supported viewer shell.
Later migrations lower the ratchets as they touch each surface.

## Do's and Don'ts

### Do:

- **Do** organize new target-facing work around Home, Community, Activities, People, Rewards, Insights, and Settings while preserving current route identity until migration is explicit.
- **Do** let real user data or clearly labeled synthetic product demonstrations carry the visual hierarchy.
- **Do** use shared outer boundaries, internal dividers, and readable state before introducing another container.
- **Do** preserve visible focus, semantic status announcements, reduced-motion behavior, and 44px touch targets where practical.
- **Do** keep creator identity accents separate from scoped viewer and workspace action colors.
- **Do** preserve the viewer's visible community guide, wrapping mobile navigation, and separate membership records.

### Don't:

- **Don't** introduce decorative gradients, glass effects, glow fields, or floating metric-card walls into normal product surfaces.
- **Don't** use semantic colors as decoration or communicate state by color alone.
- **Don't** hide the primary action or selected account/site context when the layout collapses.
- **Don't** turn mono labels, uppercase captions, or numbered markers into decoration; each must encode actual state, scope, sequence, or data.
- **Don't** invent testimonials, customer logos, metrics, billing promises, or performance claims that the product evidence does not support.
- **Don't** apply viewer-world rules to the creator workspace, marketing, OBS overlays, or restricted legacy Games.
