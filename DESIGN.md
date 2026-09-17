---
name: YourRank Community Workspace
description: A mineral creator workspace, a creator-destination viewer experience, and separately scoped marketing material.
colors:
  viewer-action: "#5024f5"
  viewer-action-hover: "#3e1bca"
  viewer-canvas: "#fafbfe"
  viewer-surface: "#ffffff"
  viewer-inset: "#f2f4fa"
  viewer-text: "#0e1221"
  viewer-text-soft: "#52618a"
  viewer-text-mute: "#5a6789"
  viewer-rail: "#0e171e"
  viewer-rail-hover: "#efebff"
  viewer-line: "#e5e9f3"
  viewer-line-soft: "#edf0f6"
  viewer-warning: "#9a4b10"
  viewer-success: "#087e48"
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
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "36px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  viewer-section:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "21px"
    lineHeight: 1.3
  viewer-body:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "14px"
    lineHeight: 1.5
  viewer-control:
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
  viewer-record-number:
    fontFamily: "Inter, system-ui, sans-serif"
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
  viewer-control: "6px"
  viewer-module: "8px"
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

**Viewer North Star: "The Creator's Destination"**

The viewer/public community experience is a creator destination, not an admin dashboard. The creator's identity — name, mark, imagery and local accent — dominates the page; composition and hierarchy carry the experience rather than a grid of interchangeable bordered white cards. Rewards read as desirable products, leaderboards read as competitive and visually important, and credits, rank and membership status are woven into the page instead of sitting in separate record tiles. Purple/violet remains a brand accent for actions and focus, not the whole design. Home, Leaderboard, Rewards, My Activity, account settings, and viewer Help use the canonical renderer and navigation controller. Real Viewer Accounts and site-scoped memberships supply identity, balances, rewards, claims and standings; invented records, imagery, analytics and unsupported controls are not production content. No screenshot or mockup is the canonical visual target for the viewer world — this direction and the shell contracts below are.

Frontmatter keys prefixed `workspace-` describe the creator workspace and `viewer-` describe the supported viewer shell. Unprefixed keys retain the incumbent marketing and legacy material record; they do not govern the viewer world. Marketing keeps its near-white, ink-black, electric-violet language and Inter/Geist Mono stacks. Transparent OBS overlays and restricted legacy Games surfaces retain their existing scope.

The product demonstration and the user's state carry each screen. Decoration stays quiet so the current state, the next action, and the selected account/site context remain obvious.

**Key Characteristics:**

- Cool mineral workspace fields, white modules, slate text, and indigo action cues.
- A quiet light-slate rail and white context bar around the authenticated workspace.
- Hairline dividers and shared outer boundaries instead of nested card stacks.
- Compact identity, clear purpose, visible action, and readable state in the first viewport.
- One coherent creator workspace with explicit account and selected-site context.
- A viewer shell led by strong creator identity, with fewer, more meaningful surfaces, persistent community navigation and a compact disclosed mobile header.
- Rewards presented as products, leaderboards presented as competition, and credits/rank/membership status integrated into the page rather than boxed apart.
- An account directory of separate memberships, with flat personal claims and activity records inside each community.

## Colors

The authenticated palette uses indigo for action and focus, a mineral canvas behind white work surfaces, and a slate rail for navigation. Workspace-prefixed frontmatter tokens map to the canonical `--ws-*` CSS tokens. Viewer-prefixed tokens map to `viewer-shell.css` and remain the baseline neutral, text, line and action values; they do not prescribe a pale-canvas-plus-white-card composition. Inside the viewer shell the creator's identity (mark, imagery and local accent) sets the dominant colour of hero, leaderboard and reward surfaces, with the viewer violet reserved for actions, focus and active navigation. Neutral tone shifts and shared boundaries group related records; repetitive bordered white cards are not the default grouping device. Readable amber and green label claim states. The color names below describe the retained marketing/legacy palette.

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

**The Scoped Accent Rule.** Creator identity leads viewer surfaces and may set the dominant tone of hero, leaderboard and reward compositions; supported viewer actions use the viewer violet, marketing actions retain Electric Violet, and creator workspace actions use workspace indigo. Identity configuration does not own viewer navigation semantics, action colors or text contrast, and every identity-tinted surface must keep readable-contrast text and controls.

**The State, Not Decoration Rule.** Success, warning, and danger appear in status text, dots, narrow cue bands, and alerts—not as ornamental card themes.

## Typography

The workspace uses Fira Sans for interface copy and Fira Code for real data and compact metadata. Its six roles are the `workspace-*` frontmatter entries and the Authenticated Workspace Contract below. Viewer pages use Inter with tabular numerals for balances, scores, and dates. Viewer titles are bold, 36px on desktop and 30px on mobile. Supporting copy uses the blue-gray text tokens. The following Inter/Geist hierarchy is retained for marketing/legacy surfaces only.

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

The community Viewer layout uses an 80px desktop context bar, 228px navigation, flexible content, and an overview column, with 26px gutters. Home opens with a creator hero below the context bar that carries identity, membership status and, for members, the real balance and rank. Main content sizes from its measured container so large desktop screens fill with usable composition — wider reward and standings tracks, stronger hero and leaderboard scale — rather than a narrow centered column with dead margins; cap line length only for reading copy. Global account pages use a 252px YourRank navigation rail, 64px context bar, and full-width settings content. Desktop chrome remains stable by shell; the secondary overview rail moves below the main content when the measured content-fit rule in the Shared Shell and Component Contract below fails. The controller preserves the layout container while replacing canonical server-rendered content and chrome; entering global `/me` always replaces the community chrome with the account shell. Full-page links remain a fallback.

At narrow widths, marketing, creator Viewer, and platform document navigation use a named disclosed header targeted at 64px; the primary action or account affordance remains available and the creator workspace rail keeps its separate drawer behavior. Wide data stays inside its own scroll container. Viewer primary controls and community destinations have at least 44px targets. The existing wrapping Viewer navigation and 76px public header are known implementation gaps, not contract exceptions.

**The First Viewport Rule.** Every primary route starts with compact identity, one decisive purpose, a visible next action, and enough real or explicitly illustrative product state to understand the surface.

**The One Workspace Rule.** Shell, account, help, and selected-site context remain consistent; simplification must not hide whether work is account-scoped or site-scoped.

## Elevation & Depth

The system is flat by default. White and near-white surfaces separate through hairline borders, shared outer boundaries, internal dividers, and tonal shifts. Elevation is reserved for temporary overlays and menus. Workspace focus uses indigo, marketing focus retains violet, and viewer focus uses a 2px violet outline with 4px offset (light violet on the dark rail). Viewer transitions respect reduced motion.

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

Creator controls retain their 8px radius and 14px modules. Viewer controls use the viewer-control radius and reward/hero/leaderboard modules the viewer-module radius; a surface earns its own rounded boundary only when it is one of the page's few meaningful surfaces, not because it groups a record. Membership and account lists are divided rows. Code entry uses a soft ice inset. Marketing and legacy guidance below remains separately scoped.

Geometry is restrained and role-based. Primary actions and compact controls are nearly square; fields and small identity marks receive a gentle curve; cards and substantial reading surfaces use the larger soft corner; pills are limited to statuses and compact navigation. Adjacent information in one workflow shares an outer boundary and internal dividers rather than accumulating nested rounded containers.

**The Restrained Geometry Rule.** Corners communicate scale and role: near-square actions, small-radius fields, large-radius modules, and pills only for genuinely compact status or navigation objects.

## Components

### Authenticated components

Workspace buttons and fields use the small workspace radius, white or indigo fills, and the shared focus outline. White modules use the workspace module radius, subtle borders, and no resting shadow. The rail uses a selected slate fill and indigo current-location cue. Status chips pair semantic color with a readable label. Home uses a divided summary band and open activity/player rows; this first-surface composition is not a mandatory layout for every route.

Rewards setup keeps the current step prominent with a 44px action, suppresses duplicate connection status while setup is visible, and places the secondary Hide control after the setup disclosure on mobile. These are route-specific applications of state-before-action and progressive disclosure, not additional visual tokens.

### Viewer components

Community navigation names Home, Activities, Leaderboard, Rewards (`/<slug>/shop`), and My Activity (`/<slug>/me`). Activities is explicitly unavailable because no public activity contract exists. Global `/me` remains the membership directory; its settings hashes are Profile, Connected Accounts, Notifications, Privacy & Security, and Data & Account. Profile/provider editing, notification preferences, 2FA, session management, email management, and deletion are explicitly unavailable. Data export uses the existing viewer export endpoints; no backend model changes are implied by the navigation.

The viewer system is owned by `packages/shared/src/viewer-shell.ts`, `apps/leaderboard/src/assets/viewer-shell.css`, and `apps/leaderboard/src/assets/viewer-app.js`, with record, field, and dialog primitives inherited from `site-shell.css`. The supported body is `.yr-site.viewer-shell`; viewer-app mounts the page-specific site, account, or contact controller. The account directory/settings are rendered by `apps/leaderboard/src/pages/viewer-dashboard.js`; community content is rendered by `packages/shared/src/site-render.ts`. Restricted Games keeps its existing shell and is outside this replacement.

Leaderboard podiums style the original top-three list rows, with rank 1 centered, rank 2 left and rank 3 right. Tied top ranks retain equally presented compact rows. Search shows matching compact rows; clearing search restores the original layout. Player records have no avatar field, so marks use name initials without implying a Viewer Account link. Stored template configuration continues to round-trip; supported viewer pages share one creator-led composition: identity hero, then the page's primary surface (catalog, standings or activity), with membership status, balance and rank integrated where the viewer acts on them.

- **Navigation:** Pale violet marks the active community destination; global account navigation uses a saturated violet selection. Both use `aria-current="page"`. Missing Activities support is visible as unavailable, never a dead link.
- **Home:** A creator-identity hero leads; configured channels, real reward progress, a standings preview that reads as competition, and recent ledger activity follow as a few distinct surfaces with clear hierarchy rather than equal-weight cards. Unavailable stream status stays explicit until the existing Kick lookup returns a boolean.
- **Rewards:** Each reward is presented as a desirable product — prominent configured imagery (or the gift icon when absent), the creator's reward name, a clear tabular credit price and one obvious action — not as a database row. Search and sorting operate on actual configured items. Existing stock, cooldown, balance, membership, confirmation and redemption behavior remains canonical.
- **Leaderboard:** Standings are the page's dominant surface: a visually weighted top three, strong rank and score typography, and the viewer's own position emphasised when they are a member. Ranking logic and event selection remain unchanged.
- **Membership:** Real balance and recent record counts precede credit history, claims, participation, and code entry. Record statuses and community scope remain explicit. Empty, signed-out, absent-membership, unavailable, and blocked states are distinct.
- **Account:** Full-width settings cards replace the former account identity tile and community overview. Only supported identity/provider data and actions are rendered. Read-only gaps explain their unavailable state.

**The Membership Scope Rule.** The account page is a directory of relationships. Credits, claims, and participation stay attached to their community; visual grouping must not imply a global wallet, merged identity, or new shared persistence model.

Visual authority is the Creator's Destination direction above together with the shell contracts below; earlier screenshots and mockups are historical input, not the canonical target. Artwork, platform identities, notifications, analytics and metrics absent from the product cannot be introduced as real production content. Verification evidence must distinguish fixture behavior from deployed provider/database behavior.

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

## Shared Shell and Component Contract — YR-016

This is the implementation contract for the existing stack, not a new theme, route registry, component package, or framework rewrite. Current route IDs, URLs, data models, and shell owners remain implementation truth; presentation labels may clarify scope without changing route identity.

### Shell boundaries

- **Creator community Viewer shell:** owns creator identity, community destinations, and selected-community Rewards and My Activity. The canonical owners are `packages/shared/src/site-render.ts`, `packages/shared/src/viewer-shell.ts`, `apps/leaderboard/src/assets/viewer-shell.css`, and `apps/leaderboard/src/assets/site-shell.css`/`site-shell.js`. `/<slug>/shop` remains Rewards and `/<slug>/me` remains My Activity.
- **Global Viewer Account shell:** owns `/me`, the My communities directory, supported account settings, and return-to-community context. `apps/leaderboard/src/pages/viewer-dashboard.js` and `apps/leaderboard/src/assets/viewer-dashboard.js` own the account surface. It must not imply a global wallet, merged membership history, or global activity.
- **Platform Public/document shell:** owns marketing, non-viewer Help/support, legal, and other platform documents. Worker owners (`packages/shared/src/page-shell.ts`, `packages/shared/src/shell-nav.ts`, and the legal helper) and Next/OpenNext owners (`apps/web/src/components/site-shell.tsx`) may remain separate across their runtime boundary; they share behavior and vocabulary rather than requiring a transport or framework rewrite.

Shell identity, selected community, account scope, and site scope stay visible and distinct. Viewer Account, Membership, Leaderboard Player, creator account, and Telegram Subscriber identities remain separate. The creator workspace shell remains the authenticated operator surface: its sidebar owns section roots, local subnavigation owns tabs, and topbar owns context/search/actions.

### Responsive chrome and layout

- Viewer, public creator, and platform document families target a **64px mobile header** (within the required 56–64px range). It contains identity, one primary action or account affordance, and a named menu trigger; it does not stack the full desktop rail above the content. Desktop chrome remains stable by family: creator workspace rail/context bar, community Viewer rail/context bar, global account rail/context bar, and platform document header retain separate roles.
- A mobile disclosure preserves all usable destinations, exposes truthful `aria-expanded`/`aria-controls`, supports keyboard operation and Escape, returns focus to its opener, and avoids obscuring content beneath a sticky header. The current wrapping Viewer navigation and 76px public header are known gaps for YR-017/YR-018, not alternate contract behavior.
- Existing spacing and token authority remains canonical: workspace `--ws-*` tokens in `apps/leaderboard/src/assets/dashboard-v4.css`, viewer tokens in `apps/leaderboard/src/assets/viewer-shell.css`, and each existing shell's spacing scale. Do not introduce a second spacing or theme source.
- A secondary rail may sit beside main content only when the **measured usable container** fits `minimum usable main width (640px) + minimum usable rail width (280px) + gutter (24px) + required outer padding`. If it does not fit, move the rail below the main content in reading order. This is a content-fit rule, not a viewport-width guess; never squeeze catalog cards, standings, forms, or primary actions below their usable minimums.

### Vocabulary and semantics

- **Sign in** authenticates a Viewer Account with an available provider. It never means joining, claiming, or receiving credits.
- **Join community** is explicit opt-in that creates or activates Membership in the selected creator community; it is never a global join.
- **Rewards** is the selected creator's configured reward catalog and redemption destination (`/<slug>/shop`). Creator-workspace Rewards routes retain their current paths and semantics.
- **Reward credits** are free, site-scoped loyalty credits for that community's rewards. They have no cash value, purchase, or cashout; “credits” is a permitted short reference only when the community scope is already clear.
- **My Activity** is selected-community history of supported credits, claims, and participation (`/<slug>/me`), not global account activity. **My communities** is the global `/me` directory of separate creator memberships.
- Authentication never automatically claims a reward or silently joins a community. Explicit Sign in, Join community, and claim actions remain separate, and successful authentication must not be presented as a claim.

### Reusable behavior boundaries

These are conceptual contracts mapped to current owners, not unsupported universal components. Implementation is deferred to YR-017/YR-018 (responsive chrome), YR-038 (platform/legal convergence), and YR-039–YR-041 (broader action/component convergence) as applicable.

- **Shell:** owns landmarks, identity/context, skip link, responsive chrome, and shell-level navigation.
- **Navigation:** owns section roots, local tabs, current state (`aria-current`/`aria-selected`), unavailable destinations, and return context. Do not duplicate workspace roots in the topbar. Existing Viewer and workspace navigation remain canonical in `viewer-shell.ts`, `dashboard-nav.ts`, and `dashboard-chrome.ts`.
- **Action:** uses the existing viewer, workspace, and public button/link semantics and styling; labels name the outcome and preserve the route's scope.
- **Form/field:** uses native controls, visible labels, descriptions, field-local errors, preserved drafts, and practical 44px touch targets.
- **Status:** represents truthful queued, pending, completed, unavailable, error, timeout, and retry states with text plus semantic announcement, never color alone. Pending controls preserve their footprint and expose `aria-busy`; a timeout becomes an explicit recoverable error rather than false completion, and completion/error/retry messages use the existing `role="status"`, alert, and live-region patterns.
- **Dialog/drawer:** use native `<dialog>` where it is already canonical for Viewer actions and shared `window.YRDialog` from `apps/leaderboard/src/assets/dialog.js` for workspace overlays/drawers. Every modal/drawer has an accessible name, focus containment, Escape close, background inertness or equivalent, and focus return. Focus-visible styles and keyboard access are required across shells.

Guests see one contextual Sign in or Join community prompt appropriate to the action, not repeated sign-in widgets. Members see real selected-community balance/history, including legitimate zero and empty states. Guest, signed-in non-member, member, blocked, unavailable, pending, error, and retry states remain distinct.

### Route/width source review matrix

The following source review covers the requested routes at 390px and 1440px. It is not browser evidence: every row is **NOT RUNTIME-VERIFIED**.

| Surface | 390px contract review | 1440px contract review | Runtime status |
|---|---|---|---|
| Viewer Home `/<slug>` | **Contract fit:** identity, scoped rewards/standings, and 44px controls are represented. **Known gap:** current wrapping rail/header does not meet the disclosed-header contract. | **Contract fit:** Viewer rail, context, main content, and overview ownership match current source geometry. **Known gap:** secondary-rail eligibility still uses viewport breakpoints rather than measured content fit. | **NOT RUNTIME-VERIFIED** |
| Viewer Rewards `/<slug>/shop` | **Contract fit:** real catalog/search/sort and stacked-card behavior have source hooks. **Known gap:** current wrapping navigation remains. | **Contract fit:** desktop catalog and Viewer chrome retain current owners. **Known gap:** rail fit is not content-measured. | **NOT RUNTIME-VERIFIED** |
| Viewer Account `/me` | **Contract fit:** account return links, settings, and stacked content are represented in source CSS. **Known gap:** account navigation still wraps instead of using the compact disclosure. | **Contract fit:** separate 252px account rail and 64px context bar match current ownership. **Known gap:** runtime layout has not been rendered here. | **NOT RUNTIME-VERIFIED** |
| Viewer Help `/help/support?audience=viewer…` | **Contract fit:** viewer help form, return context, practical fields, and status/error hooks are represented. **Known gap:** current wrapping Viewer chrome remains. | **Contract fit:** distinct viewer Help shell and account/community return ownership are represented. **Known gap:** Worker document boundary has not been browser-checked. | **NOT RUNTIME-VERIFIED** |
| Platform legal `/terms` | **Contract fit:** platform document route and legal semantics exist. **Known gap:** legacy Worker header/responsive behavior needs later convergence. | **Contract fit:** platform document header/footer ownership exists while Worker and Next/OpenNext shells remain separate. **Known gap:** legal responsive convergence is deferred to YR-038. | **NOT RUNTIME-VERIFIED** |

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

Six standard roles, each a token pair, plus a restrained community identity role on Home. A raw `font-size` in a workspace rule is drift.

| Role | Token | Value | Used for |
| --- | --- | --- | --- |
| Page title | `--ws-type-page-size` / `-leading` | 28 / 36px | The one H1 per route |
| Section title | `--ws-type-section-size` / `-leading` | 20 / 28px | H2, section heads |
| Card title | `--ws-type-card-size` / `-leading` | 17 / 24px | Module and card headings |
| Body | `--ws-type-body-size` / `-leading` | 15 / 22.5px | Interface and explanatory copy |
| Meta | `--ws-type-meta-size` / `-leading` | 13 / 18px | Supporting state, compact UI text |
| Label | `--ws-type-label-size` / `-leading` | 11 / 16px | Uppercase mono labels that encode real scope or state |
| Community identity | `--ws-type-identity-size` | 36px maximum, 1.15 leading | The selected site's real name on Home; scales down to the page-title size |

Home gives the selected community's name and existing logo the focal position. When there is no logo, a name initial provides the same stable space without inventing artwork. The Home H1 uses the meta role as an orientation label. Status remains adjacent; launch readiness is compact and the checklist stays in a disclosure. Templates and schedules in Activities are collapsed for an unused workflow and open initially when saved work exists. These changes preserve the mineral palette and existing YourRank identity.

Rewards keeps the next setup action and claim counts visible; detailed activity metrics start collapsed when the loaded period has no activity and remain available through a disclosure. Connections prioritizes the connection action and groups usage/member-login controls behind a secondary disclosure. Errors remain visible rather than being disguised as empty activity.

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

### Reward imagery and community events — 2026-09-08

Rewards uses a container-sized catalog grid with product-style cards: prominent 4:3 reward art, creator reward name and description, a tabular credit price and one clear action. Uploaded art retains its canonical media pipeline; missing images use the gift icon. The creator fulfills each reward. Claims remain in the selected-community My Activity page and its overview rail.

The public brand link returns to that community's Home. Enabled, configured channels appear in the shared Viewer navigation. Site settings uses the full workspace width, and its destination labels match Rewards and My Activity. Appearance labels use workspace text tokens; Insights uses readable section panels and prominent values.

Leaderboard Setup includes independently saved event standings: name, players and points, public visibility, and delete. A labelled native select with a View leaderboard action switches between the main board and published events on the public Leaderboard page. Scores and players remain event-specific; memberships and rewards remain site-specific. Existing main leaderboard controls and ranking remain unchanged.

## Do's and Don'ts

### Do:

- **Do** organize new target-facing work around Home, Community, Activities, People, Rewards, Insights, and Settings while preserving current route identity until migration is explicit.
- **Do** let real user data or clearly labeled synthetic product demonstrations carry the visual hierarchy.
- **Do** use shared outer boundaries, internal dividers, and readable state before introducing another container.
- **Do** preserve visible focus, semantic status announcements, reduced-motion behavior, and 44px touch targets where practical.
- **Do** keep creator identity accents separate from scoped viewer and workspace action colors.
- **Do** preserve all viewer destinations through compact disclosed mobile navigation and separate membership records.

Billing uses the owner-supplied pricing-card composition inside the mineral workspace: Free/Pro/Team columns, one recommended Pro border, aligned price/interval/CTA, checkmarked feature lists, and a labelled monthly/annual control. Prices and feature copy come from the shared plan catalog. Usage uses actual capacity meters with explicit account/site scope. Data gives export the primary surface and isolates account deletion. Insights uses a two-column community/rewards and participation composition with current operations spanning beneath it; it stacks with consistent insets on mobile. Expandable secondary panels use a visible surface, border, keyboard focus, and a directional chevron rather than unmarked text. These extend the existing Fira/mineral tokens; they do not create another theme.

### Don't:

- **Don't** introduce decorative gradients, glass effects, glow fields, or floating metric-card walls into normal product surfaces; creator-identity hero and leaderboard surfaces in the viewer shell may carry identity colour and imagery, but never fake analytics, fake content or decoration that hides state.
- **Don't** rebuild viewer pages as walls of repetitive bordered white cards; use a few meaningful surfaces with clear hierarchy.
- **Don't** use semantic colors as decoration or communicate state by color alone.
- **Don't** hide the primary action or selected account/site context when the layout collapses.
- **Don't** turn mono labels, uppercase captions, or numbered markers into decoration; each must encode actual state, scope, sequence, or data.
- **Don't** invent testimonials, customer logos, metrics, billing promises, or performance claims that the product evidence does not support.
- **Don't** apply viewer-world rules to the creator workspace, marketing, OBS overlays, or restricted legacy Games.


The Creator's Destination direction supersedes both the earlier Channel guide HTML and the September 16 screenshot direction for community pages; global `/me` keeps the distinct YourRank account layout. Account views share the existing account response. No aggregate credit balance is displayed.
