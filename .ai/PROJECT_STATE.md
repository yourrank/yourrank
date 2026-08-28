# Project State

Maintained to prevent architecture drift.

**Evidence baseline:** `main` at `e71faab725f322c8aa965398aab941f9fb7a6f5d` (PR #663 merged)

**Last reconciled:** 2026-08-28

**Scope:** current implementation reality only. Target product direction lives in [`docs/YOURRANK_PRODUCT_ARCHITECTURE.md`](../docs/YOURRANK_PRODUCT_ARCHITECTURE.md).

## Canonical Current Sources

| Concern | Current owner |
|---|---|
| Dashboard route semantics | `packages/shared/src/dashboard-routes.ts` |
| Navigation presentation | `packages/shared/src/dashboard-nav.ts` |
| Chrome state | `packages/shared/src/dashboard-chrome-state.ts` |
| Authenticated shell structure | `packages/shared/src/dashboard-chrome.ts` |
| Leaderboard Worker shell adapter | `apps/leaderboard/src/pages/dashboard-shell.jsx` |
| Client dashboard navigation | `apps/leaderboard/src/assets/dashboard/shell.js` |
| Public viewer renderer | `packages/shared/src/site-render.ts` |
| Public viewer styles | `apps/leaderboard/src/assets/site-shell.css` |
| Authenticated workspace tokens | `apps/leaderboard/src/assets/dashboard-v4.css`, `ws-token-contract` block |
| Schema | `supabase/migrations` (121 migration files at this baseline) |
| Runtime/deployment description | `ARCHITECTURE.md` plus Worker configuration |

## Convergence Status

### Route ownership/model — RESOLVED

- `DASHBOARD_ROUTES` is the single editable current route-semantics manifest.
- Stable IDs, canonical paths, sections/tabs, Worker owners, delivery modes, scopes, navigation parameters, and legacy aliases are encoded there.
- Browser/server/Worker parity and uniqueness are enforced by shared and Worker tests.
- `dashboard-nav.ts` derives hrefs and route ownership from the manifest; it is presentation, not a competing route table.

### Dashboard shell and chrome — RESOLVED

- `dashboardChromeHtml()` in `packages/shared/src/dashboard-chrome.ts` is the single authenticated structural emitter.
- Leaderboard pages and Telegram documents render that shared structure through thin adapters.
- `dashboard-chrome-state.ts` owns titles, crumbs, active rail state, and local tabs.
- Structural ownership and chrome-ownership gates prevent a second shell/tree.

### Navigation ownership — RESOLVED

- The sidebar owns section roots, page subnavigation owns tabs, and the topbar owns context/search/actions.
- `requestDashboardRoute` in `apps/leaderboard/src/assets/dashboard/shell.js` is the one authenticated client-navigation entry point.
- The public viewer account history runtime is separate and does not own dashboard navigation.

### Telegram shell/runtime — STRUCTURE CONVERGED; WORKER BOUNDARY RETAINED

- The duplicate Telegram dashboard shell runtime was deleted in Wave 2.
- Telegram routes remain account-scoped `worker-document` destinations served by the Bot Worker at `/dashboard/telegram*`.
- Telegram documents use shared navigation, chrome state, shell structure, and leaderboard-owned shared assets.
- Current operational Telegram workflows remain intact pending a future generic communication architecture.

### CSS/token state — CANONICAL TOKENS; REMAINING CASCADE DEBT

- Every authenticated `--ws-*` token is defined once in the `ws-token-contract` block of `dashboard-v4.css`.
- `tokens.test.js` enforces token ownership, the type/spacing scales, focus behavior, and drift ratchets.
- `devin-system.css` still supplies broader marketing/public material variables and some authenticated page-body material rules. It no longer owns a competing `--ws-*` token block, but its remaining authenticated cascade is accepted debt.
- Legacy `v3-*`/`v4-*` class-generation names and raw-value ratchets remain current debt; they are not patterns to extend.

### Render/delivery model — OWNERSHIP CONVERGED; TRANSPORTS INTENTIONALLY DISTINCT

The canonical manifest records three current delivery modes:

- `spa-section` — core sections rendered inside the persistent dashboard document;
- `fragment` — full documents on direct load plus `/dashboard/_content` fragments during client navigation;
- `worker-document` — Telegram documents served by the Bot Worker.

These modes share route, chrome, navigation, and shell ownership. A migration may converge transport later, but there is no second semantic route model or shell.

### Legacy redirects — MANIFEST-OWNED AND RETAINED

- Legacy dashboard path aliases and `?nav=` redirects live in `dashboard-routes.ts`.
- Serving Workers derive behavior from the manifest, with parity tests and legacy-route telemetry.
- Redirect removal remains deferred until operational evidence supports it.

### Public viewer — ONE IMPLEMENTATION, CURRENTLY POLISHED

- `packages/shared/src/site-render.ts` renders the creator public destination.
- `site-shell.css` owns its responsive visual system.
- Current sections include Home, Leaderboard, Rewards, Games, site-scoped My Credits, and a separate global `/me` account/sites surface.
- Current public labels and routes remain implementation truth until target viewer capabilities exist.
- Recent viewer waves established shared chrome, truthful auth/empty states, responsive behavior, and creator branding without a parallel renderer.

### Site Settings — ONE OWNER

- The canonical Site Settings body is the Site surface rendered from `apps/leaderboard/src/pages/dashboard.jsx`.
- Its creator customizer owns name, tagline, logo, accent, typography, social links, public-section visibility, URL/domain controls, and real-viewer preview.
- Preview uses `renderSite()` through an ownership-checked endpoint.
- Site Settings → Connections is a separate fragment route, not a second Site Settings implementation.

## Current Major Surfaces

| Surface | Current route/implementation reality |
|---|---|
| Home | Account-scoped dashboard route with selected-site context carried by current navigation state |
| Sites collection | Account-scoped `/dashboard/leaderboards` |
| Leaderboard editor | Site-scoped SPA route family under `/dashboard/leaderboard` |
| Site Settings | Site-scoped `/dashboard/site` plus separate Connections fragment |
| Rewards | Site-scoped fragment route family under `/dashboard/rewards` |
| Audience/Members | Site-scoped `/dashboard/audience/members` |
| Analytics | Site-scoped SPA route family under `/dashboard/analytics` |
| Telegram | Account-scoped Bot Worker documents under `/dashboard/telegram*` |
| Account settings | Account-scoped fragment routes under `/dashboard/settings` |
| Public creator destination | `renderSite()` via apex slug routes and custom-domain routes |

Target Community, Activities, People, Insights, Recognition, Communication, My Community, and My Communities are not current route/surface claims merely because the target architecture names them.

## Worker and Runtime Topology

- `apps/leaderboard` owns the apex application, public creator sites, auth, most dashboard routes, APIs, and the homepage proxy boundary.
- `apps/bot` owns Telegram dashboard documents, bot/webhook/redirect/postback routes, and scheduled Telegram work.
- `apps/consumer` drains queue-backed analytics/conversion/notification work.
- `apps/monitor` performs uptime checks.
- Workers share Supabase/Postgres infrastructure through Hyperdrive and use Postgres-backed sessions.
- `apps/web` remains the proxied marketing homepage only.

## Current Identity and Scope Facts

- Creator/operator accounts, viewer accounts, `site_members`, leaderboard player rows, and Telegram subscriber relationships are distinct current records.
- Dashboard route scope is explicitly `account` or `site`.
- Current site navigation uses both `board` and `siteId` query spellings by delivery family.
- No target identity/membership consolidation or parameter normalization has been implemented.

## Known Technical Debt / Deferred Work

| Finding | Current status |
|---|---|
| Current rail labels/grouping predate the target IA | Migration work, not Wave 0 |
| Three delivery transports remain | Intentional current state; ownership is already singular |
| `board` and `siteId` both carry selected-site context | Separate parity-tested migration if changed |
| `devin-system.css` still shapes authenticated page-body material | Accepted cascade debt; no competing `--ws-*` owner |
| Legacy `v3-*`/`v4-*` names and raw-value ratchets | Existing debt; do not extend |
| Legacy route aliases | Retained pending telemetry evidence |
| Viewer/site membership expansion | Target only; schema and migration deferred |
| Shared Activity / Review / Claims persistence | Deferred until real reuse and migration safety are proven |
| Billing terms/providers/enums | Separate reconciliation required |
| Restricted legacy route families | Operational current implementation; excluded from target architecture work |
