# Project State

Maintained to prevent architecture drift.

**Evidence baseline:** `main` at `6d20b0bea204a56ccd0559c462e8ab01b3ccd32d` (PR #667 merged)

**Last reconciled:** 2026-08-29

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
- The visible rail presents Home, Sites, Community (Site and Leaderboard), People, Rewards, Insights, transitional Engagement and Games, Telegram, and Settings.
- Community is presentation-only; People and Insights are labels over the existing audience and analytics route families. No route ID, URL, scope, owner, or schema changed with those labels.
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

### Community ownership — CONSOLIDATED

- Community remains a presentation grouping over the existing site-scoped Site and Leaderboard routes; it has no parallel router, shell, entity, or persistence model.
- The canonical Site body is rendered from `apps/leaderboard/src/pages/dashboard.jsx` and is the only creator-wide public-identity editor.
- Site owns name, tagline, logo, accent, typography, social links, public-section visibility, URL/domain controls, and real-viewer preview.
- Leaderboard retains Setup, Players, Appearance, Share, and History. Appearance owns only leaderboard-specific columns, layout/blocks, and prize labels; its site-wide identity note links to Site.
- Preview uses `renderSite()` through an ownership-checked endpoint.
- Site → Connections is a separate fragment route, not a second Site implementation.
- Sites remains a top-level account-scoped destination. The selected-site control switches sites and links to Manage Sites, but it is absent from account-scoped pages and does not own the current create-site workflow, so it is not yet a complete replacement.
- Recognition is deferred: the only trustworthy historical result content is the archive data already owned by Leaderboard History and the public Hall of Fame. There is no distinct, moderated cross-capability recognition model to justify another creator destination.

## Current Major Surfaces

| Surface | Current route/implementation reality |
|---|---|
| Home | Account-scoped dashboard route with selected-site context carried by current navigation state |
| Sites collection | Account-scoped `/dashboard/leaderboards` |
| Leaderboard editor | Site-scoped SPA route family under `/dashboard/leaderboard` |
| Site | Site-scoped `/dashboard/site` plus separate Connections fragment |
| Rewards | Site-scoped fragment route family under `/dashboard/rewards` |
| People (Members) | Site-scoped `/dashboard/audience/members` |
| Insights | Site-scoped SPA route family under `/dashboard/analytics` |
| Telegram | Account-scoped Bot Worker documents under `/dashboard/telegram*` |
| Settings | Account-scoped fragment routes under `/dashboard/settings` |
| Public creator destination | `renderSite()` via apex slug routes and custom-domain routes |

Community, People, and Insights are current navigation presentation labels only; they do not imply new route, entity, or persistence boundaries. Target Activities, Recognition, Communication, My Community, and My Communities remain target-only claims.

## Worker and Runtime Topology

- `apps/leaderboard` owns the apex application, public creator sites, auth, most dashboard routes, APIs, and the homepage proxy boundary.
- `apps/bot` owns Telegram dashboard documents, bot/webhook/redirect/postback routes, and scheduled Telegram work.
- `apps/consumer` drains queue-backed analytics/conversion/notification work.
- `apps/monitor` performs uptime checks.
- Workers share Supabase/Postgres infrastructure through Hyperdrive and use Postgres-backed sessions.
- `apps/web` remains the proxied marketing homepage only.

## Current Identity and Scope Facts

- Creator/operator accounts (`users`), viewer accounts (`viewers`), creator-team access (`site_members`), site memberships (`site_viewers`), leaderboard player rows (`players`), and Telegram subscriber relationships (`bot_subscribers`) are distinct current records.
- `viewers` is the current global viewer-account anchor. A provider connection is treated as authenticated only when its OAuth link timestamp is present; names and raw external identifiers are not linkage proof.
- `site_viewers` is the current physical Site Membership record. Its foreign keys and unique `(site_id, viewer_id)` constraint already provide the required scope and uniqueness, so no additive membership table or inferred backfill is justified.
- A site membership is created by an authenticated viewer entering a site context or by a provider-signed channel-reward interaction. Anonymous browsing does not create one, and creator-entered usernames no longer create viewer or membership records.
- People reuses `/dashboard/audience/members` and exposes only selected-site memberships. Detail lookup binds both membership ID and selected site; creator authorization uses the existing site capability boundary.
- Leaderboard Player and Telegram Subscriber records remain unlinked to Viewer Account and Site Membership. No username, display-name, IP, device, or fuzzy matching is used to infer identity.
- Dashboard route scope is explicitly `account` or `site`.
- Current site navigation uses both `board` and `siteId` query spellings by delivery family.
- No player/subscriber identity consolidation or parameter normalization has been implemented.

## Known Technical Debt / Deferred Work

| Finding | Current status |
|---|---|
| Activities boundary is not yet available; mixed Engagement and restricted Games remain explicit transitional destinations | Deferred migration outside Wave B |
| Three delivery transports remain | Intentional current state; ownership is already singular |
| `board` and `siteId` both carry selected-site context | Separate parity-tested migration if changed |
| `devin-system.css` still shapes authenticated page-body material | Accepted cascade debt; no competing `--ws-*` owner |
| Legacy `v3-*`/`v4-*` names and raw-value ratchets | Existing debt; do not extend |
| Legacy route aliases | Retained pending telemetry evidence |
| Viewer/site membership expansion beyond the existing `site_viewers` foundation | Deferred until a proven capability needs additive persistence |
| Recognition destination | Deferred; current archive evidence remains owned by Leaderboard History and the public Hall of Fame |
| Shared Activity / Review / Claims persistence | Deferred until real reuse and migration safety are proven |
| Billing terms/providers/enums | Separate reconciliation required |
| Restricted legacy route families | Operational current implementation; excluded from target architecture work |
