# PROJECT TRUTH

**Status:** ACTIVE — owner-approved target architecture installed by Wave 0

**Owner-approved target:** [`docs/YOURRANK_PRODUCT_ARCHITECTURE.md`](../docs/YOURRANK_PRODUCT_ARCHITECTURE.md)

**Current implementation baseline:** `main` at `e71faab725f322c8aa965398aab941f9fb7a6f5d`

**Last reconciled:** 2026-08-28

This file is the repository authority map. It separates owner-approved target product direction from verified current implementation. Existing code is evidence of the present implementation, not automatic proof of intended product behavior.

## Authority Split

| Question | Canonical source |
|---|---|
| Where is the product going? | `docs/YOURRANK_PRODUCT_ARCHITECTURE.md` |
| What is the concise product context? | `PRODUCT.md` |
| What are current dashboard routes, scopes, aliases, owners, and delivery modes? | `packages/shared/src/dashboard-routes.ts` |
| How are current navigation labels/icons/groups presented? | `packages/shared/src/dashboard-nav.ts` |
| How does the system currently run and deploy? | `ARCHITECTURE.md` plus Worker configuration, code, and tests |
| What has actually converged or remains debt? | `.ai/PROJECT_STATE.md` |
| What visual language applies? | `DESIGN.md` plus canonical token/component owners |
| What are current data/API contracts? | Shared types/validators, `supabase/migrations`, and tests |
| What happens at runtime? | Executed tests, browser evidence, Worker behavior, logs, and production telemetry |

When these sources disagree, record and resolve the disagreement. Do not silently choose the source that makes a task easier.

## TARGET — Owner-Approved Product Direction

> **YourRank is the community operating system for streamers.**

Target creator navigation:

**Home → Community → Activities → People → Rewards → Insights → Settings**

This is a product and information-architecture model, not an instruction to rename current URLs, schemas, APIs, persisted values, or route IDs.

Target boundaries:

- The dashboard is a creator workspace; the public site is a creator destination.
- `Community` is primarily a navigation/product grouping around the selected site. It is not automatically a new database entity.
- Account-scoped and selected-site-scoped state remain explicit.
- `Site` remains the current persisted/domain term until a deliberate migration proves a rename is worthwhile.
- Home remains account-scoped and may show clearly labeled selected-site operational context.
- People is the target site-scoped home for members, reviews, and moderation.
- Rewards remains site-scoped and uses free loyalty-credit/reward semantics.
- Insights begins selected-site scoped; no unsupported global aggregation is implied.
- Settings → Connections owns connection administration. Frequent Telegram operations remain operational until a real generic Community → Communication surface can replace them safely.
- Free / Pro / Team is customer-facing target direction only; billing storage, providers, prices, and recurring/lifetime behavior require separate reconciliation.
- Shared Activity, Review, and Claims persistence is deferred until concrete workflows prove the abstraction and migration safety.

## CURRENT — Verified Implementation Reality

Current route and navigation model:

- `packages/shared/src/dashboard-routes.ts` is the single editable dashboard route-semantics owner.
- `packages/shared/src/dashboard-nav.ts` owns current navigation presentation and derives route paths/ownership from the route manifest.
- Current visible navigation still reflects the implemented pre-target IA. Target labels do not exist merely because this document names them.
- Current routes retain explicit `account` or `site` scope and the existing `board` / `siteId` navigation-state spellings.
- Legacy dashboard aliases and redirects remain manifest-owned current behavior.

Current shell and rendering ownership:

- `packages/shared/src/dashboard-chrome.ts` is the single authenticated shell/chrome structure emitter.
- `packages/shared/src/dashboard-chrome-state.ts` is the single dashboard chrome-state owner.
- `apps/leaderboard/src/pages/dashboard-shell.jsx` is the leaderboard/Hono JSX adapter.
- Telegram remains served by the Bot Worker at `/dashboard/telegram*`, but it renders the shared dashboard chrome instead of a second shell implementation.
- `apps/leaderboard/src/assets/dashboard/shell.js` owns authenticated client navigation.
- The manifest intentionally records three current delivery modes: `spa-section`, `fragment`, and `worker-document`. They share route/chrome ownership but are not the same transport.

Current public/site ownership:

- `packages/shared/src/site-render.ts` is the one public viewer renderer.
- `apps/leaderboard/src/assets/site-shell.css` is the public viewer stylesheet owner.
- The current public viewer exposes Home, Leaderboard, Rewards, Games, creator-scoped **My Community**, and global `/me` as the Viewer Account's **My communities** index. My communities links into each creator-owned surface without duplicating its Rewards or Claims detail. Future Activities, participation, Recognition, and expanded Claims labels must follow real capability.
- Current Site Settings is owned by the canonical dashboard Site surface and previews through the real public renderer. Do not build a second creator-site editor.

Current identity boundaries:

- Creator/operator accounts, viewer accounts, site membership records, leaderboard player rows, and Telegram subscriber relationships are distinct.
- Never merge those identities from matching usernames, display names, network data, or behavioral similarity.
- Any future linkage requires authenticated ownership or equally strong platform-supported proof.

Current runtime foundation:

- Cloudflare Workers: leaderboard/public/dashboard, Telegram bot dashboard/webhooks, monitor, and queue consumer.
- Supabase/Postgres via Hyperdrive, shared Postgres-backed sessions, Bun workspaces, and Wrangler deployment.
- Anonymous public HTML may be cached; viewer-specific/authenticated data must never leak into anonymous cached responses.

## Canonical Design and UI Rules

- Root `DESIGN.md` defines the visual language.
- Authenticated `--ws-*` tokens are defined once in the `ws-token-contract` block of `apps/leaderboard/src/assets/dashboard-v4.css` and enforced by `apps/leaderboard/src/__tests__/tokens.test.js`.
- Existing class-generation names and remaining `devin-system.css` page-body material rules are current debt, not permission to add another token/theme layer.
- Sidebar owns section roots; local subnavigation owns tabs; topbar owns context, search, and actions.
- Every visible control works or does not exist.
- State is truthful, responsive layouts adapt, and public streamer branding remains separate from YourRank product-action styling.

## Restricted Legacy Boundary

The target architecture must not redesign, optimize, debug, extend, consolidate, or use as architectural examples:

- Games;
- wagering or stake mechanics;
- race/wager mechanics;
- predictions;
- paid-chance mechanics;
- raffle mechanics involving credit-ticket purchases and random-value outcomes;
- odds, payout, or settlement behavior;
- gambling-specific Telegram behavior.

Restricted routes may remain operational current implementation. Generic shared shell/documentation work may acknowledge their existence, but they are not target product strategy.

## Migration Invariants

- One canonical dashboard route model.
- One authenticated dashboard shell/chrome structure.
- One navigation presentation owner derived from route semantics.
- One authenticated client-navigation entry point.
- One public viewer renderer and one public creator-branding source.
- Product labels do not automatically require URL changes.
- Account and site scope remain explicit.
- Viewer Account, Membership, Leaderboard Player, and Telegram Subscriber are never silently collapsed.
- Universal Activity, Review, or Claims persistence is not created before evidence proves shared lifecycle, permissions, queries, and migration safety.
- No `*-v2`, `*-new`, `*-final`, parallel theme, parallel route registry, or compatibility fork without an explicit migration requirement.

## Deferred / Unresolved

- Exact billing prices, provider behavior, recurring/lifetime semantics, stored plan values, and entitlement migration.
- Physical schema for shared Activity, Review, Claims, and viewer/site membership expansion beyond the existing `viewers` + `site_viewers` foundation.
- Timing and route details for target Activities and viewer participation/Recognition/expanded Claims surfaces.
- Migration of eligible Telegram operations into a future channel-neutral Communication surface.
- Removal timing for legacy aliases, which requires operational evidence.
