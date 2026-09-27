# Secrets Inventory — YourRank

Every secret the platform needs, where it goes, and what it's for.
**Never paste these into chat or commit them.** Use `wrangler secret put`
(for Workers) or GitHub repo Settings → Secrets (for Actions).

Legend:
- 🔴 **required** for the app to run
- 🟡 **required for that feature** (app runs without it, feature is off)
- ⚪ **optional / dev convenience**

---

## 1. Cloudflare Worker secrets

Set with: `wrangler secret put <NAME>` (or the API), from inside each app dir.
These live in the encrypted vault attached to the Worker, not in the repo.

### Leaderboard Worker (`yourrank-site`)

| Secret | Level | Purpose |
|---|---|---|
| `DATABASE_URL` | 🔴 | Supabase Postgres connection string. **Only if NOT using Hyperdrive.** With Hyperdrive bound, the Worker reads `env.HYPERDRIVE.connectionString` instead — so you can skip this. |
| `NOWPAYMENTS_API_KEY` | 🟡 | NOWPayments crypto billing. Without it, checkout is disabled (manual activation still works). |
| `NOWPAYMENTS_IPN_SECRET` | 🟡 | Verifies NOWPayments payment-webhook (IPN) callbacks. Without it, IPN verification fails and payments won't auto-activate. |
| `RESEND_API_KEY` | 🟡 | Password-reset emails via Resend. Without it, admin-generated reset links still work (they don't need email). |
| `MAIL_FROM` | 🟡 | Required when RESEND_API_KEY is set. From address for transactional emails (e.g. 'YourRank <hey@yourrank.site>'). |
| `PRO_PRICE_USD` | ⚪ | Pro plan price in USD. Defaults to 29 if unset. |
| `LEAD_WEBHOOK_URL` | ⚪ | Discord/Telegram webhook to ping on each new lead. |
| `TOKEN_ENC_KEY` | 🟡 | 64-char hex (32-byte) AES-256-GCM key. Encrypts postback keys at rest (shared/postback.ts reads `TOKEN_ENC_KEY`). Same value as the Bot Worker's `TOKEN_ENC_KEY`. |
| `DISCORD_MONITORING_WEBHOOK` | ⚪ | Discord webhook for monitoring/error alerts. |
| `LOGIN_BOT_TOKEN` | 🟡 | Telegram Login Widget signature verification for the Connections account-link flow. Use the same bot token as the Bot Worker. |
| `LOGIN_BOT_USERNAME` | 🟡 | Username of that login bot; required alongside `LOGIN_BOT_TOKEN` to show the Connect Telegram widget. Configure the bot's login domain as `yourrank.site`. |

### Bot Worker (`yourrank-bot`)

| Secret | Level | Purpose |
|---|---|---|
| `DATABASE_URL` | 🔴 | Same as above — only if NOT using Hyperdrive. |
| `TOKEN_ENC_KEY` | 🔴 | 32-byte hex (64 hex chars). AES-256-GCM key that encrypts streamers' Telegram bot tokens at rest. Already set. |
| `ADMIN_API_KEY` | 🔴 | Protects the `/bot/api/*` admin endpoints. Already set. |
| `IP_HASH_SALT` | 🔴 | Salt for hashing visitor IPs (we never store raw IPs). Already set. |
| `LOGIN_BOT_TOKEN` | 🟡 | The Telegram bot token used for the Telegram Login Widget on the bot dashboard. Without it, the login button won't render. |
| `LOGIN_BOT_USERNAME` | 🟡 | That login bot's @username (used by the widget). Set alongside LOGIN_BOT_TOKEN. |
| `PLATFORM_BOT_TOKEN` | 🟡 | The "YourRank" platform bot that sends Telegram Stars invoices. Required for in-app plan upgrades. |
| `PLATFORM_WEBHOOK_SECRET` | 🟡 | Secret for the Telegram Stars pre-checkout / payment webhook. |
| `ALLOW_DEV_LOGIN` | ⚪ | Set to `1` to enable the dev-only numeric-ID login (for testing). Never on in production. |
| `DISCORD_MONITORING_WEBHOOK` | ⚪ | Discord webhook for monitoring/error alerts. |

### Both Workers — bindings (not secrets, set in wrangler.toml)

| Binding | Type | Value |
|---|---|---|
| `SESSIONS` | KV namespace | id `26e47bcce19941839a20bd2cd5879e42` (shared — both Workers bind the SAME one) |
| `HYPERDRIVE` | Hyperdrive config | id `9e5b625bfdd84cd691b44c4780bdaf13` (matches both Worker configs in this repo) |
| `PUBLIC_BASE_URL` | plain-text var | bot Worker: `https://yourrank.site` |

---

## 2. GitHub Actions secrets

For CI to deploy the Workers automatically from `yourrank/yourrank` on push.
Set in: repo → Settings → Secrets and variables → Actions → New repository secret.

| Secret | Purpose |
|---|---|
| `CLOUDFLARE_API_TOKEN` | A Cloudflare API token with permission to deploy Workers scripts on the YourRank account (`Workers Scripts:Edit`, `Account:Read`, `Hyperdrive:Read`, `Workers KV Storage:Read`). This is what lets the GitHub Action run `wrangler deploy`. |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account id. Wrangler needs this to know which account to deploy to. |
| `SUPABASE_ACCESS_TOKEN` | Supabase personal access token for `supabase db push` in CI. |
| `SUPABASE_DB_PASSWORD` | Database password used by `supabase link --password` in CI. |

That's it for Actions. The Worker runtime secrets (`NOWPAYMENTS_*`, `TOKEN_ENC_KEY`, etc.) are **not** put in GitHub — they're set directly on the Workers via `wrangler secret put`, and CI just ships code (secrets persist across deploys).

> The GitHub deploy token itself (a PAT owned by a user account, not the org) is **not** a GitHub Actions secret — it's only needed if an Action pushes to other repos. For deploying your own Workers you only need the Cloudflare and Supabase secrets above.

---

## 3. What's already set (don't re-set these)

On the Workers right now:
- Bot: `TOKEN_ENC_KEY`, `ADMIN_API_KEY`, `IP_HASH_SALT` ✅
- Bot: `PUBLIC_BASE_URL` var ✅
- Hyperdrive + KV bindings on both ✅

## 4. What you still need to set, in priority order

1. 🟡 `NOWPAYMENTS_API_KEY` + `NOWPAYMENTS_IPN_SECRET` on the leaderboard — when you want crypto billing live.
2. 🟡 `LOGIN_BOT_TOKEN` + `LOGIN_BOT_USERNAME` on the bot — when you want the Bot tab's Telegram login to work (create a dedicated bot via @BotFather for the login widget).
3. 🟡 `PLATFORM_BOT_TOKEN` + `PLATFORM_WEBHOOK_SECRET` on the bot — when you want in-app Telegram Stars plan upgrades.
4. 🟡 `RESEND_API_KEY` on the leaderboard — only if you want emailed password resets.
5. For CI/CD: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_ACCESS_TOKEN`, and `SUPABASE_DB_PASSWORD` as GitHub Actions secrets.

## How to set a Worker secret (from your machine, in the app dir)

```bash
cd apps/leaderboard   # or apps/bot
npx wrangler secret put NOWPAYMENTS_API_KEY   # prompts, value never touches disk/git
```

---

## 5. TOKEN_ENC_KEY Rotation

Bot tokens encrypted at rest use `TOKEN_ENC_KEY` (AES-256-GCM). As of the
v1 prefix update, **all new encryptions** are prefixed with `v1:` so that a
future key rotation can introduce `v2:` with a new key while still decrypting
old entries.

### Blob format

| Version | Layout |
|---------|--------|
| Legacy (pre-rotation) | `[12-byte IV][ciphertext+tag]` |
| v1 (current) | `v1:[12-byte IV][ciphertext+tag]` |
| v2 (future) | `v2:[12-byte IV][ciphertext+tag]` |

On decrypt, the prefix determines which key to use. Legacy (no prefix) falls
back to the current key.

### How to rotate the key

1. Generate a new 32-byte hex key:
   ```bash
   openssl rand -hex 32
   ```
2. Set the old key aside (you'll need it to decrypt existing tokens):
   ```bash
   # Save old key
   OLD_KEY=<current TOKEN_ENC_KEY value>
   ```
3. Set the new key on the Bot Worker:
   ```bash
   cd apps/bot
   echo "<new-key-hex>" | wrangler secret put TOKEN_ENC_KEY
   ```
4. **Before** deploying new code that maps `v2:` to the new key, first deploy
   the reencrypt endpoint (it already exists at `POST /api/admin/reencrypt`).
5. Run the re-encrypt: this decrypts all tokens with the old key and
   re-encrypts with the new key (with `v1:` prefix). **You must temporarily
   set `TOKEN_ENC_KEY` back to the OLD key** during re-encryption, then switch
   to the new key after:
   ```bash
   # Temporarily restore old key
   echo "$OLD_KEY" | wrangler secret put TOKEN_ENC_KEY
   # Re-encrypt all tokens
   curl -X POST https://yourrank.site/bot/api/reencrypt \
     -H "x-api-key: $ADMIN_API_KEY"
   # Switch to new key
   echo "<new-key-hex>" | wrangler secret put TOKEN_ENC_KEY
   ```
6. Verify bots still work: check `GET /health` and send a message to a
   streamer's bot.

### Re-encrypt endpoint

`POST /api/admin/reencrypt` (requires `X-Api-Key: <ADMIN_API_KEY>`)

Response:
```json
{ "ok": true, "total": 5, "migrated": 3, "skipped": 2, "errors": 0 }
```

- **migrated**: tokens that were re-encrypted (old prefix or no prefix).
- **skipped**: tokens already on the current key version.
- **errors**: tokens that failed to decrypt (wrong key or corruption).
