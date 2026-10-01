# YourRank — Telegram-login ⇄ Password account mapping

Goal: **one `users` row per real person**, regardless of whether they arrived
via email+password (leaderboard) or via the Telegram Login Widget (bot). Same
email = same person. A password user can link Telegram; a Telegram user can add
an email+password. Either path ends up authenticated by the one shared session
(`yr_session`, see `session.md`).

The unified `users` row carries both credential sets:

```
users(
  id UUID PK, email CITEXT UNIQUE,
  password_hash TEXT, password_salt TEXT,     -- password auth (nullable)
  telegram_user_id BIGINT UNIQUE,             -- telegram auth  (nullable)
  display_name TEXT, plan plan_tier, ... )
```

`email` and `telegram_user_id` are both **UNIQUE** and both **nullable** — a
user may have either, both, or (transiently) be identified by only one.

---

## Identity rules (deterministic)

A person is the same account if **any** of these match an existing row:
1. same `telegram_user_id`, or
2. same `email` (CITEXT — case-insensitive).

We never auto-merge two *different* existing rows (one with only email, one with
only telegram) silently — that requires an explicit, verified link step (below),
because auto-merging on a coincidental email would let someone hijack an account.

---

## A. Telegram login (bot side) — find or create

After `verifyTelegramLogin(...)` passes (HMAC check against `LOGIN_BOT_TOKEN`,
as in `dashboard.ts`), resolve the account by `telegram_user_id`. The widget
gives us `id`, names, `username` — **never an email**.

```sql
-- Upsert by telegram_user_id. Does NOT touch email/password.
INSERT INTO users (telegram_user_id, display_name)
VALUES ($1, $2)                 -- $1 = tg id (BIGINT), $2 = first+last or @username
ON CONFLICT (telegram_user_id) DO UPDATE
   SET display_name = COALESCE(EXCLUDED.display_name, users.display_name),
       updated_at   = now()
RETURNING id;
```

Then `createSession(env, id)` and set `yr_session`. This is exactly the bot's
current upsert (`hono-app`/`dashboard.ts`) — kept as-is.

> A brand-new Telegram user has `email = NULL`. They can add email+password
> later (section C) to unlock the leaderboard side.

---

## B. Password login / signup (leaderboard side) — find or create

Signup hashes with the existing PBKDF2 `hashPassword` (keep `auth.js`'s crypto):

```sql
-- Signup: create by email. telegram_user_id stays NULL until linked.
INSERT INTO users (email, password_hash, password_salt, display_name)
VALUES ($1, $2, $3, $4)         -- $1 email (CITEXT), $2 hash, $3 salt, $4 name
ON CONFLICT (email) DO NOTHING  -- app treats a no-row result as "email taken"
RETURNING id;
```

```sql
-- Login: fetch the hash/salt for verifyPassword().
SELECT id, password_hash, password_salt, plan, status
FROM users
WHERE email = $1                -- CITEXT, case-insensitive
  AND password_hash IS NOT NULL;
```

If `password_hash IS NULL` but the row exists, this is a **Telegram-only**
account trying to use a password that was never set → tell them to log in with
Telegram, or set a password via the link flow (section C).

---

## C. Password user LINKS their Telegram

User is already logged in via password (`currentUserId` → `uid`). They click the
Telegram Login Widget in **Settings**. We verify the widget hash, then attach
`telegram_user_id` to their existing row — **only if that Telegram id isn't
already owned by someone else**.

```sql
-- Guard: is this telegram id already attached to a DIFFERENT user?
SELECT id FROM users WHERE telegram_user_id = $1 AND id <> $2;   -- $1 tg id, $2 uid
--  -> if a row comes back: refuse ("that Telegram account is linked elsewhere").
```

```sql
-- Attach. UNIQUE(telegram_user_id) enforces one-owner at the DB level too.
UPDATE users
   SET telegram_user_id = $1,
       display_name = COALESCE(display_name, $3),
       updated_at = now()
 WHERE id = $2
   AND (telegram_user_id IS NULL OR telegram_user_id = $1)  -- don't overwrite a different link
RETURNING id, email, telegram_user_id;
```

If the `UPDATE` affects 0 rows, the row already had a *different* telegram id —
surface an "unlink first" message.

---

## D. Telegram user ADDS email + password

User is logged in via Telegram (`uid`). They set an email + password in
Settings. Hash with PBKDF2, then:

```sql
-- Guard: is this email already used by a DIFFERENT user?
SELECT id FROM users WHERE email = $1 AND id <> $2;   -- $1 email, $2 uid
--  -> if a row comes back: this is the true-merge case (section E).
```

```sql
-- Attach email+password to the current telegram-only row.
UPDATE users
   SET email = $1, password_hash = $2, password_salt = $3, updated_at = now()
 WHERE id = $4
   AND email IS NULL                 -- only if they had no email yet
RETURNING id, email, telegram_user_id;
```

`email` is `UNIQUE`, so if some other row already has it, the `UPDATE` raises a
unique violation → catch it and route to the merge decision (E).

---

## E. The true-merge case (two pre-existing rows for one person)

Scenario: a person made a **password account** (row P: email set, telegram NULL)
*and separately* a **Telegram account** (row T: telegram set, email NULL), then
tries to link them. Two real rows now exist. Do **not** auto-merge on an
unverified match. Require the user to be **currently authenticated as one row**
AND to **prove ownership of the other** (complete the other login inline). Only
then merge, moving child records from the losing row to the surviving row.

Pick a survivor (keep the older `id` to preserve the leaderboard's `sites.slug`
and existing links). Reassign every owning FK, then delete the loser. All child
tables reference `users(id)`:

```sql
-- $keep = surviving user id, $drop = losing user id. Run in ONE transaction.
BEGIN;

-- sites is UNIQUE(user_id) 1:1 — only move if the survivor has no site yet,
-- otherwise the streamer must choose which leaderboard to keep (app decides).
UPDATE sites            SET user_id  = $keep WHERE user_id  = $drop
  AND NOT EXISTS (SELECT 1 FROM sites WHERE user_id = $keep);

UPDATE bots             SET owner_id = $keep WHERE owner_id = $drop;
UPDATE offers           SET owner_id = $keep WHERE owner_id = $drop;
UPDATE conversions      SET owner_id = $keep WHERE owner_id = $drop;
UPDATE stream_channels  SET owner_id = $keep WHERE owner_id = $drop;
UPDATE subscriptions    SET user_id  = $keep WHERE user_id  = $drop;
UPDATE payments         SET user_id  = $keep WHERE user_id  = $drop;
UPDATE partners          SET created_by = $keep WHERE created_by = $drop;

-- Fold the loser's credentials/plan onto the survivor where the survivor lacks
-- them (survivor is password row, loser is telegram row -> pull telegram id).
UPDATE users k
   SET telegram_user_id = COALESCE(k.telegram_user_id, d.telegram_user_id),
       email            = COALESCE(k.email,            d.email),
       password_hash    = COALESCE(k.password_hash,    d.password_hash),
       password_salt    = COALESCE(k.password_salt,    d.password_salt),
       postback_key     = COALESCE(k.postback_key,     d.postback_key),
       display_name     = COALESCE(k.display_name,     d.display_name),
       plan             = CASE WHEN d.plan = 'agency' OR
                                    (d.plan = 'pro' AND k.plan = 'free')
                               THEN d.plan ELSE k.plan END   -- keep the better plan
  FROM users d
 WHERE k.id = $keep AND d.id = $drop;

-- Null out the loser's unique cols first so deleting can't leave dangling
-- uniques, then remove it.
UPDATE users SET email = NULL, telegram_user_id = NULL, postback_key = NULL
 WHERE id = $drop;
DELETE FROM users WHERE id = $drop;

COMMIT;
```

After merge, invalidate the loser's sessions (best-effort — KV tokens for the
dropped uid simply resolve to a deleted user on next read and are treated as
logged-out) and issue a fresh `gm_session` bound to `$keep`.

> **Design stance:** merges are rare and destructive. Gate them behind an
> explicit "Link accounts" action where the user completes *both* logins in one
> sitting. Never merge from a webhook or a coincidental email match.

---

## Quick reference — which column identifies the session's user

`gm_session` → KV → **`users.id` (UUID)**. Neither `email` nor
`telegram_user_id` is ever the session key; they are only *lookup* keys used at
login/link time to find (or create) the one `users.id` the session points at.
