---
name: testing-rewards-engagement
description: End-to-end runtime testing notes for the rewards, engagement, drops, raffle and tournament flows in the leaderboard Worker. Use when verifying those flows behave truthfully.
---

# Testing YourRank rewards, engagement and tournaments

## Environment

- Worker: `apps/leaderboard` (`wrangler dev` on `http://localhost:8787`).
- Database: Postgres via Docker Compose.
- Auth: streamer demo login at `/auth/demo` requires `ALLOW_DEMO_LOGIN=true` in `apps/leaderboard/.dev.vars`.
- Viewer auth: there is no local OAuth; seed `viewers` + `viewer_sessions` rows and inject the `yr_viewer` cookie.

## Devin Secrets Needed

None for local demo testing, but `apps/leaderboard/.dev.vars` must contain:

```ini
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgresql://postgres:postgres@localhost:5432/yourrank
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/yourrank
SESSION_COOKIE_DOMAIN=localhost
ENVIRONMENT=development
ALLOW_DEMO_LOGIN=true
DEMO_USER_EMAIL=demo@yourrank.site
```

## Running the worker

```bash
export PATH="$HOME/.nvm/versions/node/v22.12.0/bin:$PATH"
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgresql://postgres:postgres@localhost:5432/yourrank"
export DATABASE_URL="$CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE"
bun run --cwd apps/leaderboard dev
```

Wrangler logs to `/tmp/leaderboard-dev.log` if you start it with `> /tmp/leaderboard-dev.log 2>&1`.

## Seeding a streamer session for API testing

```bash
curl -c /tmp/yr-cookies.txt -i -L http://localhost:8787/auth/demo
CSRF=$(awk '/\t__csrf\t/{print $7}' /tmp/yr-cookies.txt)
YSESSION=$(awk '/\tyr_session\t/{print $7}' /tmp/yr-cookies.txt)
```

The `yr_session` cookie is HttpOnly; keep `/tmp/yr-cookies.txt` for `curl -b` calls and echo the `__csrf` value in `x-csrf-token`.

## Seeding a viewer session for `/me` and public-shop testing

1. Generate a 32-byte hex raw token and SHA-256 hash it.
2. Insert a `viewers` row, an optional `site_viewers` row, and a `viewer_sessions` row.
3. Inject both `yr_viewer=<rawToken>` and `__csrf=<random>` cookies via CDP (or manually in the browser).
4. The `api` helper reads `__csrf` from `document.cookie` and sends it as `x-csrf-token`.

## Driving the UI

- The `computer` tool coordinate space (1024x768) can miss small buttons; fall back to CDP `Runtime.evaluate` or `javascript:` URLs in the omnibox for precise clicks.
- Public site uses `data-redeem` buttons and native `confirm()`; `/me` uses `showConfirmModal`.
- `/me` IDs to script: `vd-login-card`, `vd-boards`, `vd-site-card`, `vd-site-balance`, `vd-shop-list`, `vd-redemptions-list`, `vd-drop-claim`, `vd-drop-code`, `vd-drop-claim-btn`, `vd-drop-status`.
- Tournament dashboard IDs: `tournament-app`, `tournament-empty`, `tournament-list-card`, `tournament-settings`, `tournament-bracket-card`, `tournament-champion`.

## Resolved Phase 6 runtime issues

These were found during browser-based testing of PR #607 and fixed in `feat/phase6-rewards-engagement-ux`:

- **Public shop 500**: `site-data.js` selected `image_url`, but `shop_items.image_url` was removed as part of the media-storage decision. Fix: drop `image_url` from the public shop `SELECT`.
- **Viewer redeem 400/500**: `handleViewerRedeem` body validation rejected `idempotencyKey` and `withHandler` consumed `request.json()`. Fix: add `idempotencyKey` to the Zod schema, rebuild `packages/shared`, and read `request.validatedBody` in the handler.
- **Drop claim 500**: `handleClaimCodeDrop` inserted `credit_ledger.type = 'reward'`, violating the `credit_ledger_type_check` constraint. Fix: use `type = 'earn'`.
- **Completed tournament hidden**: `assets/tournaments.js` filtered out `completed`/`cancelled` tournaments, so the bracket and champion disappeared on reload. Fix: prefer an active tournament but fall back to the most recent finished one, and render it read-only.

## API snippets

Create a drop:

```bash
curl -b /tmp/yr-cookies.txt -H "x-csrf-token: $CSRF" -X POST \
  http://localhost:8787/api/events/drops \
  -H "content-type: application/json" \
  -d '{"siteId":"<demo-board-id>","code":"TESTDROP","pointsReward":50,"maxClaims":10,"expireMinutes":10}'
```

Create and seed a tournament:

```bash
curl -b /tmp/yr-cookies.txt -H "x-csrf-token: $CSRF" -X POST \
  http://localhost:8787/api/tournaments \
  -H "content-type: application/json" \
  -d '{"siteId":"<demo-board-id>","title":"E2E","bracketSize":8,"participants":["Alice","Bob","Carol","Dave","Eve","Frank","Grace","Henry"]}'
```

Score a match:

```bash
curl -b /tmp/yr-cookies.txt -H "x-csrf-token: $CSRF" -X POST \
  http://localhost:8787/api/tournaments/<tournament-id>/score \
  -H "content-type: application/json" \
  -d '{"matchId":"<match-uuid>","player1Score":2,"player2Score":1}'
```

## Mobile viewport

Use CDP `Emulation.setDeviceMetricsOverride` with `width: 375, height: 812, deviceScaleFactor: 2, mobile: true` and capture screenshots; the public shop and `/me` render without horizontal overflow.

## Hostile-QA checklist for engagement lifecycles

Learned during the Phase 2 runtime audit. Always include these cases; they surface real bugs:

- **Zero-participant lifecycles.** Draw a raffle with 0 tickets, settle a prediction with 0
  bettors, open tournament signups with no entrants. A correct product blocks the action or
  states "no eligible entrants"; a fabricated "WINNER DRAWN" state with a placeholder identity
  ("Verified Viewer", broken avatar) is a bug.
- **Persistence after hard refresh** for every created object *and* for every settings input
  (e.g. the tournament Kick channel input may not persist, while its validation error stays on
  screen and signups can still be opened).
- **Client-vs-server validation mismatch.** Type a negative value into Players → Net profit; the
  client shows "Enter a number from 0 to …" but the value may still be saved and re-rendered.
- **Stale chrome after SPA/back navigation.** `/dashboard/_content` fragment navigation and
  browser Back can leave a stale `<h1>` and breadcrumb from the previous section
  (e.g. Team tab showing "Data"). Check breadcrumb + h1 + sidebar highlight on every nav.
- **Sign out.** `POST /logout` may return 302 and truly destroy the session while the button
  reverts to `title="Couldn't sign out…"` and never redirects. Always verify server state with a
  hard refresh rather than trusting the UI message.
- **Appearance/theme toggle.** It sets `documentElement[data-theme=dark]` + `localStorage
  yr-theme`, but no dashboard stylesheet ships `data-theme` rules — verify with
  `getComputedStyle` before calling dark mode working.

## Multi-Worker surfaces and local gotchas

- `/dashboard/telegram*` is owned by **apps/bot** (`wrangler dev` in `apps/bot`, port 8788);
  the leaderboard Worker 404s it even though its sidebar links there. Run both Workers.
- The bot Worker does not serve `/assets/*`: `app.css`, `shell-nav.css`, `ui.css`,
  `dashboard-v4.css`, `devin-system.css`, `shell-nav.js`, `dialog.js` all 404 on 8788, so the
  Telegram dashboard renders completely unstyled locally. Check `/tmp/wrangler-bot.log` before
  reporting a "visual regression" — it may be a local asset-routing gap or a real production bug.
- Marketing `/` needs `apps/web` built (`bun install` + repo-root
  `node_modules/.bin/opennextjs-cloudflare build`, not `apps/web/node_modules/...`), otherwise
  `/` returns 503 `marketing service unavailable`.
- Wrangler 4.106 may ignore `apps/leaderboard/.dev.vars`; export
  `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` in the shell.
- Account data export needs the `ACCOUNT_EXPORTS` R2 binding; without it
  `POST /api/account/export` returns 503 and the UI shows a bare "Export failed."
- Signup accounts start `email_verified=false`. Publishing/public-board tests may require
  flipping that column in Postgres — call that out as test-environment manipulation.
- Window managers here may refuse widths below ~500 CSS px; use CDP
  `Emulation.setDeviceMetricsOverride` for true 390px mobile checks instead of `wmctrl -e`.

## Forbidden flows

Direct `/bet*`, `/wager*`, and paid-entry URLs should return the public 404 "No leaderboard here" page. The raffle tab is still reachable for streamers (admin UI) but do not exercise ticket-purchase flows.
