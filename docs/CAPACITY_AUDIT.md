# YourRank — Production Capacity & Scalability Audit

Repository: `https://github.com/yourrank/yourrank` (audited from the repository checkout, default branch, no files modified)
Method: full static read of the four Workers, `shared/`, 95 SQL migrations, all four `wrangler.toml`, frontend assets, plus verification of Cloudflare/Supabase published limits.
Raw evidence inventory (routes, per-route SQL, schema, indexes, caches, limiters, queues, cron, external services): `inventory.md` next to this file.

**Read this first — the one thing that decides your capacity.** Every visitor on a public board page opens an SSE connection that runs a database query **every 4 seconds** for as long as the tab is open (`apps/leaderboard/src/handlers/public.js:128-142`, clients at `assets/leaderboard.js:293-311` and `assets/overlay.js:145-155`). Nothing else in the codebase comes close: at 1,000 concurrent viewers that is 250 DB queries/second of pure polling, versus ~30 queries/second from all their page loads combined. Your capacity number is not "how many users" — it is "how many browser tabs are open on a board at the same time".

Confidence labels used throughout: **[FACT]** = read directly from this repo or from vendor docs; **[DERIVED]** = arithmetic on facts plus stated assumptions; **[ASSUMPTION]** = a number I had to choose, with the value stated so you can change it; **[UNVERIFIABLE STATICALLY]** = cannot be determined without the Cloudflare/Supabase dashboards or a load test.

---

## 0. Two things I cannot know from the code, and they move the answer by 10x

### 0.1 Your Supabase compute size — **[UNVERIFIABLE STATICALLY]**

Not in the repo. The repo only carries a Hyperdrive binding id (`apps/leaderboard/wrangler.toml:34-38`). Published Supabase sizing **[FACT]**: Micro 2 shared cores/1 GB (60 direct, 200 pooler connections), Small 2 shared/2 GB (90/400), Medium 2 shared/4 GB (120/600), Large 2 **dedicated**/8 GB (160/800), XL 4 dedicated/16 GB. Every capacity number below is quoted for **Small** and scaled for other sizes; if you are on Nano/Micro (free/Pro default), divide by ~2-3.

### 0.2 Whether Hyperdrive query caching is on — **[UNVERIFIABLE STATICALLY]**, and it cuts both ways

**[FACT]** Hyperdrive caches read-only queries **by default**, `max_age` 60s + `stale_while_revalidate` 15s, and does **not** invalidate on write. Queries containing `now()`, `CURRENT_DATE`, `random()` etc. are never cached.

Now cross that against your actual SQL:

| Query | Cacheable by Hyperdrive? | Consequence |
|---|---|---|
| `SELECT ... FROM sessions WHERE token=$1 AND expires_at > now()` (`shared/session.ts:208,262`) | **No** — contains `now()` | Every authenticated request always hits Postgres. Correct, but it means auth load is irreducible. |
| `SELECT ... FROM sites WHERE slug=$1` (`site.js:156`) | **Yes** | Public reads may already be absorbed at the edge |
| `SELECT ... FROM players WHERE site_id=$1 ORDER BY amount DESC` (`site.js:186`) | **Yes** | ” |
| `SELECT max(updated_at) FROM players WHERE site_id=$1` (SSE tick, `public.js:130`) | **Yes** | If caching is on, your "live" leaderboard is up to **75s stale** (60s max_age + 15s SWR) and the 4s poll interval is theatre |
| `SELECT ... FROM sites WHERE user_id=$1 ORDER BY CASE WHEN id=(SELECT active_site_id ...)` (`site.js:161`) | **Yes** | The code comment above this line says it is deliberately *not* cached so "the dashboard … must see the latest saves immediately". Hyperdrive can cache it anyway for up to 60s. If you have ever had a "I saved and it didn't change" report, this is a prime suspect. |
| every `INSERT`/`UPDATE`, `bumpStat` transaction, click inserts | **No** (writes) | Write load is never absorbed |

So there are two very different systems depending on one dashboard toggle:

* **Branch A — caching OFF (or effectively bypassed):** the DB eats the full SSE poll load. This is the branch all headline numbers below assume, because it is the pessimistic and load-test-verifiable one.
* **Branch B — caching ON (the default):** public read QPS collapses to roughly `#distinct hot boards / 60s`, capacity rises several-fold, **and** you are shipping up-to-75s-stale leaderboards, stale dashboards after save, and stale `boards`/`plan` gating.

**Action before anything else:** open the Hyperdrive config and write down which branch you are in. Then decide it deliberately — the right end state is caching ON for genuinely public read queries and a **second cache-disabled Hyperdrive config** used by session and dashboard code paths, instead of leaving correctness to accident.

---

## 1. The numbers

Assumptions the table is built on — change these and re-derive: **[ASSUMPTION]** Supabase **Small**; Workers **Paid** (Free is not viable, see §8); Branch A caching; average board-page viewer keeps the tab open **6 minutes**; a viewer loads **2 pages** per visit; peak-to-average concurrency factor **8**; ~85% of traffic is anonymous public viewers, the rest streamer dashboards.

| Metric | Comfortable | Stress (degraded but up) | Failure |
|---|---|---|---|
| **Registered streamer accounts** (at rest) | 50,000+ | 200,000 | not the constraint — rows are tiny, all lookups indexed |
| **Streamer MAU** | 10,000 | 30,000 | not the constraint |
| **Streamer DAU** (dashboard users) | 2,000 | 6,000 | ~15,000 (analytics endpoints, §7) |
| **Viewer DAU** (the load that matters) | 20,000-35,000 | 60,000 | ~90,000 |
| **Concurrent active viewers (tabs open)** | **600-1,000** | 1,500-2,000 | **~2,500** |
| **Peak concurrent viewers** (≤2 min burst) | 1,500 | 2,500 | 3,000+ with reconnect storms |
| **Worker RPS** (excluding held SSE) | 40-120 | 250 | 400+ |
| **Requests/minute** | 2,400-7,200 | 15,000 | 24,000 |
| **DB queries/second** | 200-300 | 450-600 | **~700-900 on Small** (≈1,800-2,500 on Large) |
| **Realtime connections (SSE)** | 600-1,000 | 2,000 | Workers can hold far more; **the DB is what fails**, not the connection count |
| **Queue events/second** | 20-60 | 200 | ~800 (consumer is sequential, §7.5); platform allows 5,000/s |

These are **not** interchangeable and the ratios are load-bearing: 50,000 registered streamers is fine while 2,500 open board tabs is not, because registered accounts cost you rows and open tabs cost you 0.25 queries/second each, forever.

---

## 2. What actually breaks first — ranked, with the fix

### 2.1 SSE polling — **the binding constraint** (application limit, not platform)

**[FACT]** `handlePublicStream` (`apps/leaderboard/src/handlers/public.js:116-157`) opens a `ReadableStream` and recurses `setTimeout(send, 4000)` for the life of the connection. Each tick runs `SELECT max(updated_at) FROM players WHERE site_id=$1`; when the timestamp changed it *additionally* re-runs the entire `getPublicSite()` fan-out (5 more queries) and pushes the full player array. Both public page scripts connect automatically, unconditionally, for every visitor (`assets/leaderboard.js:299`, `assets/overlay.js:149`); the only mitigation is `visibilitychange` closing the stream on a hidden tab (`leaderboard.js:314-320`) — which does mean background tabs are free, a genuinely good detail.

* **Limit:** 0.25 queries/s per open tab, and each `one()` call creates a brand-new postgres client (`shared/db.ts:40-49`, `max:1`).
* **Why it matters:** it makes DB load proportional to *time spent looking at a page*, not to actions taken. 1,000 tabs = 250 q/s doing nothing.
* **When:** hurts from ~800 concurrent tabs on Small, fails ~2,500.
* **Fix, in order of payoff:** (a) move the changed-check out of the request path entirely — the Worker already knows when players change (`saveSite`, `quick-add`, auto-reset), so publish version numbers into a Durable Object per site and have the SSE stream `await` a DO alarm/broadcast instead of polling Postgres; (b) if you want the one-line version first, raise the interval to 15-20s and add jitter, which is a 4-5x reduction for a one-character change; (c) serve the tick from the existing 25s L1 site cache rather than a DB query; (d) cap concurrent streams per site and fall back to `/api/public/:slug/players` (which already has ETag + `max-age=10`, `public.js` players handler) for the long tail.

### 2.2 Public HTML is `no-store` — nothing is absorbed by the CDN

**[FACT]** `site-routes.js:77-80` and `index.js` set `cache-control: no-store` on board HTML. **[FACT]** static assets are `public, no-cache` with ETags (`middleware/static-assets.js:30-48`) — `no-cache` means *revalidate every time*, so even your JS/CSS requests reach the Worker (cheap 304s, but they are requests). Only logos/OG/robots get `max-age=86400`.

* **Consequence:** zero CDN offload on the single most-requested resource in the product. Every board view is 1 Worker invocation + 5 DB round trips.
* **Fix:** boards are public, read-mostly, and already tolerate 25s of staleness by design (`site.js:105` `L1_TTL = 25_000`). Serve them `public, s-maxage=15, stale-while-revalidate=60` for anonymous requests (no `yr_viewer`/`yr_session` cookie), and purge by URL on save. Viewer-personalised renders keep `no-store`. This alone removes most of §2.3.

### 2.3 Five DB round trips on every public page view, even on a cache hit

**[FACT]** Only the `sites` row is L1-cached. `getPublicSite()` (`site.js:339-365`) then always runs the owner lookup **and** `Promise.all([getPlayers, getArchives, getPublicBoards, bots])` — 5 queries per view, 6 on L1 miss. Viewer-authenticated home adds `resolveViewer()` + shop + redemptions + ledger (`site-data.js:14-56`), so up to ~10.

* **Fix:** cache the assembled `getPublicSite()` payload, not just the row (the 50 KB per-entry cap at `site.js:107` is the reason it isn't — see 2.4, which is what makes the payload big); collapse `owner` + `bots` + `boards` into one query joined off `sites`.

### 2.4 `getArchives` reads every archive snapshot on every page view — worst scaling defect in the read path

**[FACT]** `getArchives` selects `snapshot_json` with `LIMIT $2` where the limit is the plan cap: `ARCHIVE_LIMITS = { free: 6, starter: 6, pro: 24, agency: 999 }` (`site.js:280-291`). Each `snapshot_json` is the **entire player list** at archive time (`site.js:648-659` inserts `players` wholesale). Then per request, in the Worker: `archiveShape` sorts each snapshot (`site.js:256-262`) and `playerStreak` sorts *every* snapshot again to compute the rank-1 streak (`site.js:265-275`) — and the response only ever exposes each archive's top 3.

* **[DERIVED]** A Pro board with 200 players and 24 archives moves ~24 × 200 × ~120 B ≈ **575 KB from Postgres per page view**, JSON-parsed and sorted ~48 times in the isolate. An Agency board at the 999 cap is in the tens of MB per view — that is a self-inflicted outage, not a scaling curve.
* **Why it matters:** it inflates DB egress, Worker CPU (against the 30s cap, and the reason the 128 MB memory ceiling is reachable), response size, and it is why the assembled payload can't fit the 50 KB L1 entry cap.
* **Fix (highest value-per-hour in this audit):** store the derived top-3 and the winner name in columns on `archives` at write time (you already have the array in hand in the transaction), and have the public read select `label, created_at, top3_json` only. Never ship `snapshot_json` to a page render. Do this before you sell an Agency plan.

### 2.5 Supabase/PostgreSQL — the resource that saturates

**[FACT]** Indexing is genuinely good: `idx_players_site_amount ON players(site_id, amount DESC)` exists precisely for the hot query (`20260705000008_players_composite_index.sql`), `sessions` is PK-on-token, `site_viewers` has `UNIQUE (site_id, viewer_id)`, and `clicks` is monthly-partitioned. **I found no missing index on any hot path.** Your database problem is *round-trip count and polling*, not query plans — do not go index-hunting.

* **Limit [ASSUMPTION + DERIVED]:** 2 shared vCPU on Small; short indexed point queries cost ~0.2-0.5 ms CPU each, so ~700-900 q/s is the wall and p95 degrades from ~450-600 q/s. Large (2 dedicated cores) roughly triples that; each step up is a config change, not a rewrite.
* **Connections are *not* your first wall [FACT+DERIVED]:** Hyperdrive holds ~100 origin connections on Paid and pools them, so the per-query `postgres()` client churn in `shared/db.ts` does not create Postgres backends. At ~2 ms average query time, 100 connections is >10,000 q/s of headroom — DB CPU gives out long before. **But** see 2.6.

### 2.6 Hyperdrive pool exhaustion via slow analytics — how one tenant takes down everyone

**[FACT]** Hyperdrive error `Failed to acquire a connection from the pool` occurs when connections are held too long; pool is ~100 on Paid, shared by leaderboard + bot + consumer (one Hyperdrive id across all three `wrangler.toml`). **[FACT]** the slow queries exist: credit analytics runs multiple tenant-wide `SUM`/`COUNT`/`FILTER`/`GROUP BY DATE` over ledger/redemptions/viewers (`handlers/credits.js:801-881`), bot click stats aggregates joins with no result `LIMIT` (`apps/bot/src/hono-app.ts:424-438`), broadcast audience is a tenant-wide `COUNT(*)` (`dashboard-api.ts:708-721`), visitor stats use `COUNT(*) FILTER` over `site_visitors`.

* **[DERIVED]** 100 connections ÷ a 1-second aggregate = 100 concurrent slow queries is all it takes. A handful of large tenants opening their analytics tab during a peak — or one abusive loop against `/api/credits/analytics` within its 20/60s limiter — can starve the pool for **every** Worker, including the bot webhook and the queue consumer.
* **Fix:** pre-aggregate. You already have `click_daily` and `site_stats_hourly` — extend that pattern to credits (nightly rollup into a `credit_daily`), make every analytics endpoint read rollups with an explicit date bound, and add `statement_timeout` (2-5s) on the analytics code path so a heavy query dies instead of holding a pooled connection. Consider a second Hyperdrive config for background/analytics so it cannot starve the request path.

### 2.7 Authentication — irreducible, correctly built, and the reason dashboards cost more than pages

**[FACT]** Postgres-backed sessions, 32-byte token, PK lookup, 30-day TTL, rotation after 24 h, `expires_at > now()` (`shared/session.ts:145-274`), plus a separate `users` read in `resolveUser()`, plus an expiry-refresh `UPDATE`. **[DERIVED]** every authenticated request = 2 reads + sometimes 1 write, none of it Hyperdrive-cacheable (by design, correctly).

* This is fine at your target scale (2,000 streamer DAU ≈ single-digit q/s) and I would **not** change it. Do not "optimise" this into a JWT to save queries; the revocation semantics are worth more than the queries.
* The one improvement worth making: the session-expiry refresh `UPDATE` should be throttled (only write when >1 h since last touch), turning a per-request write into a per-hour write.

### 2.8 `/go/<slug>` blocks the redirect on a DB insert

**[FACT]** `index.js:722-752`: rate-limit → `getPublicSite()` → `INSERT INTO site_clicks` → queue bump → 302. The user's click-out waits for a synchronous write (and writes never retry, `shared/db.ts` header comment).
**Fix:** `ctx.waitUntil()` the insert (or queue it like the bump already is) and redirect immediately. Also note it calls the full `getPublicSite()` fan-out (5 queries) when it needs only `cta_url` — a one-query lookup.

### 2.9 Queue producer fallback puts deferred work back on the request path

**[FACT]** `shared/queue-producer.ts:107-129` executes the DB callback **inline** if `send()` fails or the binding is missing. **[DERIVED]** this is a correct-by-default choice that becomes a load amplifier exactly when you least want it: queue trouble converts every view/click/copy into inline analytics transactions (`bumpStat` = 1-4 statements in a transaction, `shared/stats.ts`) on the hot path. At 200 views/s that is up to 800 extra statements/s appearing at the worst moment.
**Fix:** cap the fallback (e.g. drop analytics after N consecutive failures, or sample it) — analytics loss is cheaper than a request-path collapse.

### 2.10 Queue consumer is sequential

**[FACT]** batch ≤ 50, timeout 5s, 3 retries, DLQ with 0 retries (`apps/consumer/wrangler.toml:21-32`); `for … of` sequential processing plus one heartbeat upsert per batch (`apps/consumer/src/worker.js:45-150`). **[FACT]** platform allows 250 concurrent consumer invocations and 5,000 msg/s per queue.
**[DERIVED]** at ~10 ms per message-with-DB-write, one invocation drains 50 messages in ~0.5s; Cloudflare scales invocations, so throughput is fine into the low thousands/s — **but** sequential processing multiplies latency under retry, and every message is its own DB round trip. Batch the bumps: group a batch by `(site_id, field)` and issue one upsert per group. That is a 5-20x write reduction during traffic spikes for ~20 lines of code.

### 2.11 Rate limiting — better than your own docs claim, with two real gaps

Correction to `docs/security-review.md` and to a claim in the raw inventory: limiters are **not** missing from login/signup/credits. Verified **[FACT]**: `login:<ip>` 20/600s, `login-email:<email>` 10/900s, `signup:<ip>` 10/3600s, `totp` 5/300s, `credits:*` 5-60/60s, `pub-standings` 100/60s, `pub-players` 120/60s, `pub-stream` 60/60s, `go:<ip>` 120/60s, viewer/redeem/oauth limiters, ~60 distinct keys in total. Backend is Durable Objects with `RL_FAIL_OPEN=false` in production and fail-closed as the library default (`shared/ratelimit.ts:48-53,81-90`) — the right choice.

The real gaps:
1. **The public board HTML render has no limiter at all** — the most expensive uncached path in the product is the one path anyone can hammer. Even 120/60s per IP would help; better, put a Cloudflare WAF rate-limit rule in front of `/<slug>` so it never reaches the Worker.
2. **Per-site DO keys are serialization points [FACT+DERIVED]:** `kick-earn:<site_id>:<user>` keys map to a *single* DO instance per key (`shared/ratelimit.ts:136-163`), pinned to one location, single-threaded, doing a storage get+put per check. A viral board funnels all its config checks through one object — expect a few hundred checks/s ceiling and added cross-region latency for distant viewers. Shard hot per-site keys (`…:<site_id>:<hash(ip)%16>`) or move genuinely-global-per-site checks off the DO.
3. `pub-stream` at 60/60s per IP still permits a reconnect storm: `EventSource` auto-reconnects, and on error the client keeps retrying (`leaderboard.js:311`). A deploy or DB blip disconnects every stream at once and they all come back within seconds, each re-running `getPublicSite()`. Add jittered client backoff.

### 2.12 Cron and background work

**[FACT]** leaderboard `*/5 * * * *` runs auto-reset: one query picks ≤100 due boards, then a **sequential** per-board loop doing `getPlayers` + archive transaction + `UPDATE` + Discord/Telegram notify (`auto-reset.js:24-67`). Bot runs `* * * * *` (one broadcast batch) and `0 3 * * *` (8 tasks in parallel via `Promise.allSettled`: rollup, both click partitions, expiry warnings, plan downgrades, click retention, session/reset cleanup, onboarding emails) (`apps/bot/src/worker.ts:86-211`). Monitor `*/5` does 4-8 outbound checks.

* **[DERIVED]** Throughput ceiling 100 boards/5 min = 1,200/h. Boards overwhelmingly reset at month boundaries — with >1,200 auto-reset boards, the 1st of the month becomes a multi-hour staggered reset, and one tenant's slow Discord webhook delays every board behind it in the loop. Cron wall-clock limit is 15 min **[FACT]**, and waiting on I/O doesn't consume CPU time, so you will not hit CPU — you will just be late.
* **Fix:** raise the batch, process boards with bounded concurrency (`Promise.all` over chunks of 5-10), and `waitUntil` the notifications instead of awaiting them.
* **[FACT]** Next-month `clicks` partitions are created by *application cron*, not migrations (`worker.ts:86-114`). If the bot Worker's nightly cron fails for a month, click writes land in `clicks_default` — recoverable but painful. Add a monitor assertion that next month's partition exists.
* **[FACT]** `POST /api/reencrypt` (bot admin) selects **all** bots and updates each sequentially, unbounded (`hono-app.ts:446-469`). Fine today, a foot-gun at 10k bots; make it batched and resumable.

### 2.13 Telegram broadcasts — correctly rate-shaped, watch the write amplification

**[FACT]** one broadcast batch per minute, default batch 300, `FOR UPDATE SKIP LOCKED` claim, keyset pagination by `tg_user_id`, sequential sends paced at 36 ms (~28 msg/s) (`apps/bot/src/broadcasts.ts`). **[DERIVED]** ceiling ≈ 300 recipients/min ≈ 18,000/h; a 100k-subscriber broadcast takes ~5.5 hours. That is a *product* limit driven by Telegram's own limits, not a bug — but say it out loud in the UI, and note blocked-subscriber handling adds per-recipient DB writes.

### 2.14 Telegram webhook is synchronous per update

**[FACT]** `POST /hook/:secret` → `getBotBySecret` (join, rejects suspended owners) → decrypt token → construct a grammY `Bot` → wire handlers → `handleUpdate` (`hono-app.ts:125-138`, `botEngine.ts`), plus a subscriber upsert per user-originated update. Telegram retries on slow/failed responses, so DB slowness turns into duplicate work. **Fix:** acknowledge 200 immediately and `waitUntil` the update processing (idempotently, keyed by `update_id`).

### 2.15 CPU, memory, payloads, request duration

**[FACT]** Workers Paid: 128 MB memory, default 30s CPU (max 5 min), no charge/limit on wall-clock duration, 6 simultaneous outbound connections per request, 10,000 subrequests. Workers Free: **10 ms CPU** — and none of the four `wrangler.toml` sets `limits.cpu_ms`, `placement`, or `[observability]`.
**[DERIVED]** SSR board rendering + JSON-parsing archives (2.4) is comfortably over 10 ms of CPU for a big board, so **Workers Paid is mandatory**, matching what `docs/launch-checklist.md:96-111` still lists as an open item. Memory: 24-999 parsed archive snapshots in one isolate is the only realistic path to the 128 MB ceiling — fix 2.4 and CPU/memory stop being interesting. Enable `[observability]` now; you cannot tune what you cannot see, and CPU-per-route is exactly the metric this audit had to guess at.

### 2.16 Single points of failure

One Supabase instance and **one shared Hyperdrive config** for leaderboard + bot + consumer (all three TOMLs, same id) — DB degradation is total, and pool starvation is shared (2.6). Staging still carries `STAGING_HYPERDRIVE_ID_PLACEHOLDER` (`apps/leaderboard/wrangler.toml:103-107`, `apps/bot/wrangler.toml:82-86`), so there is no configured staging DB separation — you have nowhere safe to run the load tests in §12 except production. Fix that before testing. Kick/Discord OAuth have circuit breakers (threshold 5, 30s reset); Telegram has a 15s timeout but no breaker.

---

## 3. Traced workflows (user action → edge → API → DB → external → response)

Per-request SQL counts below are **[FACT]** from the cited code; totals are **[DERIVED]**.

**W1 — Anonymous viewer opens a board** `GET /<slug>`
Browser → CF edge (`no-store`, always a miss) → leaderboard Worker → `getBySlug` (L1 25s, else 1 query) → owner query → `Promise.all`(players, archives+snapshots, published boards, bot username) → `resolveViewer` (0 queries without cookie) → queue a `bump` view event → SSR HTML.
**5-6 queries, 1 request, 0 blocking external calls.** Then ~6 asset requests (all revalidate against the Worker), 1 SSE connection (§W2), 1 scroll beacon (1 write). Consumer later does 1-4 writes for the view bump.

**W2 — That same tab, per minute of dwell** `GET /api/public/:slug/stream`
**15 queries/minute/tab**, plus 5 more on every change tick. This is the whole ballgame.

**W3 — Streamer opens the dashboard** `GET /dashboard/*`
1 session+user read for the SSR shell → client calls `/api/auth/me` (2) → `/api/site` = `getUserSite` + `getUserBoardsList` + `onboardingForSite`'s 4-way `Promise.all` (bots, postback_keys, `COUNT(*) players`, site_stats) (`handlers/sites.js:25-40,162-178`) → optional `/api/site/stats` + `/stats/heatmap` aggregates.
**~10-18 queries per dashboard load**, mostly parallel, all indexed. Cheap in aggregate because streamers are few.

**W4 — Click-out** `GET /go/<slug>`: DO limiter → 5-query `getPublicSite` → blocking `INSERT site_clicks` → queue bump → 302. See 2.8.
**W6 — Telegram update** `POST /hook/:secret`: 1 read + decrypt + grammY construction + subscriber upsert + blocking Telegram API call. See 2.14.
**W7 — Postback** `POST /pb`: HMAC verify (CPU) → owner lookup → replay-guard write → queue (fallback = inline conversion writes). Unsigned `/pb/:key` returns 410 in production **[FACT]** (`POSTBACK_UNSIGNED_ENABLED=false`) — good.
**W8 — Payments:** NOWPayments checkout blocks on the provider inside the request; IPN is signature-verified with an idempotency ledger (`provider_events`). Low volume, no capacity concern; the only risk is provider latency being user-visible.
**W9 — Auth:** signup = uniqueness reads + user/site/session inserts + Resend (deferred via `waitUntil` where passed); login = user read + lockout counter updates + slug/subscription reads + session insert. Sequential but low-volume.
**File uploads:** none in the Worker path — logos are base64 in `sites.logo_data`, deliberately excluded from `SITE_COLUMNS` and fetched only by `/logo/:slug` with `max-age=86400` **[FACT]**. Good decision; keep it.
**Search:** client-side only over already-loaded players (`assets/leaderboard.js:520-536`) — zero server cost, and no `ILIKE` anywhere in the codebase. Good.

---

## 4. The calculations

**[ASSUMPTION]** viewer dwell 6 min (360 s), 2 page views/visit, peak factor 8, Supabase Small, Branch A.

Per concurrent viewer tab:
```
SSE:        1 query / 4 s                      = 0.250 q/s
page views: 2 views × 5 queries / 360 s        = 0.028 q/s
scroll/bump: ~3 writes / 360 s                 = 0.008 q/s
                                        total  ≈ 0.286 q/s   → SSE is 87%
```
Concurrent-viewer ceiling from DB CPU:
```
comfortable (p95 stable, ~250 q/s of budget)   250 / 0.286 ≈  875 tabs
stress      (~500 q/s)                         500 / 0.286 ≈ 1,750 tabs
failure     (~800 q/s on Small)                800 / 0.286 ≈ 2,800 tabs
```
Reserve ~20-25% for dashboards, viewer actions, bot, consumer, cron → **comfortable ≈ 600-1,000; failure ≈ 2,500.**

Worker RPS at 800 concurrent tabs:
```
page loads 800 × 2 / 360             ≈  4.4 rps
assets     × 6                       ≈ 27 rps
beacons                              ≈  2 rps
dashboards/API/bot                   ≈ 10-30 rps
                                       ≈ 45-65 rps sustained (~3,000/min)
plus 800 held SSE invocations (billed once each, ~0 CPU while idle)
```
DAU ↔ concurrency:
```
DAU = concurrent × 86,400 / (dwell × peak_factor) = 800 × 86,400 / (360 × 8) ≈ 24,000 viewer-DAU
```
Tenant translation **[ASSUMPTION]** 5-10% of a livestream's audience opens the board: a streamer with 1,000 live viewers contributes 50-100 concurrent tabs. So **800 concurrent ≈ 8-16 mid-size streamers live simultaneously**, or a few hundred small ones. That is the honest unit of capacity for this product.

Platform ceilings for comparison **[FACT]**: Workers requests — no RPS limit, 10 M/month included then $0.30/M; CPU — 30 M ms/month included then $0.02/M; Hyperdrive queries — unlimited on Paid (100k/day on Free); Queues — 5,000 msg/s, 250 concurrent consumers, 100/batch; Supabase Small — 90 direct / 400 pooler connections. **Every ceiling above is 10-100x beyond where your DB CPU gives out.** Nothing here is Cloudflare's fault or Supabase's fault; the wall is the polling design plus the archive read.

Cost sanity check **[DERIVED]** at 24k viewer-DAU: ~50 rps ≈ 130 M requests/month ≈ $5 + $36 requests + CPU (7 ms avg ⇒ ~$15) ≈ **$55-60/month of Workers**, plus Supabase. Cheap — which is precisely why fixing the DB polling rather than upsizing forever is the right call, but also why upsizing Supabase to Large is a perfectly rational stopgap.

---

## 5. Scenarios

| Scenario | Viewer DAU | Peak concurrent tabs | RPS | DB q/s | Expected status |
|---|---|---|---|---|---|
| **Conservative** | 5,000 | 200 | 15-25 | 60-90 | Comfortable. p95 board render <300 ms. Nothing to do. |
| **Realistic** | 20,000-35,000 | 600-1,000 | 45-120 | 200-300 | Healthy with headroom on Small. Occasional slow analytics tabs. This is the launch target. |
| **Stress** | 60,000 | 1,500-2,000 | 250 | 450-600 | Degraded: p95 board render 1-3 s, SSE ticks slipping, occasional `Failed to acquire a connection from the pool` when analytics tabs are open. Still serving. |
| **Failure point** | ~90,000 | ~2,500 | 400+ | 700-900 | **DB CPU saturation.** SSE ticks and page renders queue behind each other → Hyperdrive pool starvation → 500s across *all* Workers (shared config) → `EventSource` mass reconnect → self-sustaining thundering herd. Recovery requires shedding SSE, not restarting. |

The failure mode to internalise: it is not a graceful slope. Because every failed SSE reconnects and every reconnect re-runs `getPublicSite()`, the first sign of DB slowness *increases* load. Ship a kill switch (env flag that makes `handlePublicStream` return 503 with `Retry-After`, letting clients fall back to a page refresh) before you need it.

---

## 6. Multi-tenant analysis

Tenancy model **[FACT]**: `users` → `sites` (boards) → `players` / `site_viewers` / `credit_ledger`; enforcement is application-level `WHERE site_id=$1` / `WHERE user_id=$1`, all indexed. Isolation of *data* looked correct in every query I read — `getBoardById` and `getUserSiteById` always carry the owner id, viewer actions resolve identity from the session.

**RLS is not doing what your docs say [FACT].** Policies are created as `USING (true) WITH CHECK (true)` for the service role via dynamic SQL (`20260715000001_rls_security_sweep.sql`), tables are owned by `postgres`, and the Workers connect with that owner role through Hyperdrive — no `FORCE ROW LEVEL SECURITY` exists anywhere in the migrations. So: **RLS costs you essentially zero capacity** (good news for this audit) but also provides **zero tenant isolation for the application path**; it only constrains Supabase API/anon-key access. Your isolation is your `WHERE` clauses. That is a defensible architecture — just stop describing it as RLS-enforced in `docs/security-review.md`, and treat every new query as security-critical.

**Per-tenant cost [DERIVED]:**

| Tenant type | Concurrent tabs | Steady DB q/s | Notes |
|---|---|---|---|
| Small board (20 players, 6 archives, 5 viewers) | 5 | ~1.4 | negligible |
| Active board (100 players, 24 archives, 100 viewers) | 60 | ~17 | ~2-6% of a Small instance each |
| Large board (500 players, 24 archives, credits on) | 300 | ~86 | **one tenant can consume a third of the instance** |
| Agency (999-archive cap) | any | — | 2.4 makes this dangerous regardless of traffic |

**Can one tenant hurt others? Yes, four ways [DERIVED from FACTs]:**
1. Shared DB CPU — a viral board's SSE polling starves everyone (no per-tenant limits exist on the render path at all).
2. Hyperdrive pool starvation via tenant-wide analytics aggregates (2.6), shared across all three Workers.
3. The auto-reset cron's sequential loop — one tenant's slow webhook delays other tenants' resets (2.12).
4. Per-site DO rate-limit keys serialising a hot tenant's requests, and the site L1 cache being capped at 1,000 entries with FIFO eviction (`site.js:108-118`) — past ~1,000 hot boards per isolate, popular boards evict each other and cache hit rate falls off a cliff.

**Fixes:** a per-site concurrent-SSE cap; per-site (not just per-IP) limits on the render path; rollups + `statement_timeout` for analytics; bounded-concurrency cron; raise/segment the L1 cache once entries are small (which 2.4 enables).

---

## 7. Database detail

**Good, verified [FACT]:** every hot-path predicate has a matching index (`sites.slug` unique, `sites(user_id)`, `players(site_id, amount DESC)`, `sessions` PK token + `user_id` + `expires_at`, `viewer_sessions(viewer_id/expires_at)`, `site_viewers UNIQUE(site_id, viewer_id)`, `credit_ledger(site_viewer_id)`, `site_clicks(site_id, created_at)`, `conversions(site_id, ts)` partial, `click_daily` uniques, monthly `clicks` partitions). No `OFFSET` pagination anywhere; broadcasts use keyset pagination; exports and history use `LIMIT`. Triggers are cheap (`updated_at`, suspension sync).

**Queries most likely to become bottlenecks, and how each scales:**

| Query | Scales with | Behaviour |
|---|---|---|
| `SELECT max(updated_at) FROM players WHERE site_id=$1` (SSE tick) | **concurrent tabs** | O(1) per call via the composite index, but called 0.25×tabs/s. Linear in *viewers*, which is the wrong axis to be linear in. |
| `getArchives` + `snapshot_json` | archives × players per board | Payload and Worker CPU grow multiplicatively; 999-cap plan is unbounded. Worst offender. |
| `getPlayers` (no `LIMIT`) | players per board | Fine at 100, 500 rows; a 10k-player board ships 10k rows per view. Add a bounded top-N + "show all" endpoint. |
| `getPublicBoards` (no `LIMIT`) | boards per owner | Small today; Agency multi-board owners make it grow. |
| `getShopItems` (no `LIMIT`, `site-data.js:4-8`) | shop items per site | Same shape, same fix. |
| credit analytics `SUM/COUNT/FILTER/GROUP BY DATE` | ledger rows per tenant (lifetime) | Grows forever, never bounded by date. This is the pool-starvation query. Pre-aggregate. |
| bot click stats join + `GROUP BY`, no result `LIMIT` | clicks per owner over 14 days | Partitioning helps; raw scans still grow. `bot-audit.md:69-90` already flagged it. |
| broadcast audience `COUNT(*)` | subscribers per bot | Full count per call; use a maintained counter or `reltuples` estimate. |
| `COUNT(*) FILTER` over `site_visitors` (dashboard stats) | unique visitors per site (lifetime) | Grows forever; the dashboard pays for all history to show "last 30 days". |
| `bumpStat` transaction (1-4 statements) | page views | Write amplification ×4 for referrer+visitor events; batch in the consumer (2.10). |

**Heavy writes:** views/clicks/scroll (queued — correct), sessions (per-request refresh — throttle it). **Heavy reads:** the public render path, dominated by archives. **N+1:** I looked specifically and found **no classic N+1 in the request path** — the fan-outs are `Promise.all`ed, and `onboardingForSite`/`getViewerSiteData` parallelise correctly. The N+1-shaped problems are in *background* loops: auto-reset per board, `/api/reencrypt` per bot, broadcast per recipient (unavoidable), consumer per message.

---

## 8. Service limits, correctly attributed

**Hard platform limits [FACT]** — will actually stop you: Workers Free 100k req/day and **10 ms CPU** (you exceed this on board renders — Paid is mandatory); Workers 128 MB memory, 6 simultaneous outbound connections/request, 30s default CPU (5 min max); Hyperdrive **~100 origin connections** (Paid; ~20 Free) and 60s max statement duration; Hyperdrive Free 100k queries/day (you would blow this in ~5 minutes of SSE at 300 tabs); Queues 128 KB/message, 100/batch, 5,000 msg/s, 250 concurrent consumers; Supabase Small 90 direct/400 pooler connections; Telegram's own send rate (~30 msg/s).

**Practical limits [DERIVED]** — slow or expensive first: Supabase Small CPU at ~450-600 q/s; Hyperdrive pool exhaustion from slow aggregates well before the connection count matters; DO throughput per hot key; auto-reset's 1,200 boards/hour; broadcast's ~18,000 recipients/hour; the 1,000-entry L1 cache and its 25s TTL (which also means *every* isolate revalidates independently — a global product with 100+ isolates gets far less cache benefit than the 25s suggests).

**Application limits [DERIVED]** — your code, not the vendors, and they are what actually caps you: the 4-second SSE poll; `no-store` on public HTML; 5 queries per view with no assembled-payload cache; `snapshot_json` on the read path; unbounded players/boards/shop queries; blocking insert in `/go`; synchronous Telegram webhook; sequential consumer/cron loops; lifetime-unbounded analytics aggregates; inline queue fallback. **Every single number in §1 is set by this list, not by Cloudflare or Supabase.**

---

## 9. Security vs capacity

The security posture is, with one exception, both correct and cheap — I am not recommending you weaken any of it.

* **Sessions:** DB-backed with `now()` (uncacheable) is the *reason* auth costs 2 queries/request. Keep it; throttle the refresh `UPDATE` instead.
* **RLS:** costs ~nothing, protects ~nothing on the app path (§6). Fix the docs, not the code — or adopt `FORCE ROW LEVEL SECURITY` with a non-owner role if you want real defence in depth (it would add measurable per-query planning cost; do it deliberately, not for capacity reasons).
* **Rate limiting:** DO-backed, fail-**closed** in production (`RL_FAIL_OPEN=false`). Fail-closed is the right call and it means a DO outage becomes an availability incident — an accepted trade, but write it down. Cost is one DO round trip per limited request; the hot-key serialisation in 2.11 is the only scalability defect.
* **CSRF** on mutating routes, 1 MB body cap with chunked-encoding handling (`index.js:175-200`), HMAC-signed postbacks with a replay guard, unsigned postbacks disabled in production, encrypted bot tokens, board password cookies, admin 2FA + IP limiter, OAuth circuit breakers: all sound, all O(1) per request, none of it is a scaling problem.
* **The one gap that is both a security and a capacity gap:** no limiter on `/<slug>` HTML, no per-site SSE cap, and no bot/abuse protection in front of the most expensive path (Turnstile is still an open item in `launch-checklist.md`). A single scripted client opening 10,000 SSE connections costs them nothing and costs you the instance. Fix with a WAF rate-limit rule plus a per-site stream cap — that *adds* security and capacity together.

---

## 10. Code-level scalability findings

| # | Finding | Evidence | Severity |
|---|---|---|---|
| 1 | 4s SSE DB poll per open tab | `handlers/public.js:128-142` | **Critical** |
| 2 | `snapshot_json` read + double sort per page view; 999-archive plan cap | `site.js:280-291,256-275` | **Critical** |
| 3 | Public HTML `no-store` → zero CDN offload; assets `no-cache` → all revalidate at the Worker | `site-routes.js:77-80`, `static-assets.js:30-48` | **High** |
| 4 | 5 queries per view even on L1 hit; only the `sites` row is cached | `site.js:339-365` | **High** |
| 5 | Unbounded queries: players, public boards, shop items | `site.js:186,177`, `site-data.js:4-8` | **High** |
| 6 | Lifetime-unbounded analytics aggregates → Hyperdrive pool starvation | `credits.js:801-881`, `hono-app.ts:424-438`, `dashboard-api.ts:708-721` | **High** |
| 8 | `/go/<slug>` blocks redirect on a non-retried insert, and fans out 5 queries for one field | `index.js:722-752` | **Medium** |
| 9 | Queue fallback runs analytics inline on send failure | `queue-producer.ts:107-129` | **Medium** |
| 10 | Consumer processes 50 messages sequentially, no per-batch grouping of bumps | `consumer/src/worker.js:45-150` | **Medium** |
| 11 | Synchronous Telegram webhook processing (Telegram retries on slowness) | `hono-app.ts:125-138` | **Medium** |
| 12 | Sequential cron loops: auto-reset (100/5 min), `/api/reencrypt` (all bots) | `auto-reset.js:38-67`, `hono-app.ts:446-469` | **Medium** |
| 13 | Session-expiry `UPDATE` on every authenticated request | `shared/session.ts` | **Low-Medium** |
| 14 | Per-site DO limiter keys serialise hot tenants; L1 cache capped at 1,000 entries FIFO | `ratelimit.ts:136-163`, `site.js:108-118` | **Low-Medium** |
| 15 | SPOFs: one Supabase, one shared Hyperdrive config for 3 Workers, staging Hyperdrive id is a placeholder | all `wrangler.toml` | **Medium** |
| 16 | No `[observability]`, no `limits.cpu_ms`, no smart placement in any Worker config | all `wrangler.toml` | **Medium** (blind spot) |
| 17 | Docs contradict code: "all endpoints rate-limited" (they are not — the render path isn't), "RLS on all tables" (present but permissive/bypassed), load-test script targets a stale route (`/<slug>/api/standings`) | `docs/security-review.md:17-29`, `docs/load-test.js:47` | **Low** (but it misled this audit twice) |

Explicitly **not** found, having looked for them: request-path N+1, `OFFSET` pagination, `SELECT *` on hot paths (deliberately avoided, `site.js:96-100`), duplicate frontend fetches or dashboard polling (only countdown timers, no data refetch), WebSockets, missing hot-path indexes, unbounded request bodies, uncapped file uploads.

---

## 11. Before / after

**Current architecture (Supabase Small, Workers Paid, Branch A):**
**≈600-1,000 concurrent viewers · ≈20,000-35,000 viewer-DAU · ≈45-120 RPS · ≈250 DB q/s**

**After the five fixes below** — no re-architecture, no new services, all inside the existing Workers/Supabase/Hyperdrive design:
**≈10,000-25,000 concurrent viewers · ≈300,000-800,000 viewer-DAU · ≈1,000-2,500 RPS · DB still under 300 q/s**

Ranked by capacity gained per hour of work:

| # | Change | Effect | Effort |
|---|---|---|---|
| 1 | SSE: 4s → 15-20s poll with jitter, served from L1 rather than a fresh query; then replace polling with a per-site Durable Object that pushes on change | **4-5x immediately, then removes viewer-count-proportional DB load entirely** | hours → days |
| 2 | Stop reading `snapshot_json` on the read path: persist top-3 + winner at archive time | Kills the payload/CPU/memory cliff; lets the assembled payload fit L1 | hours |
| 3 | CDN-cache anonymous board HTML (`s-maxage=15, stale-while-revalidate=60`) + purge on save; keep `no-store` for cookie-bearing requests | Removes most page-render DB and Worker CPU load; absorbs traffic spikes at the edge | hours |
| 4 | Cache the assembled `getPublicSite()` payload; fold owner/bots/boards into one query; bound players/boards/shop | 5-6 queries → 1-2 on miss, 0 on hit | hours |
| 5 | Analytics rollups + explicit date bounds + `statement_timeout`; batch consumer bumps; `waitUntil` the `/go` insert | Removes pool starvation and write amplification — i.e. removes the *cross-tenant* failure mode | 1-2 days |

Then, and only then: Supabase Small → Large (a config change, ~3x DB CPU) buys another ~3x on top. Doing the upsize *first* buys 3x and leaves every failure mode intact.

---

## 12. Load-test plan

Prerequisites, in order: (1) provision the staging Hyperdrive id so you are not testing production; (2) enable `[observability]` on all four Workers; (3) record your Supabase compute size and the Hyperdrive caching setting; (4) seed realistic fixtures — this is the part that decides whether the test means anything: **one small board (20 players/6 archives), one active board (100/24), one large board (500/24), one credits-enabled board, and 5,000 `site_viewers`**. Testing against `demo` proves nothing, and note the existing `docs/load-test.js` both uses only 50 VUs and hits a stale path (`/<slug>/api/standings`) — fix the path to `/api/public/:slug/standings` before reusing it.

**Metrics to watch on every stage:** k6 `http_req_duration` p50/p95/p99 and `http_req_failed`; Cloudflare per-Worker CPU time p99, error rate, and subrequest count; Hyperdrive query latency, connection-pool acquisition failures (`Failed to acquire a connection from the pool` is your primary early-warning signal), cache hit ratio if caching is on; Supabase CPU %, active connections, and `pg_stat_statements` top queries by total time; queue backlog and DLQ depth.

**Global "too much" thresholds — stop the stage when any trips:** board-render p95 > 1.5 s, or any pool-acquisition failure, or Supabase CPU > 80% sustained 60 s, or `http_req_failed` > 1%, or queue backlog growing monotonically for 2 minutes.

| Stage | VUs / connections | Ramp | Hold | Target | What I expect **and why** |
|---|---|---|---|---|---|
| **T0 — SSE only** (run this first; it is the real test) | 100 → 250 → 500 → 1,000 held `EventSource` on the active board | 60s per step | 10 min at each | n/a (connections, not RPS) | DB q/s should track `0.25 × connections` almost exactly. **If it doesn't, Hyperdrive caching is on** — that single observation settles §0.2. Expect clean behaviour to 1,000 (~250 q/s) on Small. |
| **T1 — 100 concurrent** mixed (70% board view, 20% assets, 10% API) | 100 | 30s | 5 min | ~20 rps | Everything green. p95 < 300 ms. If not, you have a config problem, not a capacity problem. |
| **T2 — 250** | 250 | 1 min | 10 min | ~50 rps | Still green. Watch DB q/s cross ~100 and Worker CPU/request — this is where you learn your true per-render CPU cost. |
| **T3 — 500** | 500 | 2 min | 10 min | ~100 rps | First signals: p95 creeping on the *large* board (archive payload, §2.4). Compare small vs large board p95 — the gap **is** finding #2, measured. |
| **T4 — 1,000** | 1,000 | 3 min | 15 min | ~200 rps | DB ~300 q/s. Expect p95 300-800 ms and rising L1 miss rate as isolates multiply. Now open two analytics dashboards mid-test — I expect visible request-path latency, which demonstrates §2.6. |
| **T5 — 2,500** | 2,500 | 5 min | 15 min | ~500 rps | **Predicted first hard failure.** DB CPU saturates (~600-800 q/s), pool acquisition failures appear, SSE ticks slip past 4s. Kill an SSE-heavy step abruptly here to reproduce the reconnect storm — that is the outage you actually get in production. |
| **T6 — 5,000** | 5,000 | 5 min | 10 min | ~1,000 rps | Expect sustained 5xx on Small. Only meaningful *after* fixes 1-4 land; use it to verify the edge now absorbs page loads (CF cache hit ratio > 90% on board HTML) and DB q/s stays flat as VUs rise. That flatness is the whole goal. |
| **T7 — 10,000** | 10,000 | 10 min | 15 min | ~2,000 rps | Post-fix validation only. New expected limits, in order: Worker CPU per render (§2.15), then DO limiter hot keys (§2.11), then write throughput on `site_clicks`/`bumpStat`. |

Additional targeted tests worth their setup cost: **`/go/<slug>`** — 500 rps to measure the blocking insert's contribution to redirect latency; **Telegram webhook** — 200 updates/s against `/hook/:secret` to see whether Telegram's retry behaviour amplifies; **auto-reset** — 500 boards all due at once, to measure the real reset window against the 100-per-5-minutes budget.

---

## 13. Final verdict

**With the current architecture, I would comfortably support approximately 800 concurrent active viewers (600-1,000) and approximately 25,000 viewer daily actives (20,000-35,000) — alongside roughly 2,000 streamer DAU and tens of thousands of registered accounts.** In tenant terms: **8-16 mid-size streamers live at the same time**, or a few hundred small ones.

I cannot prove those numbers from static analysis alone, and I am not going to pretend otherwise: they depend on your Supabase compute size and on one Hyperdrive toggle, neither of which is in the repository (§0). Treat them as the pessimistic branch, run T0 and T4 from §12, and you will replace my arithmetic with measurements inside a day.

**What limits it:** the SSE poll. DB load is proportional to how long tabs stay open, not to what users do. 87% of your steady-state query volume is 1,000 browsers asking "did anything change?" every four seconds.

**What breaks first:** Supabase CPU at ~700-900 q/s, which starves the shared Hyperdrive pool, which 500s *all three* Workers at once, which disconnects every SSE client, which reconnects them in a herd that each re-run the 5-query board fan-out. Not a graceful degradation — a positive feedback loop.

**Fix before launch:** (1) SSE interval to 15-20s with jitter — the highest-leverage one-line change in the codebase; (2) stop reading `snapshot_json` on the read path and cap Agency archives well below 999; (3) CDN-cache anonymous board HTML; (4) decide the Hyperdrive caching question deliberately and split configs if needed; (5) a rate limit (WAF) and a kill switch on the public render + stream paths; (6) enable observability and provision the staging Hyperdrive id; (7) confirm Workers **Paid** — the Free 10 ms CPU limit alone makes board rendering non-viable, and Hyperdrive's 100k queries/day free cap is ~5 minutes of SSE traffic.

**Safe to ignore for now:** index tuning (there is nothing to find), N+1 in the request path (there isn't any), RLS cost, connection-pool sizing, `OFFSET` pagination, file/upload paths, WebSocket scaling, the broadcast send rate (Telegram's limit, not yours), and the DO limiter's per-request cost.

**Before 1,000 concurrent viewers:** items 1-3 above, plus `waitUntil` the `/go` insert, cache the assembled site payload, and bound the players/boards/shop queries.
**Before 10,000:** replace SSE polling with DO push; analytics rollups + `statement_timeout` + a separate Hyperdrive config for background work; batch consumer bumps; parallelise auto-reset; async Telegram webhook; per-site SSE and render limits; Supabase → Large.
**Before 100,000:** read replicas or a dedicated read path (and accept explicit staleness) for public boards; per-tenant quotas and isolation so no single board can consume the shared instance; move analytics off the OLTP database entirely; partition/retain `credit_ledger` and `site_visitors` the way `clicks` already is; shard rate-limit DOs per site+region; multi-region or split databases for the bot vs the leaderboard so a Telegram incident cannot take boards down.

One last honest note on the codebase itself: the parts most people get wrong — idempotency, CSRF, token encryption, fail-closed rate limiting, indexing — are done properly here, and the previous performance work (`PERF-004`, `DB-003-v8`, single-flight cache, `Promise.all` fan-outs, queue offload) is real and visible in the code. The capacity ceiling is not sloppiness; it is three specific design decisions — poll-based SSE, `no-store` HTML, and archives on the read path — each of which is a day of work to change.

---

## CAPACITY AUDIT UPDATE — merged code through #428

This section is an addendum, not a rewrite. Everything above remains the authoritative
before-state audit and its original measurements are intentionally preserved. PRs #429
and #430 were still pending when this update was written, so neither is included in the
merged-capacity estimate below.

### Bottlenecks closed or materially reduced

| Original bottleneck | Closed by | Cost now versus the original report |
|---|---|---|
| Four-second SSE database polling and reconnect storms | #421 | The version check is now about `1/15 = 0.067 q/s/tab`, versus `1/4 = 0.25 q/s/tab` before: roughly 4x less polling. Jitter and indefinite reconnect handling reduce synchronized storms, but the load still grows with open tabs. |
| Full archive snapshots on the public render path | #422 | Public renders read bounded derived archive summaries (top-three/winner data), not full `snapshot_json` player arrays. Archive work is now approximately archives × 3 displayed players rather than archives × players. Detail endpoints can still read snapshots. |
| Anonymous board HTML always reaching the Worker/DB | #423 | A cache hit is now an edge/Worker-cache response with zero board-render database queries; a miss retains the existing roughly 5–6 query fan-out. Cookie-bearing or otherwise non-cacheable requests still take the miss path. |
| Blocking and unbounded request/background work | #425 | Redirect click persistence is deferred, so `/go` no longer waits for its write. Archive/reset processing is claim-before-work and bounded, with bounded shared concurrency; the write remains deferred rather than adding latency to the save/request path. |
| Synchronous Telegram webhook processing | #427 | Webhook requests now perform admission/deduplication and return promptly; grammY/API work runs after acknowledgement. Recovery is indexed, frequent, age-bounded, and terminally marks stale work instead of replaying it days later. |
| Cross-tenant `/offers` click aggregation and top-1,000 rank reads | #428 | `/offers` aggregates only the requesting owner's retained click rows instead of all tenants' history. `!rank` returns exact rank/total through indexed SQL rather than loading up to 1,000 players; public boards/shop/board-list reads also have defensive ceilings above contractual limits. |

### Still open in code

These are not silently truncated because doing so would change a displayed payload,
total, rank, or export:

- **Very large public player payloads:** a valid Pro/Agency board can still contain
  9,999 players. The defensive `LIMIT 10000` protects against bad data but does not
  solve the product-visible response size, HTML size, or client-render cost.
- **Complete account/security exports:** exports still intentionally read complete
  tenant history. They need streaming or an asynchronous resumable export, not a
  hidden row cap.
- **All-time credit analytics:** the exact ledger and redemption scans remain until
  #430 lands. The correct fix is maintained counters, not a date bound.
- **Notification fan-out:** the deferred, changed-name-filtered, batched implementation
  is in #429 and is not counted here as merged.
- **Other lower-frequency growth paths:** administrative `/api/reencrypt` work
  remains sequential and unbounded. It is not the dominant anonymous-viewer
  bottleneck, but remains code work if tenant sizes grow substantially.

### Configuration-only limits

These cannot be fixed in application code:

- Supabase must be moved off the free plan; the current approximately **5 GB/month
  public egress cap** is an external budget, not a query optimization.
- Hyperdrive `origin_connection_limit` is approximately **20** on the current
  constrained configuration; changing it requires configuration and an origin that
  can support the additional connections.
- Smart Placement is currently off while the database is in `eu-west-1`; placement
  is a deployment/configuration decision.
- The approximately **120-second `statement_timeout`** is an operational database
  setting. Code has removed the worst lifetime scans only where the merged fixes
  cover them; it has not made a timeout harmless.
- There is still no isolated staging database/Hyperdrive binding. Provisioning one is
  required before a representative load test.

### Revised static capacity estimate

No load test has been run. These are static-analysis estimates, not measured capacity
or an SLO. They use the corrected free-plan anchor of **300–500 concurrent viewers**
and **10,000–15,000 viewer-DAU**, six-minute average dwell, two page views per visit,
an 8x peak-to-average factor, anonymous HTML-cache hits for the majority of repeat
views, and the pessimistic assumption that SSE version checks reach the database.

The viewer-DAU conversion is:

```text
DAU = concurrent tabs × 86,400 / (360 second dwell × 8 peak factor)
    = concurrent tabs × 30
```

With #421's 15-second stream cadence, the per-tab steady-state estimate is:

```text
SSE version check       1 / 15 s                         = 0.067 DB q/s
cached/missed page mix  approximately                    = 0.010–0.028 DB q/s
queued view/beacon work approximately                    = 0.003–0.008 DB q/s
                                                          ≈ 0.080–0.103 DB q/s/tab
```

#### Current free-plan Supabase — honest capacity today

```text
concurrent viewers     300–500
viewer-DAU              300–500 × 30                 = 9,000–15,000
Worker RPS              page/assets/API arithmetic   ≈ 20–45 RPS
DB QPS                  0.080–0.103 × tabs
                         + dashboard/background reserve
                                                        ≈ 30–60 DB QPS
```

This is the practical free-plan range, not a claim that the free database has a
guaranteed 60-QPS entitlement. The lower end is the safer operating point while the
5 GB egress budget, shared connections, and unmeasured tenant mix remain unknown.

#### After the listed configuration changes

Assuming a non-free Supabase tier with materially more compute, the connection limit
raised above the current ~20-origin ceiling, Smart Placement enabled, the timeout
chosen deliberately, and an isolated staging database available for testing:

```text
concurrent viewers     1,000–1,500
viewer-DAU              1,000–1,500 × 30             = 30,000–45,000
Worker RPS              same traffic arithmetic      ≈ 65–115 RPS
DB QPS                  0.080–0.103 × tabs
                         + larger dashboard reserve
                                                        ≈ 90–170 DB QPS
```

The configuration changes remove external ceilings and add headroom; they do not
remove the remaining linear SSE load or the 9,999-player public payload. The second
range therefore remains an estimate until the isolated staging load plan in §12 is
run, and it should not be read as permission to scale past the open code findings.

## CAPACITY AUDIT UPDATE — merged code through #435

This is a further addendum. The original report and the preceding #428 addendum
remain unchanged and authoritative for their before-state measurements.

### Additional bottlenecks closed or materially reduced

| Bottleneck | Closed by | Cost now |
|---|---|---|
| Saving a board reads every subscription row and enqueues one event at a time | #429 | A save with no rank changes performs no subscription read. Changed names are filtered in SQL, fan-out remains deferred, and queue admission is batched up to 100 messages while preserving individual delivery/retry events. A rejected batch still falls back per event; the documented exceptional trade is possible duplicate delivery rather than silent loss. |
| All-time credit analytics rescan the site ledger | #430 | Earned/spent totals, viewer balance totals, and redemption-status counts are maintained per site and read as one aggregate lookup. The migration backfills before installing triggers; reconcile remains the explicit full-ledger audit. |
| Large public boards ship all 9,999 players | #431 | The first render now sends only the top 100, with real SQL pagination for later pages. Total and ranks remain global, and SSE sends/merges only the first page. A large-board page-one player payload falls from approximately 1.2 MB to roughly a hundred-player page; `load more` is the explicit additional-payload path. |
| Server-side search could be repeated without a dedicated budget | #434 | Search has an additive 60/IP/minute bucket alongside the unchanged 120/IP/minute players bucket. Standings, stream, redirects, and rank retain their existing limits. |
| Capacity estimates had no per-request measurements | #433 | Opt-in structured metrics report tenant, normalized route, DB query attempts, duration, cache state, and response bytes. Unknown routes use `/other`; emission requires both the wrapper option and `REQUEST_METRICS=true`. A cold top-100 HTML miss is seven DB queries by the current path; a public-cache hit is zero. |
| The progressive load plan was not safely runnable | #432, recovered to `main` by #435 | The k6 stages and viewer mix are runnable only with an explicit target. Known production hosts are rejected, non-local custom domains require an explicit staging acknowledgement, and 429 limiter shedding is tracked separately. No ramp has been run. |

### Remaining code work

- Complete account/security exports still need streaming or an asynchronous,
  resumable export; they must not receive a hidden row cap.
- Administrative `/api/reencrypt` work remains a lower-frequency growth path
  with sequential unbounded work.
- Broad search is bounded by the defensive 10,000-match ceiling and separately
  rate-limited, but it is still more expensive than an ordinary page fetch.

### Configuration-only limits

The following remain outside code: Supabase's free-plan approximately **5 GB/month
public egress cap**, Hyperdrive `origin_connection_limit` approximately **20**,
Smart Placement being off with the database in `eu-west-1`, the approximately
**120-second `statement_timeout`**, and the absence of an isolated staging
database/Hyperdrive binding.

### Revised static capacity estimate after pagination

No load test has been run. These are static-analysis estimates, not measured
capacity or an SLO. They retain the corrected anchor, six-minute average dwell,
an 8x peak-to-average factor, and two board views per visit:

```text
DAU = concurrent tabs × 86,400 / (360 second dwell × 8 peak factor)
    = concurrent tabs × 30
```

The dominant egress term is materially different. Let a rendered top-100 page be
approximately **0.03–0.06 MB** rather than the old approximately **1.2 MB**
player payload, assume **20%** of viewers click `load more` once, and assume
**10%** of otherwise cacheable board renders miss the Worker HTML cache:

```text
expected response payload/view
  = 0.03–0.06 MB × (1 + 0.20)
  = 0.036–0.072 MB

origin egress/month at 300–500 concurrent viewers
  = (9,000–15,000 DAU × 2 views/day × 30 days)
    × 0.036–0.072 MB × 10% cache misses
  ≈ 1.9–6.5 GB/month
```

The 10% miss rate and 20% `load more` rate are assumptions, not facts. More
first-time traffic, cookies, cache bypasses, or page expansion can consume the
5 GB free-plan budget faster; the ceiling is no longer honestly represented by
assuming every viewer receives all 9,999 players.

The per-tab DB estimate is now:

```text
SSE version check       1 / 15 s                         = 0.067 DB q/s
paginated/cache misses  bounded and mostly cache-free     = 0.003–0.010 DB q/s
queued view/beacon work approximately                    = 0.003–0.008 DB q/s
                                                          ≈ 0.073–0.085 DB q/s/tab
```

#### Current free-plan Supabase — honest capacity today

```text
concurrent viewers     300–500
viewer-DAU              300–500 × 30                 = 9,000–15,000
Worker RPS              page/assets/API arithmetic   ≈ 20–45 RPS
DB QPS                  0.073–0.085 × tabs
                         + dashboard/background reserve
                                                        ≈ 25–50 DB QPS
```

This remains the honest free-plan operating range. Pagination removes the former
large-board page-one payload cliff, but the free egress cap still depends on actual
cache misses and `load more` clicks, while SSE and shared database connections
remain live constraints.

#### After the listed configuration changes

Assuming Supabase is moved off the free plan, the origin connection limit is raised,
Smart Placement is enabled, the timeout is chosen deliberately, and isolated
staging exists:

```text
concurrent viewers     1,000–1,500
viewer-DAU              1,000–1,500 × 30             = 30,000–45,000
Worker RPS              same traffic arithmetic      ≈ 65–115 RPS
DB QPS                  0.073–0.085 × tabs
                         + larger dashboard reserve
                                                        ≈ 80–150 DB QPS
```

This second range removes the external free-plan ceilings but remains an estimate
until the isolated load plan is run. Once `REQUEST_METRICS=true` is enabled,
`payload_bytes` and `db_queries` will replace these arithmetic terms with observed
response sizes, cache-hit ratios, and actual SQL-attempt counts; this is the first
capacity audit section whose estimates have a direct measurement path.
