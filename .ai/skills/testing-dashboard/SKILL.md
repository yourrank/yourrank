---
name: testing-dashboard
description: How to run the YourRank leaderboard and bot Workers locally, create a test account, and drive the dashboard UI for end-to-end runtime testing. Use when runtime-verifying dashboard, auth, nav or public board behavior.
---

# Testing the YourRank dashboard locally

The canonical dashboard and all application routes are served by the
`apps/leaderboard` Worker at `yourrank.site`. `apps/web` is not a dashboard or
API frontend; it contains only the animated homepage and is reached through
the apex Worker proxy. Direct `app.yourrank.site` and `next.yourrank.site`
requests redirect to the apex unless they carry the internal marketing proxy
marker. Dashboard, auth, account/settings, public-board, help, admin, and API
testing therefore stays on the Leaderboard Worker.

## Devin Secrets Needed

None for the local flow itself, but the Workers expect `.dev.vars` files under `apps/leaderboard/` and `apps/bot/`. If they are missing, copy the `.dev.vars.example` files and fill in:

- `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`
- `DATABASE_URL`
- `SESSION_COOKIE_DOMAIN=localhost`

For bot dev login, also add to `apps/bot/.dev.vars`:

- `ALLOW_DEV_LOGIN=1`

## Leaderboard environment setup

1. Use Node 22 for `wrangler dev`:
   ```bash
   export PATH="$HOME/.nvm/versions/node/v22.12.0/bin:$PATH"
   ```
2. Export the Hyperdrive local connection string inline when running `wrangler dev`:
   ```bash
   cd /home/ubuntu/repos/yourrank
   export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgresql://postgres:postgres@localhost:5432/yourrank?sslmode=disable"
   ./start-local.sh
   ```
   (If `start-local.sh` blocks on `tail -f` or fails because `$HOME/.n/bin` is not on PATH, start Postgres/migrations separately and run `wrangler dev` directly with the Node 22 `PATH`.)
3. If `apps/leaderboard/src/assets_bundled.js` is missing or stale, rebuild it before the Worker loads:
   ```bash
   cd apps/leaderboard
   node build.js
   ```
## Bot Worker environment setup

1. Start the bot Worker from `/home/ubuntu/repos/yourrank`:
   ```bash
   export PATH="$HOME/.nvm/versions/node/v22.12.0/bin:$PATH"
   cd apps/bot
   npx wrangler dev --port 8788
   ```
2. Add to `apps/bot/.dev.vars`:
   - `SESSION_COOKIE_DOMAIN=localhost`
   - `ALLOW_DEV_LOGIN=1`
3. Bot dashboard will be at `http://localhost:8788/bot/dashboard`.

## Chrome / UI controls

1. Launch the Devin-managed Chrome on display `:0` with CDP on port `29229`:
   ```bash
   chrome_bin=$(ls /opt/.devin/chrome/chrome/linux-*/chrome-linux64/chrome | head -1)
   setsid "$chrome_bin" --no-sandbox --disable-gpu --remote-debugging-port=29229 \
     --user-data-dir="$HOME/.config/google-chrome-for-testing" \
     "http://localhost:8787/dashboard" >/tmp/chrome_cdp.log 2>&1 &
   ```
   The `computer` tool's native click coordinates can miss small targets because the 1024x768 scaled space does not always map to rendered elements under the Chrome-for-Testing banner. As a fallback, use `javascript:` URLs in the address bar (e.g. `javascript:document.querySelector('[data-nav="analytics"]').click(); void 0;`) or the DevTools Protocol.

## Test account and board state

- Create an account at `/signup` (email/password). The app seeds a sample board automatically with `published=false`.
- The dashboard lands on the Board editor for an unpublished board and on Home once `isBoardSetup()` is true (name + players + published).
- To bypass flaky form typing or toggle `published` quickly for UI testing, use a freshly created session and `PUT /api/site`:
  ```bash
  # 1. Insert a raw session for the target user
  raw=$(openssl rand -hex 32)
  hash=$(printf "$raw" | sha256sum | awk '{print $1}')
  docker compose exec -T postgres psql -U postgres -d yourrank \
    -c "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES ('$hash', '<user_id>', now(), now() + interval '30 days');"
  # 2. GET /api/site to check current payload
  curl -sS -H "Cookie: yr_session=$raw" http://localhost:8787/api/site | python3 -m json.tool
  # 3. PUT /api/site (need __csrf cookie + x-csrf-token)
  #    GET /dashboard to read the __csrf cookie, then PUT with `name`, `brand`, `published`.
  ```
- To toggle Free/Paid state for verifying Pro feature cards:
  ```sql
  UPDATE users SET plan='free', has_trial=false WHERE email='...';
  -- or
  UPDATE users SET plan='pro' WHERE email='...';
  ```

## Driving the UI

- Sidebar nav: `[data-nav]` values are `home`, `board`, `performance` (label "Analytics"), `settings`.
- Editor tab bar (`#editorTabs`): `[data-egroup]` values are `setup`, `players`, `design`, `share`, `history`.
- Settings anchors: `#profile`, `#plan`, `#postbacks`, `#data`.
- Bot side nav links are `/bot/dashboard`, `/bot/bots`, `/bot/offers`, `/bot/commands`, `/bot/broadcasts`, `/bot/settings`.
- Account side nav links use hashes `/account#profile`, `#plan`, `#postbacks`, `#data`.
- Home active state key IDs: `ovActiveBento`, `ovBoardStatusWidget`, `ov_prize`, `ov_players`, `ov_resets`, `ovQuickActions`, `ov_copyLink`.
- Copy-link buttons: `#editorCopyLink` (topbar) and `#ov_copyLink` (Next steps).
- Live preview: `#designPreview` iframe is populated by `POST /dashboard/preview` and re-fits via `state.fitDesignPreview`.

## Common gotchas

- `wrangler dev` may fail with “Wrangler requires at least Node.js v22.0.0” when invoked through Bun; prepend the Node 22 path.
- If `assets_bundled.js` is stale, rebuilt assets won't be picked up until the Worker restarts. Stop any running `wrangler dev` process, run `node build.js`, then restart the Worker.
- `loadStats()` in `assets/dashboard/site.js` uses the new KPI IDs. After PR #345, the Analytics page **Activity map** loads correctly: `performance.js` now selects `$('perf-heatmap')`, matching the markup `id="perf-heatmap"`.
- Copy-link buttons now use `flashButton()` and show “Copied!” feedback when the user gesture succeeds.
- `loadStats` and `updateDesignPreview` make authenticated requests; keep the session cookie and CSRF token in sync when testing via `curl`.
- Logging into the bot Worker sets a shared `yr_session` cookie for `localhost`, which can then be sent to the leaderboard Worker on port 8787 and cause the leaderboard dashboard to fail if the bot user has no site. Log out between Workers or use separate browser profiles.
- The bot dashboard client script has been moved to an external same-origin file at `/bot/dash/client.js`, so CSP nonce issues are gone. Verify by checking that `window.load` and `window.showPage` are defined and panels switch correctly.
- To avoid `yr_session` cookie confusion between `localhost:8787` and `localhost:8788`, use a separate incognito window or profile for the bot dashboard; log out between Workers if using the same profile. Navigating from the bot Worker to the leaderboard Worker in the same cookie jar will cause the leaderboard dashboard to fail with "Couldn't load your site."
- Account page **Active sessions** now loads after PR #345. The top-level event wiring in `site.js`, `players.js`, and `credits.js` is guarded with optional chaining so the Account page module graph no longer throws before `loadSessions()` runs.
- Dev login on `/bot/dashboard` requires `ALLOW_DEV_LOGIN=1` and accepts any numeric Telegram user ID.

## Useful paths

- App roots: `/home/ubuntu/repos/yourrank/apps/leaderboard`, `/home/ubuntu/repos/yourrank/apps/bot`
- Dashboard entry: `http://localhost:8787/dashboard`
- Public board: `http://localhost:8787/<slug>`
- Bot dashboard: `http://localhost:8788/bot/dashboard`
- Local DB: `postgresql://postgres:postgres@localhost:5432/yourrank`

## Detailed scenarios

Longer, scenario-specific procedures live in `references/scenarios.md`: apex frontend and
marketing proxy, browser history on the dashboard SPA, public board pages under
`wrangler dev`, collapsed sidebar rail, topbar/nav handles, known route/state defects,
auth/authorization regression testing, console/Worker error collection, and telling
legitimate empty states apart from defects.
