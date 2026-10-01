# Production-Readiness Audit: yourrank-bot

**Date:** July 24, 2026  
**Scope:** `apps/bot/**` (Every tracked file)  
**Status:** Complete (43/43 files read)

---

## 1. Executive Summary

The `yourrank-bot` application is a robust, multi-tenant Telegram bot platform and streamer dashboard built on Cloudflare Workers and Hono. It features secure bot token management, mass broadcasts, tracked affiliate links, and Telegram Stars billing integration. The codebase follows modern security best practices (CSP nonces, HSTS, CSRF protection, constant-time comparisons) and performance patterns (partitioning, background logging, cron-driven rollups).

The audit covered every source file, test suite, and configuration file. The architecture is production-ready, though optimizations for scalability (stats queries) and safety (dev login disables) are critical for the next release.

---

## 2. Files-Read Manifest (43/43)

| # | Path | Description |
| :--- | :--- | :--- |
| 1 | `apps/bot/.dev.vars.example` | Local development secret templates |
| 2 | `apps/bot/.env.example` | Environment variable documentation |
| 3 | `apps/bot/.eslintrc.json` | Linting rules (Strict irregular whitespace, no-empty) |
| 4 | `apps/bot/SENTRY-SETUP.md` | Infrastructure setup guide for error tracking |
| 5 | `apps/bot/bun.lock` | Dependency lockfile (GrammY 1.30.0+, Hono 4.12.27+) |
| 6 | `apps/bot/package.json` | Project manifest & dependencies |
| 7 | `apps/bot/src/__tests__/bot-commands.test.ts` | Integration tests for bot menu/commands |
| 8 | `apps/bot/src/__tests__/bot-engine.test.ts` | Unit tests for engine helpers (esc, rate-limit) |
| 9 | `apps/bot/src/__tests__/dashboard.test.ts` | Full dashboard/auth integration tests |
| 10 | `apps/bot/src/__tests__/plans-rollup.test.ts` | Tests for quota management & rollup logic |
| 11 | `apps/bot/src/__tests__/postback-sunset.test.ts` | Verification of legacy postback 410 logic |
| 12 | `apps/bot/src/__tests__/validation.test.ts` | Schema validation tests |
| 13 | `apps/bot/src/billing.ts` | Telegram Stars payments logic |
| 14 | `apps/bot/src/botEngine.ts` | Multi-tenant bot logic (grammY handlers) |
| 15 | `apps/bot/src/broadcasts.ts` | Rate-limited mass sender |
| 16 | `apps/bot/src/clicks.ts` | Clicks logger (shared re-export) |
| 17 | `apps/bot/src/config.ts` | Live config getters for Workers runtime |
| 18 | `apps/bot/src/conversions.ts` | Conversion recorder (shared re-export) |
| 19 | `apps/bot/src/dashboard-api.ts` | Dashboard JSON API handlers |
| 20 | `apps/bot/src/dashboard-auth.ts` | Telegram Login & CSRF logic |
| 21 | `apps/bot/src/dashboard-views.ts` | View aggregator |
| 22 | `apps/bot/src/dashboard-views/app.ts` | Dashboard shell template |
| 23 | `apps/bot/src/dashboard-views/client-script.ts`| Dashboard SPA logic (vanilla JS) |
| 24 | `apps/bot/src/dashboard-views/login.ts` | Login page template |
| 25 | `apps/bot/src/dashboard-views/pages/bots.ts` | Bots management panel |
| 26 | `apps/bot/src/dashboard-views/pages/broadcasts.ts`| Broadcasts UI panel |
| 27 | `apps/bot/src/dashboard-views/pages/commands.ts`| Bot command customization panel |
| 28 | `apps/bot/src/dashboard-views/pages/offers.ts` | Partner offers panel |
| 29 | `apps/bot/src/dashboard-views/pages/overview.ts`| Dashboard KPI overview |
| 30 | `apps/bot/src/dashboard-views/pages/settings.ts`| Conversion tracking & Plan settings |
| 31 | `apps/bot/src/dashboard-views/shell.ts` | Navigation & Header components |
| 32 | `apps/bot/src/dashboard-views/utils.ts` | View helpers (escHtml) |
| 33 | `apps/bot/src/dashboard.ts` | Dashboard routing & Auth middleware |
| 34 | `apps/bot/src/errors.ts` | Error handling helpers |
| 35 | `apps/bot/src/hono-app.ts` | Core Router, Redirects, Postbacks, Admin API |
| 36 | `apps/bot/src/plans.ts` | Quota management & Advisory locking |
| 37 | `apps/bot/src/ratelimit.ts` | Rate limiter re-export |
| 38 | `apps/bot/src/rollup.ts` | Nightly click aggregation & partitioning |
| 39 | `apps/bot/src/telegram.ts` | Raw Bot API wrappers |
| 40 | `apps/bot/src/validation.ts` | Zod schemas for API input |
| 41 | `apps/bot/src/worker.ts` | Worker entry point & Cron triggers |
| 42 | `apps/bot/tsconfig.json` | TypeScript configuration (ES2022/NodeNext) |
| 43 | `apps/bot/wrangler.toml` | Workers deployment & bindings configuration |

---

## 3. Detailed Findings

### 3.1. Performance & Scalability

#### [MED] Unoptimized Chart Query (Full Scan of 14d Raw Clicks)
*   **File:Line:** `apps/bot/src/dashboard-api.ts:202`
*   **Affected Endpoint:** `GET /bot/dash/api/stats/daily`
*   **Why:** The query joins the `clicks` table (partitioned but raw) for the last 14 days. On a high-traffic deployment, this scans millions of rows every time a user opens the Overview page.
*   **Root Cause:** The dashboard chart logic was implemented before the `click_daily` rollup was fully utilized for historical data.
*   **Best Fix:** Update the query to union `click_daily` for the first 13 days and only scan the `clicks` table for the current `current_date`.

#### [LOW] Broadcast Batch Size vs Worker CPU
*   **File:Line:** `apps/bot/src/broadcasts.ts:38`
*   **Affected Logic:** `processBroadcastBatch(batchSize = 300)`
*   **Why:** While 300 messages per minute fits within Telegram's rate limits (~30/s), the cumulative wait time (`MSG_INTERVAL_MS = 36`) plus network latency per request might approach the Workers wall-clock limit in slow network conditions.
*   **Root Cause:** Synchronous loop for message sending within a single batch.
*   **Best Fix:** Use `Promise.all` for sub-batches of 10-20 requests within the 300-count batch to parallelize network I/O while maintaining the overall 30/s limit.

### 3.2. Stability & Edge Cases

#### [MED] Rollup Catch-up Window is Too Narrow
*   **File:Line:** `apps/bot/src/rollup.ts:22`
*   **Affected Logic:** `rollupClicks()`
*   **Why:** The query only looks back 7 days (`ts >= current_date - 7`). If the nightly cron trigger fails for more than a week (e.g., binding issues, Postgres downtime), data older than 7 days will never be rolled into `click_daily`.
*   **Root Cause:** Arbitrary lookback window for idempotency.
*   **Best Fix:** Increase lookback to 14 or 30 days, or implement a "last_rolled_at" cursor.

#### [LOW] Bot Token Decryption Failure during Disconnect
*   **File:Line:** `apps/bot/src/dashboard-api.ts:288`
*   **Affected Endpoint:** `POST /bot/dash/api/bots/:id/disconnect`
*   **Why:** If `TOKEN_ENC_KEY` was rotated and the bot wasn't re-encrypted, `decryptToken` fails, returning a 500. The user cannot disconnect the bot via the UI to free a plan slot.
*   **Root Cause:** Hard dependency on decryption for a "remove" operation.
*   **Best Fix:** Allow disconnection (DB status update) even if Telegram webhook removal fails due to decryption error.

### 3.3. Security

#### [HIGH] Dangerous Dev Login Primitive
*   **File:Line:** `apps/bot/src/dashboard.ts:121`
*   **Affected Endpoint:** `POST /bot/auth/dev`
*   **Why:** If `ALLOW_DEV_LOGIN=1` is accidentally set in production, anyone can authenticate as any user by providing their Telegram ID.
*   **Root Cause:** Dev-only ATO (Account Takeover) bypass.
*   **Best Fix:** Add an explicit check for `c.env.ENVIRONMENT === 'production'` inside the handler to force-disable even if the toggle is set. (Note: current code checks `isLocal` via Origin header, which is a good mitigation but can be spoofed by non-browser clients).

#### [LOW] Missing XSS Protection on Custom Command Responses
*   **File:Line:** `apps/bot/src/botEngine.ts:214`
*   **Affected Logic:** `ctx.reply(esc(custom.response), { parse_mode: "HTML" })`
*   **Why:** While `esc()` is used, the engine allows `HTML` parse mode. If the streamer intends to use HTML tags, `esc()` will break them. If they don't, and `esc()` is missed elsewhere, it's a risk.
*   **Best Fix:** Clarify in UI if HTML is supported. If yes, use a subset-validator (like `sanitize-html` but for Telegram's limited tag set).

### 3.4. UI/UX & Mobile

#### [LOW] Stale State after Plan Upgrade
*   **File:Line:** `apps/bot/src/dashboard-views/client-script.ts:573`
*   **Why:** `upgrade()` opens the invoice link in a new tab. The dashboard doesn't poll for payment completion, requiring the user to manually refresh to see feature gates open (Broadcasts/Postbacks).
*   **Best Fix:** Implement a `setInterval` to poll `/bot/dash/api/me` or `/bot/dash/api/plan` while the invoice window is open.

---

## 4. Recommendations

1.  **Immediate:** Audit environment variables in Production to ensure `ALLOW_DEV_LOGIN` is `0` or unset.
2.  **Performance:** Refactor `GET /stats/daily` to utilize `click_daily`.
3.  **Reliability:** Increase `rollupClicks` lookback window to 30 days.
4.  **UX:** Add "Copy" buttons for Postback keys in Settings (already present for Links).
5.  **Monitoring:** Ensure `SENTRY_DSN` is set via `wrangler secret put` as noted in `wrangler.toml`.

---
*Audit performed by Accio Work AI assistant.*
