# YourRank — Current Runtime and Deployment Architecture

This document describes **CURRENT** Worker, database, session, routing, and deployment reality.
The owner-approved **TARGET** product model is [the community operating system architecture](docs/YOURRANK_PRODUCT_ARCHITECTURE.md):
Home → Community → Activities → People → Rewards → Insights → Settings.

Target product grouping does not change Worker ownership, URLs, schema, billing behavior, or deployment topology by itself. Those remain governed by current code, configuration, route manifests, migrations, and tests until a deliberate migration changes them.

## Frontend boundary

There is one canonical application frontend: the `apps/leaderboard` Worker on
`yourrank.site`. It owns the homepage entrypoint's surrounding application,
marketing subpages, auth, dashboard, account/settings, help, admin, public
boards, and APIs. `apps/web` is intentionally reduced to the animated
marketing homepage only. The apex Worker proxies `/` and the homepage's
`/_next/*` assets to that app.

`app.yourrank.site` and `next.yourrank.site` do not serve application routes.
They return a 301 to the equivalent apex path. The homepage proxy sends
`x-yr-marketing: 1`; the Next middleware permits only marked requests so the
internal proxy cannot loop.

- **Leaderboards**: hosted, editable public leaderboard page per streamer at `yourrank.site/<slug>`.
- **Telegram bots**: multi-tenant bot engine, promo-code delivery, tracked referral links, click/conversion analytics.

A streamer signs up **once**. That single account owns both their leaderboard and their bot.

## Public Viewer Account and Membership boundary

The Leaderboard Worker also owns the current Viewer Account product. Global
`/me` is the account-scoped **My communities** index derived from persisted
`viewers` → `site_viewers` relationships. `/<slug>/me`, and `/me` on a creator
custom domain, are the creator-scoped **My Community** surface rendered by
`packages/shared/src/site-render.ts`.

Membership is never created by anonymous/passive browsing or generic OAuth. It
is created only by explicit site-bound Join or atomically with an approved safe
action. A creator-scoped membership page resolves that relationship before
reading personalized history, returns `private, no-store`, and varies on the
Viewer session cookie.

Wave J composes three separate current read owners rather than a universal
history service:

- Participation: at most 25 successful free code-drop Claims from
  `code_drop_claims`, matched by selected site, canonical `viewer_id`, and exact
  `site_viewer_id`, excluding system Viewers.
- Credits: the existing membership `credit_ledger` read; credit history is not
  reclassified as Participation.
- Claims: at most 50 Viewer-safe rows from the canonical Wave G redemption
  adapter. Terminal timestamps come from `claim_completed` / `claim_cancelled`
  audit events, never `redemptions.updated_at`.

Recognition is not currently rendered: players, archives/Hall of Fame, mixed
tournament results, Reviews, and challenge data do not provide a safe persisted
selected-site record with canonical Viewer/Membership linkage. No fuzzy name
matching or replacement Recognition persistence exists. Global `/me` remains
an index and does not aggregate these histories. Wave K automation is not part
of this runtime.

---

## The picture

```
                          yourrank.site  (one Cloudflare zone)
                                  │
              ┌───────────────────┴────────────────────┐
              │ route: /,/login,/signup,/dashboard,     │ route: /bot/*, /dashboard/telegram*,
              │        /<slug>, /go/<slug>              │        /hook/*, /r/*, /pb, /pb/*
              ▼                                          ▼
    ┌──────────────────┐                      ┌──────────────────────┐
    │ LEADERBOARD       │                      │ BOT WORKER            │
    │ Worker (JS)       │                      │ Worker (TS + Hono +   │
    │  - SSR pages      │                      │   grammY)             │
    │  - dashboard      │                      │  - /hook/:secret →    │
    │  - password auth  │                      │    all streamer bots  │
    │  - NOWPayments    │                      │  - /r/:slug redirect  │
    │  - analytics      │                      │  - /pb/:key postbacks │
    └────────┬──────────┘                      │  - Telegram-login     │
             │                                 │  - Telegram Stars     │
             shared session (Postgres)│  - cron: broadcasts,  │
                    │        yr_session cookie        │    click rollup        │
             │      (Domain=.yourrank.site)    └───────────┬───────────┘
             │                                             │
             └──────────────────┬──────────────────────────┘
                                ▼
                    ┌───────────────────────────┐
                    │  Cloudflare Hyperdrive     │  (connection pooling)
                    └────────────┬──────────────┘
                                 ▼
                    ┌───────────────────────────┐
                    │  Supabase Postgres         │
                    │  project: yourrank          │
                    │  ONE users table +         │
                    │  sites/players/...(LB) +   │
                    │  bots/offers/clicks/...(bot)│
                    └───────────────────────────┘

  Billing: NOWPayments (leaderboard Pro) + Telegram Stars (bot plans) → one payments ledger
  Deploy:  both Workers deploy to the same Cloudflare "YourRank" account
```

## Why this shape

| Choice | Reason |
|---|---|
| **One Postgres, one `users` table** | The whole point of "one dashboard" is one account. Same email = same streamer, who can have a leaderboard AND a bot. |
| **Supabase (not D1)** | The bot engine relies on Postgres features D1 can't do: monthly-**partitioned** `clicks`, `count(*) FILTER`, `make_interval`, JSONB. Moving the bot to SQLite would be a downgrade and lose partitioning. So the *leaderboard* moved to Postgres instead. |
| **Hyperdrive in front of Postgres** | Workers are serverless; opening a raw Postgres connection per request exhausts Supabase's connection cap. Hyperdrive pools + caches. Both Workers share one Hyperdrive config. |
| **Two Workers, not one** | The two apps have opposite runtimes (plain-JS Worker vs TS+Hono+grammY) and the bot needs **cron triggers** (broadcasts, click rollup) the leaderboard doesn't. Keeping them separate avoids a risky full rewrite and lets each deploy independently. They *feel* like one app via a shared nav + shared session. |
| **Shared session in Postgres** | One `yr_session` cookie scoped to `.yourrank.site` + one shared `sessions` table (both Workers reach it via the same Hyperdrive) = log in once, both Workers recognize you. Sessions used to live in the `SESSIONS` KV namespace; that namespace is now only a legacy rate-limit fallback. |

## The seam that makes it "one app": the `users` table

Both original systems had a `users` table. Unified:

- `email` (citext, unique) — the join key. Same email across both products = same row.
- `password_hash` / `password_salt` — nullable. Set for password signups (leaderboard flow).
- `telegram_user_id` — nullable, unique. Set for Telegram-login (bot flow).
- A user can **link both**: sign up with email, later connect Telegram (or vice versa).
- `plan` (`free`/`pro`/`agency`), `plan_expires_at`, `status`, `is_admin`, `postback_key` — shared across both products.

Everything else hangs off `user_id`: `sites`/`players`/`archives`/`site_stats` (leaderboard), `bots`/`offers`/`short_links`/`clicks`/`conversions`/`broadcasts` (bot), and one shared `subscriptions`/`payments` ledger.

## Deploy targets

- Cloudflare account: **YourRank**
- Supabase project: **yourrank**
- Domain: **yourrank.site**
- Two Workers on the one zone, routes as in the diagram.
- Secrets (per Worker, via `wrangler secret put`): `DATABASE_URL` (or Hyperdrive binding), `TOKEN_ENC_KEY` (bot), `IP_HASH_SALT` (bot), `NOWPAYMENTS_API_KEY` + `NOWPAYMENTS_IPN_SECRET` (leaderboard), `PLATFORM_BOT_TOKEN` + `PLATFORM_WEBHOOK_SECRET` (bot billing), `RESEND_API_KEY` (optional email), `LEAD_WEBHOOK_URL` (optional).

Apply migrations in `supabase/migrations/` via `supabase db push` (see DEPLOY.md), and check each app's `wrangler.toml` for route config.
