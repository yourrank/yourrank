# Schema Audit — Jul 7, 2026

Compared live Supabase schema (27 tables) against source code SQL queries.
Two critical column mismatches found that cause runtime errors.

---

## Critical: Runtime Errors (P0)

### BUG-DB-001: `sites.postback_key` column doesn't exist

**File:** `apps/leaderboard/src/handlers/scores.js:19`
**Query:** `SELECT ... postback_key ... FROM sites WHERE postback_key=$1`
**Reality:** `sites` table has `postback_key_enc` (bytea), NOT `postback_key` (text). The plaintext `postback_key` lives on the `users` table.
**Impact:** Score postback API (`POST /api/scores`) throws a Postgres column-not-found error on every request. Entire feature broken.
**Root cause:** The postback_key was migrated from `sites` to `users` at some point, but scores.js was never updated. Meanwhile, migration `20260705000009` added `postback_key_enc` to `sites` (encrypted column) but the plaintext column was already gone.
**Fix:** Rewrite the query to JOIN on `users` for the postback_key lookup:

```js
// BEFORE (broken):
const site = await one("SELECT ... postback_key ... FROM sites WHERE postback_key=$1", [postbackKey]);

// AFTER (fixed):
const site = await one(
  `SELECT s.id, s.user_id, s.slug, s.name, s.tagline, s.sponsor, s.code, s.cta_url,
          s.prize_pool, s.period, s.ends_at, s.reset_note, s.blurb, s.extra_json,
          s.published, s.theme_json, s.updated_at
   FROM sites s JOIN users u ON u.id = s.user_id
   WHERE u.postback_key=$1`, [postbackKey]);
```

### BUG-DB-002: `users.bot_token` column doesn't exist

**File:** `apps/leaderboard/src/handlers/sites.js:146`
**Query:** `SELECT bot_token FROM users WHERE id=$1`
**Reality:** `users` table has no `bot_token` column. Bot tokens are stored in the `bots` table as `token_encrypted` (bytea, AES-256-GCM encrypted).
**Impact:** "Send test notification" feature throws a Postgres column-not-found error. Entire feature broken.
**Fix:** Query the `bots` table and decrypt:

```js
// BEFORE (broken):
const owner = await one("SELECT bot_token FROM users WHERE id=$1", [user.id]);
if (!owner?.bot_token) return bad("No Telegram bot connected.");
const result = await sendTelegramMessage(owner.bot_token, chatId, text);

// AFTER (fixed):
const bot = await one("SELECT token_encrypted FROM bots WHERE owner_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 1", [user.id]);
if (!bot?.token_encrypted) return bad("No Telegram bot connected.");
const token = await decryptToken(Buffer.from(bot.token_encrypted));
const result = await sendTelegramMessage(token, chatId, text);
```

---

## Verified: All Tables Present

| Table | Status | Notes |
|-------|--------|-------|
| users | ✅ | 17 columns, all code references match |
| sites | ✅ | 22 columns (except postback_key - see BUG-DB-001) |
| payments | ✅ | 12 columns, all match |
| subscriptions | ✅ | 7 columns, all match |
| players | ✅ | 6 columns (id, site_id, name, amount, prize, sort) |
| bots | ✅ | 12 columns, all match |
| broadcasts | ✅ | 13 columns, all match (cursor_tg_user_id correct) |
| archives | ✅ | 5 columns, all match |
| clicks | ✅ | 9 columns, all match |
| click_daily | ✅ | 4 columns, all match |
| short_links | ✅ | 5 columns, all match |
| partners | ✅ | 8 columns, all match |
| offers | ✅ | 10 columns, all match |
| conversions | ✅ | 9 columns, all match |
| leads | ✅ | 6 columns, all match |
| site_stats | ✅ | 6 columns, all match |
| site_stats_hourly | ✅ | 6 columns, all match |
| site_referrers | ✅ | 4 columns, all match |
| admin_audit | ✅ | 7 columns, all match |
| bot_commands | ✅ | Present |
| bot_subscribers | ✅ | Present |
| player_subscriptions | ✅ | 6 columns, all match |
| stream_channels | ✅ | Present (unused in code) |
| clicks_2026_07/08/09 | ✅ | Partition tables |
| clicks_default | ✅ | Default partition |

## Verified: No Missing Tables

All tables referenced in code exist in the database. No migration needed for missing tables.
