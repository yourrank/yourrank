# PROJECT TRUTH

Status: OWNER-REVIEW-REQUIRED
Last owner review: UNSET

This file defines what the product is supposed to be. The current codebase is evidence of the
present implementation, not automatic proof of intended product behavior.

Every line below is marked `[V]` (verified from repository or runtime evidence) or
`[OWNER]` (a product decision the owner must confirm — the agent must not invent it).

## Product

```text
What the product does [V from PRODUCT.md + code]:
  YourRank is a creator/streamer engagement suite: hosted leaderboard sites, a Telegram bot
  product, and a credits/rewards shop, operated from one authenticated workspace.
Primary user [V]: a non-technical streamer/creator operating one or more sites.
Primary jobs-to-be-done [V]:
  - publish and maintain a leaderboard site
  - run engagement events (raffles, drops, predictions, tournaments, chat giveaways)
  - reward viewers with credits/shop redemptions
  - grow and message an audience (Telegram bot, broadcasts, offers)
  - read performance (visitors, referrals, events)
Critical user journeys [V, route-traced]:
  1. signup/login -> create site -> leaderboard setup -> publish -> share
  2. select site -> engagement event lifecycle (create -> run -> draw/settle -> history)
  3. credits -> shop item -> viewer redemption -> fulfilment
  4. audience members -> analytics (activity/referrals/events)
  5. account settings (account/team/billing/connections/data)
  6. Telegram: connect bot -> commands -> offers -> broadcasts
```

## Canonical UI

```text
Canonical application shell/layout [V]:
  apps/leaderboard/src/pages/dashboard-shell.jsx -> DashboardShell (Hono JSX)
  Second, non-canonical shell exists: apps/bot/src/dashboard-views/app.ts (template strings)
Canonical navigation [V]:
  packages/shared/src/dashboard-nav.ts (DASHBOARD_NAV, NAV_OWNER_MAP)
  + packages/shared/src/dashboard-chrome.ts (rail/crumbs rendering)
Canonical design-system/token source [OWNER DECISION REQUIRED]:
  Today three layers declare the same tokens; devin-system.css wins by load order.
  Candidates: apps/leaderboard/src/assets/dashboard-v4.css (literals),
  apps/leaderboard/src/assets/devin-system.css (--devin-* aliases),
  apps/web/src/app/globals.css @theme (separate palette).
Canonical shared component source [V]: packages/shared/src (page-shell, shell-nav,
  dashboard-chrome, dashboard-nav, brand-assets)
Canonical product surfaces/routes [V]: the 11 rail destinations in DASHBOARD_NAV
Accepted visual references/baselines [V]: DESIGN.md (prose only; no token names, no CI gate)
```

## Canonical Architecture

```text
Frontend [V]: Hono JSX server-rendered markup + vanilla ES modules in
  apps/leaderboard/src/assets (persistent shell + fragment navigation via /dashboard/_content).
  apps/web is Next.js 15/OpenNext + Tailwind 4 for marketing only.
Backend [V]: Cloudflare Workers — apps/leaderboard (public site + dashboard),
  apps/bot (Telegram + /dashboard/telegram*), apps/monitor (uptime), apps/consumer (queue).
Database [V]: Supabase/Postgres via `postgres` driver + Hyperdrive; 120 migrations in
  supabase/migrations; 85 tables created by migrations.
Authentication/authorization [V]: server sessions (session rotation + grace),
  currentUser() in the leaderboard Worker; separate dashboard-auth in apps/bot.
Deployment/runtime [V]: Wrangler; zone routes split by path prefix on yourrank.site
  (bot Worker owns /dashboard/telegram*, /bot*, /hook/*, /r/*, /pb*; leaderboard owns the root).
Package manager/toolchain [V]: Bun >= 1.3.0 workspaces (CI pins 1.3.0), Node >= 20,
  TypeScript 5.5.4. `bun run lint | typecheck | test` from the repo root.
```

## Allowed Sources of Truth

```text
Product behavior: PROJECT_TRUTH.md + the repository test suite
Product context: PRODUCT.md (repo root)
UI/visual language: DESIGN.md (repo root) + canonical tokens/components + approved baselines
API/data contracts: packages/shared types + zod validators + supabase/migrations
Dependencies: package.json manifests + bun.lock
Runtime behavior: executed tests, Worker logs, browser evidence
```

## Deprecated / Forbidden

Only identifiers proven obsolete by route/import/build-path or cascade evidence.

```text
Old layouts: none proven yet (DashboardShell is canonical; apps/bot shell is a duplicate,
  not yet retired — retiring it requires re-homing /dashboard/telegram*)
Old dashboards/pages: /docs and /faq Worker pages (removed in PR #617)
Old routes [V, still served as 301s]: /dashboard/billing, /dashboard/attribution,
  /dashboard/security, /dashboard/integrations, /dashboard/manage,
  /dashboard/settings/board, /dashboard/settings/plan, /dashboard/settings/integrations,
  /dashboard/audience/viewers, /dashboard/giveaways/preds, /bot/*, /dashboard/bot/setup
Old components: none proven yet
Old CSS/themes/tokens [V]: the --v3-* namespace (341 refs) is an alias layer with no
  independent meaning; duplicate token declarations exist in dashboard-v4.css and
  devin-system.css under the identical selector
Old services/APIs: none proven yet
Old feature flags: none proven yet
```

Default rule after a completed replacement: DELETE the obsolete path rather than preserving
compatibility layering without a requirement.

## Product Invariants

```text
- Exactly one implementation owns the authenticated dashboard shell.
- Exactly one file declares design tokens for the authenticated workspace.
- Every rail destination is reachable without leaving the persistent shell.
- A visible control either works or does not exist (no decorative controls).
- Money paths (credits debit, redemption, wagering) stay idempotent and non-negative;
  they are only proven by the Postgres-backed CI job, never by a local run.
- Public leaderboard pages stay iframe-embeddable; authenticated pages keep the hardened CSP.
```

## Unknowns

```text
- Which token layer the owner wants as canonical (devin identity vs v4 literals).
- Whether /dashboard/telegram should move into the leaderboard Worker or keep its own Worker
  while rendering the shared shell.
- Whether the workspace should support dark mode at all (a live toggle exists today).
```
