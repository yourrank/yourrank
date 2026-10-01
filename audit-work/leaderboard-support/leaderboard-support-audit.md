# Production-Readiness Audit Report: Leaderboard Support

**Date**: July 24, 2026
**Scope**: apps/leaderboard/ (Config, Build, Metadata, Stats)

## 1. Executive Summary
The audit of the 12 tracked support files for the Leaderboard Worker reveals a stable foundation with high-quality documentation. However, critical inconsistencies between `wrangler.toml` and `STAGING.md` pose a risk of production data corruption during staging tests. Additionally, the analytics engine in `src/stats.js` contains timezone normalization bugs and sub-optimal query patterns that will affect dashboard accuracy and latency.

## 2. Manifest and Audit Count
| # | File Path | Type | Status |
|---|-----------|------|--------|
| 1 | `apps/leaderboard/.dev.vars.example` | Config | Audited |
| 2 | `apps/leaderboard/.env.example` | Config | Audited |
| 3 | `apps/leaderboard/.eslintrc.json` | Tooling | Audited |
| 4 | `apps/leaderboard/SENTRY-SETUP.md` | Docs | Audited |
| 5 | `apps/leaderboard/STAGING.md` | Docs | Audited |
| 6 | `apps/leaderboard/build.js` | Build | Audited |
| 7 | `apps/leaderboard/bun.lock` | Metadata | Audited |
| 8 | `apps/leaderboard/package.json` | Metadata | Audited |
| 9 | `apps/leaderboard/tsconfig.json` | Tooling | Audited |
| 10| `apps/leaderboard/wrangler.toml` | Config | Audited |
| 11| `apps/leaderboard/src/demo-data.js` | Source | Audited |
| 12| `apps/leaderboard/src/stats.js` | Source | Audited |

**Total Count**: 12 files.

## 3. Findings & Recommendations

### [HIGH] Staging-to-Production Isolation Leak
- **File**: `apps/leaderboard/wrangler.toml:91-94`
- **Finding**: A comment in the staging environment section incorrectly states that it points to the same Supabase DB as production. This contradicts `STAGING.md`. If followed, staging testing will overwrite production data.
- **Root Cause**: Stale or incorrect configuration comments.
- **Fix**: Update `wrangler.toml` to mandate a separate Hyperdrive ID and remove the misleading comment.

### [MEDIUM] Timezone Mismatch in Analytics
- **File**: `apps/leaderboard/src/stats.js:8`
- **Finding**: The dashboard uses UTC ISO strings for date filtering while the database `to_char` function uses the DB server's local time. This causes data to shift or go missing at day boundaries for non-UTC users.
- **Root Cause**: Inconsistent timezone normalization between JS and Postgres.
- **Fix**: Cast all date comparisons to UTC in the SQL query using `AT TIME ZONE 'UTC'`.

### [MEDIUM] Naive Asset Inlining (Build Script)
- **File**: `apps/leaderboard/build.js:37`
- **Finding**: Assets are read as `utf8` strings without type or size validation. Large or binary assets (favicons, PNGs) will be corrupted and could cause the Worker bundle to exceed Cloudflare's size limits.
- **Root Cause**: Minimalist build script lacking production safety checks.
- **Fix**: Implement extension filtering (only `.css`, `.js`) and add a bundle size warning.

### [MEDIUM] Unhandled Exceptions in `getStats`
- **File**: `apps/leaderboard/src/stats.js:7`
- **Finding**: The primary stats aggregator lacks a `try/catch` block. A single transient DB failure or timeout will cause the entire dashboard to return a 500 error.
- **Root Cause**: Inconsistent error handling compared to `getHeatmap` and `getTopReferrers`.
- **Fix**: Wrap implementation in `try/catch` and return partially populated data if specific queries fail.

### [LOW] Sequential Query Latency
- **File**: `apps/leaderboard/src/stats.js:11`
- **Finding**: `ownerRow` is fetched with an `await` before the parallel `Promise.all` block starts. This adds a redundant 50-100ms round-trip to every dashboard load.
- **Root Cause**: Improper async flow design.
- **Fix**: Move the owner lookup into the `Promise.all` array.

### [LOW] Hardcoded Branding in Demo Data
- **File**: `apps/leaderboard/src/demo-data.js`
- **Finding**: Specific partner names are hardcoded in the shared demo helper.
- **Root Cause**: Marketing data coupled with source code.
- **Fix**: Externalize demo content to a JSON configuration file.

### [LOW] Ambiguous Linting Environment
- **File**: `apps/leaderboard/.eslintrc.json`
- **Finding**: Configures both `node: true` and `browser: true`. This allows developers to use Node-only APIs (like `process`) that will fail in the `workerd` environment.
- **Root Cause**: Generic boilerplate config.
- **Fix**: Switch to `eslint-plugin-worker` to accurately lint for the Worker runtime.

## 4. Performance & Scalability Notes
- The `site_visitors` query in `stats.js` uses a `COUNT(*)` over a 30-day window. As the user base grows, this will require a composite index on `(site_id, last_seen)` to remain performant.
- The build process inlines all assets into a single JS file. While this simplifies deployment, it increases cold-start time. Consider using Cloudflare KV or R2 for large static assets if the bundle exceeds 2MB.

---
*End of Report*
