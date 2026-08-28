# YourRank

> **YourRank is the community operating system for streamers.**

The owner-approved target product architecture is documented in
[`docs/YOURRANK_PRODUCT_ARCHITECTURE.md`](docs/YOURRANK_PRODUCT_ARCHITECTURE.md).
The repository's current runtime still includes two principal HTTP Worker
boundaries:

- **Leaderboards** — hosted, editable public leaderboard page per streamer at `yourrank.site/<slug>`.
- **Telegram bots** — multi-tenant bot engine, promo-code delivery, tracked referral links, click/conversion analytics.

A streamer signs up once and uses one dashboard backed by one Supabase Postgres
database. These current Worker capabilities are implementation reality, not the
target top-level product information architecture.

## Frontend boundary

The apex `yourrank.site` Leaderboard Worker is the canonical application
surface: marketing pages, auth, dashboard, account/settings, help, admin,
public boards, and APIs all live there. `apps/web` contains only the animated
marketing homepage. The apex proxies `/` and its `/_next/*` assets to that
homepage; it does not proxy any other application surface.

Requests to `app.yourrank.site` and `next.yourrank.site` are redirected to the
same path on `yourrank.site`. The homepage proxy carries an internal marker so
the proxied request can render without being redirected back to the apex.

## Repo layout

```text
yourrank/
├── ARCHITECTURE.md          current runtime/deployment architecture
├── PRODUCT.md               concise target product summary
├── docs/YOURRANK_PRODUCT_ARCHITECTURE.md
│                            canonical target product architecture
├── DEPLOY.md                one-time setup, then two `wrangler deploy`s
├── supabase/
│   └── migrations/          SQL migrations (applied via `supabase db push`)
├── packages/shared/         code + specs shared by both Workers
│   ├── src/session.ts       cross-Worker session (yr_session + Postgres sessions)
│   ├── src/dashboard-routes.ts / dashboard-nav.ts
│   │                        current route semantics + navigation presentation
│   └── docs/                session, routing, Telegram login, dashboard shell
└── apps/
    ├── leaderboard/         Cloudflare Worker (JS) — root of yourrank.site
    │   ├── src/             SSR pages, dashboard, password auth, NOWPayments
    │   └── wrangler.toml    route: yourrank.site/*
    ├── bot/                 Cloudflare Worker (TS + Hono + grammY)
    │   ├── src/             /bot/*, /dashboard/telegram*, /hook/*, /r/*, /pb, /pb/*
    │   └── wrangler.toml    routes: /bot/*, /dashboard/telegram*, /hook/*, /r/*, /pb, /pb/*
    └── consumer/            Cloudflare Queue consumer (no HTTP routes)
        ├── src/worker.js    drains yourrank-events: clicks, conversions,
        │                    analytics bumps, notifications; DLQ → Discord alert
        └── wrangler.toml    consumes yourrank-events + yourrank-events-dlq
```

> ⚠️ **The consumer is not optional.** The leaderboard and bot Workers only
> *enqueue* analytics events; if `apps/consumer` isn't deployed, the
> `yourrank-events` queue fills up and dashboard analytics (views, clicks,
> conversions) silently starve. Deploy it with the other two Workers — see
> DEPLOY.md §5.

## Quick mental model

```text
                    yourrank.site (one Cloudflare zone)
        /*  (root) ──► Leaderboard Worker      /bot,/hook,/r,/pb ──► Bot Worker
              │                                          │
              └──────── shared yr_session + sessions (Postgres) ────┤
              └──────── Supabase Postgres (Hyperdrive) ──┘
                        one users table = one account
```

For product direction, start with **docs/YOURRANK_PRODUCT_ARCHITECTURE.md**.
For current runtime/deployment work, start with **ARCHITECTURE.md**, then **DEPLOY.md**.

## Quick Start

### Prerequisites

- **Node.js** >= 20
- **[bun](https://bun.sh)** (used as package manager & runtime)
- **[Supabase](https://supabase.com)** account (Postgres database)
- **[Cloudflare](https://cloudflare.com)** account (Workers deployment)
- **[Wrangler](https://developers.cloudflare.com/workers/wrangler/)** CLI (`npm i -g wrangler`)

### Clone & Install

```bash
git clone https://github.com/yourrank/yourrank.git
cd yourrank
bun install
```

### Environment Variables

Copy the example files and fill in your values:

```bash
cp apps/bot/.env.example apps/bot/.env
cp apps/leaderboard/.env.example apps/leaderboard/.env
```

Each file is commented with what's required vs optional. Key variables:

| Variable | Where | Description |
|---|---|---|
| `DATABASE_URL` | both apps | Supabase direct Postgres connection (not the pooler) |
| `TOKEN_ENC_KEY` | bot | 32-byte hex key for encrypting bot tokens at rest |
| `ADMIN_API_KEY` | bot | Protects `/bot/api/*` admin endpoints |
| `LOGIN_BOT_TOKEN` | bot | Telegram bot used for the Login widget |

### Database Setup

Apply migrations via Supabase CLI:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

This runs all migrations in `supabase/migrations/` (in timestamp order) against your Supabase database.

### Local Development

1. Start the local Postgres container:
```bash
docker compose up -d
```

2. Copy the local dev vars (these are not committed):
```bash
cp apps/leaderboard/.dev.vars.example apps/leaderboard/.dev.vars
cp apps/bot/.dev.vars.example apps/bot/.dev.vars
```

3. Apply the migrations to the local database:
```bash
for f in $(ls supabase/migrations/*.sql | sort); do
  psql "postgresql://postgres:postgres@localhost:5432/yourrank" -f "$f"
done
```

4. Run the Workers:
```bash
# Leaderboard app (yourrank.site/*)
cd apps/leaderboard && bun run dev

# Bot app (/bot/*, /dashboard/telegram*, /hook/*, /r/*, /pb, /pb/*)
cd apps/bot && bun run dev
```

The bot Worker’s deployed entrypoint is `src/worker.ts`, and `bun run dev` uses `wrangler dev` to match production routing more closely.
Because `/assets/*` belongs to the leaderboard Worker’s root route, run the
leaderboard Worker alongside the bot Worker for local dashboard styling. A
standalone bot Worker does not serve those shared assets.

For webhook testing during local debug, the bot app will need a public tunnel (e.g. `cloudflared tunnel`) to receive Telegram webhooks.

### Deploy

```bash
# Deploy all three Workers (leaderboard + bot + queue consumer)
cd apps/leaderboard && wrangler deploy
cd apps/bot && wrangler deploy
bun run --cwd packages/shared build && cd apps/consumer && wrangler deploy
```

See **DEPLOY.md** for first-time Cloudflare setup (routes, KV namespaces, Hyperdrive, secrets).

### Staging load test

The capacity ramp is an opt-in k6 harness. It requires an explicit target and
board slug, has no production default, and refuses `yourrank.site` /
`www.yourrank.site`. Because production boards can also use custom domains,
any non-local hostname requires the explicit
`I_KNOW_THIS_IS_NOT_PRODUCTION=true` acknowledgement after verifying that the
target uses an isolated staging database.

After provisioning an isolated staging database and seeding the fixtures in
`/home/ubuntu/audit/CAPACITY_AUDIT.md` §12, run the mixed viewer plan:

```bash
TARGET_URL=https://staging.example.test BOARD_SLUG=large-board \
I_KNOW_THIS_IS_NOT_PRODUCTION=true \
k6 run docs/load-test.js
```

The plan runs T1–T7 at 100 → 250 → 500 → 1,000 → 2,500 → 5,000 → 10,000
VUs, exercising board HTML, a held SSE stream, page-two pagination, search,
and a `/go` redirect. Run the audit's SSE-only test separately with `STAGE=T0`:

```bash
TARGET_URL=https://staging.example.test BOARD_SLUG=large-board \
I_KNOW_THIS_IS_NOT_PRODUCTION=true \
STAGE=T0 k6 run docs/load-test.js
```

To run one mixed stage, set `STAGE=T1` through `STAGE=T7`; it ramps to that
stage's target, holds for the audit duration, and ramps down. HTTP 429
responses are expected when many VUs share the load generator's source IP:
the harness accepts them, excludes them from the regular request failure
threshold, and reports their share in the `rate_limited` metric (tagged by
surface). This does not weaken application limits. To measure origin capacity
instead of limiter shedding, run from distributed source IPs or arrange
rate-limit keys that distinguish the load-generator clients; alternatively,
reduce the search/pagination request share and interpret the shed rate
separately. Threshold failures still require investigation: board-render p95
under 1.5 seconds, regular non-429 request errors under 1%, and early SSE
closes under 5%. The k6 summary reports p50/p95/p99 timings; correlate it with
Worker CPU, Hyperdrive pool errors, Supabase CPU/connections, and queue backlog
as described in the audit.
**Never point this harness at production.**

## Provenance

Merged from `rabavadev/yourrank` (leaderboards, D1→Postgres ported) and
the bot engine (already on Workers/Postgres). The leaderboard's D1/SQLite
data layer was rewritten to share the bot's Postgres.
