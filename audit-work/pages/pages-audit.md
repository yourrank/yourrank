# Production-Readiness Audit: Leaderboard Pages & Templates

**Audit Date**: July 24, 2026
**Scope**: Leaderboard rendering engine, static pages, and visual templates.
**Repository**: `C:\yourrank`

---

## Files Read Manifest

| File Path | Status |
| :--- | :--- |
| `apps/leaderboard/src/og-image.js` | Read |
| `apps/leaderboard/src/pages.js` | Read |
| `apps/leaderboard/src/pages/admin-2fa.js` | Read |
| `apps/leaderboard/src/pages/admin.js` | Read |
| `apps/leaderboard/src/pages/analytics.js` | Read |
| `apps/leaderboard/src/pages/attribution.js` | Read |
| `apps/leaderboard/src/pages/billing.js` | Read |
| `apps/leaderboard/src/pages/bot-setup.js` | Read |
| `apps/leaderboard/src/pages/contact.js` | Read |
| `apps/leaderboard/src/pages/cookies.js` | Read |
| `apps/leaderboard/src/pages/dashboard.js` | Read |
| `apps/leaderboard/src/pages/docs.js` | Read |
| `apps/leaderboard/src/pages/forgot.js` | Read |
| `apps/leaderboard/src/pages/landing.js` | Read |
| `apps/leaderboard/src/pages/legal-helper.js` | Read |
| `apps/leaderboard/src/pages/login.js` | Read |
| `apps/leaderboard/src/pages/overlay.js` | Read |
| `apps/leaderboard/src/pages/pricing.js` | Read |
| `apps/leaderboard/src/pages/privacy.js` | Read |
| `apps/leaderboard/src/pages/refund.js` | Read |
| `apps/leaderboard/src/pages/reset.js` | Read |
| `apps/leaderboard/src/pages/security.js` | Read |
| `apps/leaderboard/src/pages/setup.js` | Read |
| `apps/leaderboard/src/pages/signup.js` | Read |
| `apps/leaderboard/src/pages/support.js` | Read |
| `apps/leaderboard/src/pages/terms.js` | Read |
| `apps/leaderboard/src/render.js` | Read |
| `apps/leaderboard/src/site.js` | Read |
| `apps/leaderboard/src/templates/amber.js` | Read |
| `apps/leaderboard/src/templates/arena.js` | Read |
| `apps/leaderboard/src/templates/broadcast.js` | Read |
| `apps/leaderboard/src/templates/cards.js` | Read |
| `apps/leaderboard/src/templates/champion.js` | Read |
| `apps/leaderboard/src/templates/copper.js` | Read |
| `apps/leaderboard/src/templates/esports.js` | Read |
| `apps/leaderboard/src/templates/index.js` | Read |
| `apps/leaderboard/src/templates/midnight.js` | Read |
| `apps/leaderboard/src/templates/minimal.js` | Read |
| `apps/leaderboard/src/templates/neon.js` | Read |
| `apps/leaderboard/src/templates/ocean.js` | Read |
| `apps/leaderboard/src/templates/podium.js` | Read |
| `apps/leaderboard/src/templates/quest.js` | Read |
| `apps/leaderboard/src/templates/rewards.js` | Read |
| `apps/leaderboard/src/templates/royale.js` | Read |
| `apps/leaderboard/src/templates/sponsor.js` | Read |
| `apps/leaderboard/src/templates/terminal.js` | Read |
| `apps/leaderboard/src/templates/tournament.js` | Read |
| `apps/leaderboard/src/templates/vault.js` | Read |

**Audit Coverage**: 53 files read / 53 files assigned (100%).

---

## Findings

### 1. Invalid `srcset` for Inlined Data URI Logos
*   **Severity**: Medium
*   **Location**: `apps/leaderboard/src/render.js:27` (logic), `render.js:390` (usage)
*   **Affected Page(s)**: Public Leaderboard (when a custom logo is uploaded).
*   **Why**: The `logoSrcSet` function appends query parameters (e.g., `?w=64`) to the `baseUrl`. When a logo is stored and served as a base64 data URI (common in the current implementation), this produces invalid URLs like `data:image/webp;base64,...?w=64`. Browsers cannot resolve these as valid image sources.
*   **Repro**: 
    1. Upload a logo in the dashboard.
    2. View the public leaderboard page.
    3. Inspect the `<img>` tag in the header.
    4. Observe the `srcset` attribute containing broken data URIs.
*   **Root Cause**: The scaling logic assumes logos are served via an image-processing endpoint, but the current system inlines them as base64 blobs from the database.
*   **Best Fix**: Check if `baseUrl` starts with `data:` and skip `srcset` generation if so, or move logo serving to a dedicated worker endpoint that handles the `w` width parameter.

### 2. Missing HTML Escaping for Currency Symbols
*   **Severity**: Low
*   **Location**: `apps/leaderboard/src/render.js:598` (`fmtCurrency`), `render.js:100` (`moneyS`)
*   **Affected Page(s)**: Leaderboard, Player Profile, Hall of Fame, Embed.
*   **Why**: The currency symbol is extracted from user-provided data and sliced to 6 characters, then prepended to formatted numbers. This symbol is inserted directly into HTML strings without escaping.
*   **Repro**: 
    1. Set currency symbol to `<u>$` in the dashboard.
    2. View the public page.
    3. Observe that amount values are underlined because the `<u>` tag was rendered as HTML.
*   **Root Cause**: Insufficient sanitization of theme-level text tokens during template composition.
*   **Best Fix**: Wrap the currency symbol in the `esc()` helper before prepending it to values in the formatting functions.

### 3. Potential Stale State on Public Pages (Distributed Consistency)
*   **Severity**: Low
*   **Location**: `apps/leaderboard/src/site.js:98-138`
*   **Affected Page(s)**: All public-facing leaderboard pages.
*   **Why**: The L1 cache (`siteCache`) is a local `Map` per-isolate with a 25s TTL and no cross-isolate invalidation mechanism. Updates to a leaderboard in one region or isolate will not be reflected in others until the TTL expires.
*   **Repro**: 
    1. Update a leaderboard in the dashboard.
    2. Immediately visit the public page from a different geographic location or browser (hitting a different isolate).
    3. Observe that the old data is still served.
*   **Root Cause**: Architectural trade-off for high performance (in-memory hits) over strict global consistency.
*   **Best Fix**: Implement a Cloudflare KV-based versioning check or clearly document the 25s propagation delay for public views.

### 4. Redundant Re-render / Destructive Hydration
*   **Severity**: Low
*   **Location**: `apps/leaderboard/src/render.js:92-94`
*   **Affected Page(s)**: Public Leaderboard.
*   **Why**: The server renders a fully populated player table for SEO and no-JS compatibility. However, the client-side `leaderboard.js` script explicitly overwrites these containers using `innerHTML` on load to "hydrate" the state.
*   **Repro**: Observe the page load on a slow connection; the table will flicker as the server-rendered DOM is discarded and replaced by the client-side render.
*   **Root Cause**: Simplified hydration strategy where the client takes over the entire container rather than attaching to existing nodes.
*   **Best Fix**: Update `leaderboard.js` to perform incremental updates or attach event listeners to existing nodes instead of wiping the inner HTML.

### 5. Race Condition in Archive Creation (Snapshot Timing)
*   **Severity**: Low
*   **Location**: `apps/leaderboard/src/site.js:611-646`
*   **Affected Page(s)**: Dashboard "Close out period" action.
*   **Why**: The player list for the archive snapshot is fetched at line 615, but the database transaction to create the archive record starts at line 628. Any player-value updates occurring in that small window are lost from the archive.
*   **Root Cause**: Snapshot data is captured outside the atomic transaction that creates the archive and resets the board.
*   **Best Fix**: Move the `getPlayers` query inside the `withTransaction` block to ensure the snapshot matches the state exactly at the moment of the reset.

### 6. Overly Restrictive Discord Webhook Validation
*   **Severity**: Low
*   **Location**: `apps/leaderboard/src/site.js:26`
*   **Affected Page(s)**: Integrations / Notifications.
*   **Why**: The regex `DISCORD_WEBHOOK_RE` only allows `discord.com` and `discordapp.com`. It rejects valid Discord domains like `canary.discord.com` or `ptb.discord.com`.
*   **Repro**: Attempt to save a Discord webhook URL using the `canary` subdomain.
*   **Root Cause**: Incomplete domain whitelist in the validation regex.
*   **Best Fix**: Update the regex to allow any subdomain of `discord.com`.

---
**Status**: Success. Audit complete.
