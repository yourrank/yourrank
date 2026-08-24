# Project State

Maintained by the coding agent to prevent architecture drift.
Populated from the Phase 1 forensic audit (static evidence) — Phase 2 runtime findings are
appended as they are verified.

## Canonical Sources

```text
Active app entry:      apps/leaderboard/src/index.js (Worker fetch handler, 1407 lines)
Primary dashboard:     apps/leaderboard/src/pages/dashboard-shell.jsx (DashboardShell)
Navigation:            packages/shared/src/dashboard-nav.ts + dashboard-chrome.ts
Auth:                  session cookies; currentUser() in the leaderboard Worker;
                       apps/bot/src/dashboard-auth.ts for /dashboard/telegram*
Current user:          currentUser(request, env)
API client:            per-feature ES modules in apps/leaderboard/src/assets/*.js (no shared client)
Schema:                supabase/migrations (120 files, 85 tables)
Design system:         CONTESTED — dashboard-v4.css vs devin-system.css vs apps/web @theme
Shared components:     packages/shared/src (page-shell, shell-nav, dashboard-chrome, brand-assets)
```

## Active Major Features

| Feature | Canonical implementation | Notes |
|---|---|---|
| Leaderboard site | `pages/dashboard.jsx` + `assets/dashboard/*` | SPA section, tabs setup/players/design/share/history |
| Engagement | `pages/giveaways.jsx` + `assets/giveaways.js`, `assets/tournaments.js` | fragment section, tabs chat/raffles/drops/predictions/tournaments |
| Rewards/credits | `pages/rewards.jsx` + `assets/credits.js` | fragment section, tabs overview/shop/rules/redemptions/history |
| Audience | `pages/audience.jsx` (+ credits.js boot) | fragment section, single tab |
| Analytics | `assets/dashboard/*` | SPA section, tabs activity/referrals/events |
| Account settings | `pages/account.jsx` + `assets/account.js` | fragment section, tabs account/team/billing/connections/data |
| Telegram | `apps/bot/src/dashboard-views/app.ts` | SEPARATE Worker + second shell implementation |
| Games | `assets/games*` bundle | separate `--gx-*` token domain |
| Marketing | `apps/web` (Next.js) | separate Tailwind `@theme` palette |

## Legacy / Deprecated

| Item | Replacement | Consumers remaining | Removal status |
|---|---|---:|---|
| `--v3-*` token namespace | one canonical token file | 341 refs | not started |
| `v3-*` class names in markup | semantic names | 3052 `v3-dash` + component classes | not started |
| duplicate token block (dashboard-v4.css vs devin-system.css) | one token file | both loaded | not started |
| `app.css` loaded into dashboard documents | scoped workspace base | 6 page modules | not started |
| per-page stylesheet arrays | `page-shell.ts:221` canonical list | 6 page modules | not started |
| legacy dashboard 301s (12) | current IA | unknown traffic | keep until log evidence |
| `/docs`, `/faq` Worker pages | `apps/web` | none | removed (PR #617) |

## Architecture Decisions

| Decision | Why | Context/date |
|---|---|---|
| Persistent shell + `/dashboard/_content` fragments | avoid document reloads between sections | pre-audit |
| Bot Worker owns `/dashboard/telegram*` via zone route | keep Telegram APIs/webhooks colocated | pre-audit |
| Assets inlined into `assets_bundled.js` | Workers have no filesystem | pre-audit |
| Public pages keep permissive CSP | OBS/browser-source embedding | SEC-005-v7 |

## Rejected Approaches

| Approach | Why rejected |
|---|---|
| Adding another CSS override layer to fix design drift | patch stacking; the last-loaded layer already wins and hides edits |
| Creating a `dashboard-v5.css` | forbidden by canonical-implementation rule |

## Known Technical Debt

| Issue | Severity | Intended resolution |
|---|---|---|
| Duplicate token declarations, load-order dependent | Critical | one token file |
| No spacing scale (29 raw px values) / no type scale (20 sizes, half-pixels) | Critical | introduce scales, migrate mechanically |
| Four render models for the dashboard | High | one shell, one navigation model |
| Five routing sources of truth | High | single route table |
| `index.js` monolith (68 path branches) | High | declarative route module |
| No visual-regression / token-lint / browser gate in CI | High | add advisory then blocking |
| Appearance toggle with no dark rules in the workspace skin | Medium | implement or remove |
| Marketing palette diverges from workspace palette | Medium | shared token bridge |

## Temporary Code

| Temporary item | Reason | Removal condition |
|---|---|---|
| legacy dashboard 301 redirects | protect old bookmarks/links | server-log evidence of zero traffic |

## Deferred / Optional Findings

| Finding | Why deferred | Severity | Revisit when |
|---|---|---|---|
| `audit-work/**`, `games-demo.mjs`, `FEATURES_AUDIT.md`, `UI_UX_OPTIMIZATION_PLAN.md` | not runtime code | Low | repo hygiene pass |
| `clicks_default` table unreferenced by code | likely a partition default | Low | partitioning review |
