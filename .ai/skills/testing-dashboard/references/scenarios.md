# Testing the YourRank dashboard: detailed scenarios

Companion to `../SKILL.md`.

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
- The shared account menu renders a `<form class="gm-logout-form" action="/logout?next=<current-path>" method="POST">`.
  `apps/leaderboard/src/assets/shell-nav.js` intercepts the form submit in capture phase,
  POSTs to the form's `action`, and **only** after a successful server response sets
  `localStorage.setItem("yr:logout", String(Date.now()))`. On failure it keeps the user
  signed in, re-enables the button, and sets a `title` failure message; it does not
  broadcast. `dashboard.js`, `credits.js`, and `giveaways.js` listen for the `storage`
  event key `yr:logout`, clear the in-memory session, and redirect to
  `/login?next=<current-path>`.
- The Telegram bot dashboard uses the same shared account menu (`logoutAction: "/bot/auth/logout"`)
  and loads `shell-nav.js`, so its logout also broadcasts `yr:logout` and invalidates
  the same creator dashboard session. `apps/bot/src/dashboard-views/client-script.ts`
  keeps a fallback `logout()` that broadcasts as well in case `shell-nav.js` is absent.
- Two-way cross-tab sign-out test:
  1. Open the dashboard SPA at `/dashboard` in Tab A and a standalone page
     (`/dashboard/rewards/redemptions`, `/dashboard/audience/members`, or `/dashboard/giveaways/chat`)
     in Tab B.
  2. Sign out from the SPA → Tab B must redirect to `/login?next=<its-path>`.
  3. Sign back in, then sign out from the standalone page → Tab A must redirect to
     `/login?next=/dashboard`.
  4. Verify no `SyntaxError`, `ReferenceError`, `TypeError`, or duplicate redirects,
     and that the `next` path is preserved (including `siteId` when present).
- Creating test accounts quickly can hit the per-account login rate limit
  (`login-email:<email>` 10/15min and `login:<ip>` 20/10min). Reuse an existing
  session token or sign up another user to avoid the login rate limit.
- `SECURE_HTML` headers include `Strict-Transport-Security` and `upgrade-insecure-requests`.
  When running `wrangler dev` over plain HTTP, the shared `shell-nav.js` logout
  `fetch('/logout')` follows the 302 to `/login`, but Chrome upgrades the redirect
  target to `https://localhost:8787` (which has no TLS listener) and the Promise
  never resolves. Workaround: start the Worker with `--local-protocol https` and a
  self-signed certificate, and relaunch Chrome with `--ignore-certificate-errors`.
- Standalone pages (`/dashboard/rewards/*`, `/dashboard/audience/members`,
  `/dashboard/giveaways/*`) must accept the `activePath` prop (which already
  includes `url.search`) instead of recomputing a query-less path. As of the
  Phase 4C fix, they pass `activePath` to `DashboardShell`, so the shared logout
  form's `?next=` now preserves a `?siteId=...` query on the signing-out tab.
  Verify both the signing-out tab and the receive tab include `siteId` in the
  final `/login?next=` URL.

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
