---
name: Testing the YourRank dashboard locally
description: |
  How to run the YourRank leaderboard Worker locally, create a test account, and drive the redesigned dashboard UI for end-to-end testing.
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

## Testing the canonical apex frontend + marketing homepage proxy

The apex Worker (`apps/leaderboard`) proxies `/` and `/_next/*` to the
`apps/web` marketing Worker via the `MARKETING` service binding. To exercise
that proxy locally both Workers must run in one Wrangler session:

```bash
export PATH="$HOME/.nvm/versions/node/v22.12.0/bin:$HOME/.local/bin:$PATH"
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgresql://postgres:postgres@localhost:5432/yourrank"
export DATABASE_URL="$CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE"
npx wrangler dev -c apps/leaderboard/wrangler.toml -c apps/web/wrangler.toml --port 8787
```

Build `apps/web` first (`opennextjs-cloudflare build`) so `.open-next/worker.js`
exists. Check the startup banner: `env.MARKETING (yourrank-web) ... [not connected]`
means the proxy will return 503.

Gotchas that cost time here:

- `npx bun ...` and `npx opennextjs-cloudflare ...` may fail with
  `npm error could not determine executable to run`. Use the local binaries
  instead: `/home/ubuntu/.local/bin/bun` and
  `apps/web/node_modules/.bin/opennextjs-cloudflare`.
- The installed `workerd` may reject `apps/web`'s `compatibility_date`
  (e.g. "supports up to 2026-07-07"). Temporarily lower the date in
  `apps/web/wrangler.toml` to run locally and revert before reporting; never
  commit that change.
- `wrangler dev` derives the request Host from the config's `routes`, so the
  incoming `Host:` header is ignored. Consequences:
  - Worker redirects built with `new URL("/login", url)` come back as absolute
    `http://yourrank.site/...` on localhost and the browser leaves your local
    server. Verify redirect *paths* with `curl -w '%{redirect_url}'` instead.
  - To prove the `apps/web` middleware host gate, run the web Worker twice:
    default (`Host` becomes `app.yourrank.site`, unmarked ⇒ 301) and with
    `--host yourrank.site` (unmarked ⇒ 200).
  - A marked request bypasses the redirect:
    `curl -H 'x-yr-marketing: 1' http://127.0.0.1:8788/`.
- Failure path: run a leaderboard-only `wrangler dev` on another port. Kill all
  `workerd` processes and `rm -f ~/.config/.wrangler/registry/*` first, or a
  stale registered `yourrank-web` will still satisfy the binding and you will
  see 200 HTML instead of the expected plain `503 marketing service unavailable`.
- Tailwind v4 in `apps/web` auto-detects sources relative to
  `src/app/globals.css`, so classes used only in `src/components/**` can be
  missing from the built CSS and the homepage renders unstyled while all
  `/_next/static/*` assets still return 200. Verify visually, and check the
  built CSS directly:
  `grep -c 'text-center' apps/web/.open-next/assets/_next/static/chunks/*.css`.
  Adding `@source "../components";` after `@import "tailwindcss";` is the likely fix.
- The dashboard sidebar account menu (sign out) opens *below* the fold in a
  1024x768-scaled viewport. Zoom the page out (`ctrl+minus` twice) to reach it.
- When typing passwords with the `computer` tool, `!` can be dropped by
  `type`; send it as a separate `key` action (`exclam`) and use the eye toggle
  to confirm the field contents.

## Testing browser history / Back / Forward on the dashboard SPA

Each dashboard section is served as its own document, so the trail is made of
real navigations — and any iframe on the page contributes to the same joint
session history: the editor's live preview (a form POST into `designPreview`)
and the Mini-games simulator each append an entry unless the frame is navigated
without pushing. Screenshots alone cannot prove history correctness because the
URL and the rendered section can agree while the history *stack* has been
corrupted. Always dump the real stack:

```python
# needs: pip install websocket-client ; Chrome started with --remote-debugging-port
import json, urllib.request, websocket
ts = [x for x in json.load(urllib.request.urlopen("http://localhost:29229/json/list"))
      if x.get("type") == "page"]
t = [x for x in ts if x["url"].endswith("/dashboard/editor/players")][0]
ws = websocket.create_connection(t["webSocketDebuggerUrl"], timeout=15,
                                 suppress_origin=True)  # suppress_origin avoids
                                                        # --remote-allow-origins
ws.send(json.dumps({"id": 1, "method": "Page.getNavigationHistory"}))
while True:
    m = json.loads(ws.recv())
    if m.get("id") == 1:
        r = m["result"]
        for i, e in enumerate(r["entries"]):
            print(i, e["url"], "<== CURRENT" if i == r["currentIndex"] else "")
        break
```

What to look for, and how to test it:

- Build the trail by *clicking the sidebar* in a brand-new tab, then press Back
  once and dump the stack. A healthy stack keeps the forward entry and moves
  `currentIndex` back by one. Symptoms of the known bug class: the forward entry
  is replaced by a duplicate of the current URL and `currentIndex` sits on the
  *last* entry, which silently kills the browser Forward button.
- Cross-check visually by zooming the toolbar (`zoom` region around
  `[0,28,220,54]`): a greyed-out Forward arrow after a single Back press is the
  user-visible symptom.
- Test both a route that embeds an iframe (editor, mini-games) and one that does
  not (giveaways → rewards): a frame-navigation bug only shows when Back lands
  *on* the page owning the frame, so a giveaways-only trail can pass while the
  editor trail fails. Never generalize from one route pair.
- Chrome reports frame navigations via `Page.frameRequestedNavigation`
  (`reason: formSubmissionPost` / `scriptInitiated`); a frame navigation right
  after Back that is not `initialFrameNavigation` is what truncates the forward
  stack.
- Beware test-harness noise that looks like a product bug: omnibox autocomplete
  can append a stale `?board=<old-uuid>`, producing a real `404 /api/site?siteId=…`
  and a "Couldn't load your board" screen. Always press `Delete` after `type`
  in the address bar to dismiss the autocomplete suggestion.
- Only the *last* screenshot of a multi-action `computer` call is returned, so
  take one screenshot per call when verifying a step-by-step Back/Forward walk.
- In-page tab strips on Giveaways and Settings do **not** change the URL, so
  Back cannot restore the previously selected tab and the tab is not
  deep-linkable. Analytics tabs *do* push real URLs. Confirm which behaviour is
  intended before filing it as a defect.

## Public board pages under `wrangler dev`

`site-routes.js` builds public nav hrefs from `url.origin` (`const homeUrl =
url.origin;`). Because `wrangler dev` forces the origin to the configured route
host, the local public pages emit absolute `http://yourrank.site/...` links, so
clicking the public sidebar navigates to *production* and 404s. This is a
local-dev artifact, not a product bug — verify public sections by entering
`localhost:8787/<slug>[/shop|/me]` directly, and confirm the href source with:
`curl -s http://localhost:8787/<slug> | grep -oE 'href="[^"]+"' | sort -u`.

## Collapsed sidebar rail (v4 shell)

The v4 dashboard shell (`src/pages/dashboard-shell.jsx` +
`src/assets/dashboard-v4.css`) has a collapsible rail. Key handles:

- Toggle: `.lb-side-collapse[data-collapse-side]` (`aria-label` flips between
  "Collapse navigation" and "Expand navigation").
- Persistence: `localStorage` key `yr-side-collapsed`; root gets
  `data-side-collapsed="true"` on `.v3-dash[data-auth-workspace]`.
- Collapsed state must only redefine `--v3-sidebar-w: 44px`. If a rule ever sets
  `width`/`height`/`overflow` on the shell root itself, the whole dashboard
  renders as a ~44x40 blank box. `src/__tests__/css-integrity.test.js` guards
  this; re-check it after touching the collapsed block.
- After editing CSS/JS under `src/assets/`, run `cd apps/leaderboard && node build.js`
  to regenerate `src/assets_bundled.js`, then confirm freshness with
  `grep -c -- '--v3-sidebar-w: 44px' apps/leaderboard/src/assets_bundled.js`.
- Verify the regression by collapsing, reloading, and visiting several routes —
  not just Home. Known-good route set: `/dashboard`,
  `/dashboard/leaderboard/setup`, `/dashboard/giveaways/chat`,
  `/dashboard/rewards/redemptions`, `/dashboard/settings`.
- `.lb-nav-group-label` is taken out of view (not removed) when collapsed so the
  group keeps its accessible name; a visible clipped "ENGAGE" text means the
  collapsed block regressed.

## Other topbar / nav handles

- `#topbarCmdTrigger` (⌘K / Ctrl+K palette; Esc closes), `#newBoard`
  (create-another-site "+"), `#publishAction` (publish, opens a confirm dialog
  with a `Publish` button), `#lbMenu` (mobile drawer toggle below 981px).
- On a Free plan at the site limit, `#newBoard` opens an upsell popover instead
  of a create form; that popover may be clipped and may not dismiss on Escape or
  outside click.

## Known route/state defects to expect (not caused by UI changes)

- `/dashboard/telegram*` is served by the **bot** Worker (see the zone routes in
  `apps/bot/wrangler.toml`), not the leaderboard Worker, so it returns 404 on
  `localhost:8787` while working in production. Test it against the bot Worker on
  `localhost:8788` instead of filing it as a routing bug.
- Leaderboard → Share offers an OBS overlay URL (`/<slug>/overlay`) with no Pro
  badge, but the overlay page itself renders "This is a Pro feature." on Free.
- Adding a player with only name+amount can persist a derived
  `net profit = -amount`; verify whether that is intended before filing.

## Auth / authorization regression testing

- `handlePutSite` Zod schema in `packages/shared/src/validation.ts` must accept
  `startsAt` and `rankBy` (sent by `collect()` in `apps/leaderboard/src/assets/dashboard/site.js`);
  without them, every editor save returns `400` before auth/403/409 branching can run.
- Editor save error branching lives in `apps/leaderboard/src/assets/dashboard/site.js`:
  - `err.code === "AUTH"` → session-ended message, draft preserved, no redirect.
  - `err.code === "FORBIDDEN"` → role permission message, draft preserved.
  - `err.code === "concurrency_conflict"` / `err.status === 409` → reconciliation message.
- `request.js` classifies `401` as `AUTH` and `403` as `FORBIDDEN`; dynamic-section
  loader (`dynamic-section.js`) redirects on `401` and renders the server error in
  the `#lbDynamic` region on `403`.
- The dashboard sign-out button in the account menu is a `<button class="gm-logout">`
  inside a `<form action="/logout" method="POST">`; `site.js` wires `$("logout")`
  which is not present in the DOM, so the form POST is used instead. That POST
  clears the server session and redirects the active tab to `/login` but does **not**
  set the `yr:logout` `localStorage` stamp, so other open tabs are not notified.
- To test cross-tab sign-out manually, open a second tab on the same origin and run
  `javascript:localStorage.setItem('yr:logout', Date.now()); void 0;` — the dashboard
  listener (`window.addEventListener("storage", ...)`) will then redirect all tabs
  to `/login?next=<current-path>`. `localStorage` changes made from CDP-created
  background targets do not always fire the `storage` event in other tabs, so use a
  real second browser tab for this flow.
- Creating test accounts quickly can hit the per-account login rate limit
  (`login-email:<email>` 10/15min and `login:<ip>` 20/10min). Reuse an existing
  session token or sign up another user to avoid the login rate limit.

## Collecting console errors and Worker 4xx/5xx

- The wrangler dev log is at `/tmp/wrangler-leaderboard.log` (also
  `/home/ubuntu/leaderboard-dev.log`). Extract failures with:
  `grep -E '\b(4[0-9][0-9]|5[0-9][0-9])\b' /tmp/wrangler-leaderboard.log | tail -30`
- `fonts.googleapis.com` requests always fail in this sandbox (no external
  egress). Treat `responseStatus: 0` for those as environmental, not a defect.

## Distinguishing legitimate empty states from defects

Seeded data covers players, shop items and viewer balances but not events or
raffles. `"No events yet"` with populated KPI cards above it, and
`"No past raffles yet."`, are legitimate. To investigate a suspected styling
defect, first resolve which class the rendered markup actually uses, then
check the served stylesheet for a rule matching that class. For example:

```bash
curl -s http://localhost:8787/assets/<served-stylesheet>.css \
  | grep -c '<resolved-class-selector>'
```

The giveaway history tables were a past example of this class of defect: their
markup used an unstyled table class until the markup was switched to the
canonical table classes. Always verify the current rendered class and served
CSS rather than relying on an old source-level claim.
