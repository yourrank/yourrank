# YourRank — URL Map & Cloudflare Routing (two Workers, one zone)

`yourrank.site` is one Cloudflare zone with **two Workers** attached by route
pattern. Cloudflare dispatches each incoming request to exactly one Worker based
on the **most specific matching route**. Everything else (session cookie, DB) is
shared as described in the other specs.

---

## 1. URL map

### → LEADERBOARD Worker (the default / catch-all app)
| Path                    | Purpose                                   |
|-------------------------|-------------------------------------------|
| `/`                     | landing page                              |
| `/login`, `/signup`     | auth screens (password; Telegram link too)|
| `/logout`               | destroy `yr_session`, clear legacy cookies |
| `/dashboard`            | unified dashboard                         |
| `/dashboard?nav=growth` | Analytics section                         |
| `/dashboard?nav=manage` | Plan & billing section                    |
| `/api/*`                | leaderboard's own JSON API                |
| `/assets/*`             | leaderboard static assets                 |
| `/go/<slug>`            | public "join" click-through / redirect    |
| `/<slug>`               | **public leaderboard pages** (catch-all)  |

### → BOT Worker
| Path                | Purpose                                        |
|---------------------|------------------------------------------------|
| `/dashboard/telegram` | unified dashboard — **Telegram bot tab**     |
| `/dashboard/telegram/*` | Telegram bot pages                        |
| `/bot/dash/api/*`   | bot dashboard JSON API                         |
| `/hook/*`           | Telegram webhook (per-bot secret)              |
| `/r/*`              | tracked affiliate redirect                     |
| `/pb`, `/pb/*`      | conversion postbacks                           |

---

## 2. Exact Cloudflare route patterns

Routes are configured per Worker (in each `wrangler.toml`, or in the dashboard →
Workers Routes). List the **specific** ones on the bot Worker and let the
leaderboard Worker take the **catch-all**.

### Bot Worker — `apps/bot/wrangler.toml`
```toml
routes = [
  { pattern = "yourrank.site/bot",           zone_name = "yourrank.site" },
  { pattern = "yourrank.site/bot/*",         zone_name = "yourrank.site" },
  { pattern = "yourrank.site/dashboard/telegram*", zone_name = "yourrank.site" },
  { pattern = "yourrank.site/hook/*",        zone_name = "yourrank.site" },
  { pattern = "yourrank.site/r/*",           zone_name = "yourrank.site" },
  { pattern = "yourrank.site/pb",            zone_name = "yourrank.site" },
  { pattern = "yourrank.site/pb/*",          zone_name = "yourrank.site" },
]
```

### Leaderboard Worker — `apps/leaderboard/wrangler.toml`
```toml
routes = [
  { pattern = "yourrank.site/*",     zone_name = "yourrank.site" },
  { pattern = "www.yourrank.site/*", zone_name = "yourrank.site" },  # redirect to apex in-Worker
]
```

Also add `yourrank.site` and `www` as zone DNS + the workers routes; the apex
`A`/`AAAA`/`CNAME` should be proxied (orange cloud) so Workers routes apply.

---

## 3. Precedence — the gotcha

**Cloudflare routes are matched most-specific-first.** A request to
`yourrank.site/dashboard/telegram` matches *both* `yourrank.site/dashboard/telegram*` (bot) and
`yourrank.site/*` (leaderboard). Cloudflare picks the **longer / more specific**
pattern → the bot Worker. The leaderboard's `/*` only wins when no bot pattern
matches.

Rules that keep this unambiguous:
1. The leaderboard Worker owns exactly one broad pattern: `yourrank.site/*`.
2. Every bot path is a **distinct top-level prefix** (`/bot`, `/hook`, `/r`,
   `/pb`) so `/prefix/*` is strictly more specific than `/*`.
3. **Never** give the bot Worker a bare `yourrank.site/*` — that would make
   dispatch order-dependent and non-deterministic. Only the leaderboard gets the
   wildcard.
4. Confirm after deploy: `curl -sI https://yourrank.site/hook/x` must hit the bot
   Worker, `curl -sI https://yourrank.site/anything-else` the leaderboard.

> Note: `*` in a Worker route matches across `/` (it is not a single path
> segment). So `yourrank.site/bot/*` covers `/bot/dash/api/*` **and**
> `/bot/dash/api/offers`. Good — one pattern per bot prefix suffices.

---

## 4. Path collisions between the two apps — flagged & resolved

The two apps were written standalone; several paths overlapped. All resolved by
**namespacing every bot route under `/bot` except the four public webhook/redirect
prefixes** that are already unique.

| Collision                        | Before (both apps)                         | Resolution |
|----------------------------------|--------------------------------------------|------------|
| **`/dashboard/telegram`**        | leaderboard catch-all and bot dashboard          | Bot claims the more-specific `/dashboard/telegram*` route. |
| **Bot API `/dash/api/*`**        | bot only, but sits at root                  | Move to **`/bot/dash/api/*`** so it's inside the bot route prefix. Update the dashboard client's `fetch('/dash/api'+path)` → `fetch('/bot/dash/api'+path)`. |
| **Bot `/auth/*`** (telegram/dev/logout) | bot root `/auth/telegram`, `/auth/logout` | Fold into the merged auth. Telegram-login endpoint moves to **`/bot/auth/telegram`** (still under the bot route) *or* is served by the leaderboard's `/login` page which hosts the widget. Logout is unified at leaderboard **`/logout`**; drop the bot's `/auth/logout`. |
| **Bot root redirect `/` → `/dashboard`** | bot's `app.get("/", redirect)` | **Remove.** `/` is the leaderboard landing page. The bot Worker no longer owns `/`. |
| **`/api/*`**                     | leaderboard `/api/*` and bot admin `/api/*` | Leaderboard keeps `/api/*`. Bot admin API moves under **`/bot/api/*`** (still x-api-key gated). |
| **`/health`**                    | both define `/health`                       | Bot's `/health` moves to **`/bot/health`** (inside its route). Leaderboard may keep `/health`. |
| **`/r/<slug>` vs `/<slug>`**     | bot `/r/:slug` redirect vs leaderboard catch-all `/<slug>` | No real collision: `/r/*` is a distinct prefix routed to the bot; `/<slug>` (single segment, not starting with a reserved prefix) stays with the leaderboard. Ensure `r`, `go`, `bot`, `hook`, `pb`, `billing` are in the leaderboard's **RESERVED** slug set so no one registers a public leaderboard slug that shadows a route. |
| **`/go/<slug>`**                 | leaderboard only                            | Stays on leaderboard (`/go` is not a bot prefix). Add `go` to RESERVED (already present). |

### RESERVED slug set update (leaderboard `auth.js`)
The existing `RESERVED` set already lists `go`, `api`, `assets`, `login`,
`signup`, `logout`, `dashboard`, `admin`, `account`, `billing`. **Add the bot
prefixes** so a public leaderboard slug can never collide with a bot route:
```
add: "bot", "hook", "r", "pb", "health"
```
(`billing` remains reserved for the leaderboard billing paths.)

---

## 5. Same-origin = no CORS

All of the above are on `yourrank.site`. The dashboard shell's Bot tab is a
plain navigation from `/dashboard` → `/dashboard/telegram` (same origin), and the bot
dashboard's own client fetches to `/bot/dash/api/*` are same-origin too. **No
CORS headers are needed anywhere.** The only cross-*Worker* boundary is which
script Cloudflare runs; the browser sees one origin throughout. This is why the
"inject a shared header" shell (see `dashboard-shell.md`) works without any
cross-origin plumbing.

---

## 6. Post-deploy verification checklist
```
curl -sI https://yourrank.site/                 # -> leaderboard
curl -sI https://yourrank.site/dashboard        # -> leaderboard (Leaderboard tab)
curl -sI https://yourrank.site/some-streamer     # -> leaderboard public page
curl -sI https://yourrank.site/dashboard/telegram # -> bot (Telegram tab)
curl -sI https://yourrank.site/hook/abc          # -> bot (401 without secret = correct)
curl -sI https://yourrank.site/r/xyz             # -> bot (302 redirect or 404)
curl -sI https://yourrank.site/pb                # -> bot
curl -sI https://yourrank.site/pb/key            # -> bot
```
Then log in on `/dashboard`, click the **Bot** tab, and confirm no second login
is required — that proves the shared `yr_session` cookie + Postgres `sessions`
table are wired right.
```
