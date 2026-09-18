# Provider portability: audit and migration plan

Status: **expand phase shipped** (this document's "Now" section). Everything else
is a plan, not a commitment to build features. Kick stays the first and only
live provider; Twitch is the expected second one.

Goal: adding a provider should mean writing a provider adapter plus mapping
rows — not redesigning viewer identity, community identity, event storage,
rewards, or auth.

## 1. Current coupling map (as of `main`, September 2026)

Production data volume at audit time: 4 viewers (all Kick, 0 Discord), 2 creator
users with Kick linked, 2 sites with a Kick channel, 0 `kick_reward_events`,
2 `credit_reward_mappings`. Backfill cost is negligible; the risk is code paths,
not data volume.

### Schema

| Concept | Where it lives today | Provider-specific? |
|---|---|---|
| Viewer identity | `viewers.kick_user_id` (UNIQUE), `kick_username`, `kick_avatar_url`, `kick_*_token_enc`, `kick_token_expires_at`, `kick_linked_at`; same set for `discord_*`; `telegram_user_id` | Yes — one column set per provider, credentials on the identity row |
| Viewer neutral fields | `viewers.id`, `avatar_url`, `is_system`, `created_at`, `updated_at`; `viewer_username_history` | Neutral (already a fit for `viewer_accounts`) |
| Creator identity | `users.kick_user_id` (partial UNIQUE), `kick_username`, `kick_*_token_enc`, `kick_token_expires_at`, `kick_linked_at`; `users.telegram_*` | Yes |
| Community ↔ channel | `sites.kick_channel_external_id` (partial UNIQUE), `kick_channel_name`, `kick_channel_linked_at`, `kick_channel_verified_at` | Yes — exactly one channel, one provider per site |
| Viewer auth config | `sites.viewer_kick_auth_enabled`, `sites.viewer_discord_auth_enabled` | Yes — one boolean per provider |
| Provider events | `kick_reward_events(event_id PK, event_type, site_id, reward_id, redeemer_kick_user_id, reward_cost, status, payload, processed_at)` | Yes — table *is* the idempotency contract |
| Ledger → event | `credit_ledger.kick_event_id` FK → `kick_reward_events`; `metadata->>'kick_redemption_id'` (indexed) | Yes |
| Reward mappings | `credit_reward_mappings(site_id, kick_reward_id UNIQUE, kick_reward_title, kick_reward_cost, credits)` | Yes — column names, but the shape is generic (external reward → credits) |
| Rewards catalog | `shop_items`, `redemptions` | Neutral. No fulfillment type column; fulfillment is a fixed statement in `reward-detail.ts` |
| Membership / loyalty | `site_viewers`, `credit_ledger`, `viewer_streaks`, `viewer_season_progress`, `viewer_daily_quests` | Neutral (keyed by `viewer_id` / `site_viewer_id`) |
| Ownership | `sites.user_id` owner + `site_members(site_id, user_id, role)` | Already multi-user per site; no organization entity |
| Billing events | `provider_events(provider, provider_reference, event_kind, …)` | **Name collision**: this is the payment-provider ledger (Polar), not creator-platform events |

### Code

Writers of provider columns (every one must keep working unchanged):

- `apps/leaderboard/src/handlers/viewer-auth.js` — `completeKickViewerAuth`,
  Discord callback: `SELECT … FROM viewers WHERE kick_user_id`, `UPDATE viewers SET kick_*`, `INSERT INTO viewers (kick_* | discord_*)`.
- `packages/shared/src/kick-credits.ts` — `processKickRewardRedemption`
  (viewer upsert by `kick_user_id`, `INSERT INTO kick_reward_events`, ledger rows with `kick_event_id`), `upsertCreditRewardMapping`, `setSiteKickChannel`.
- `apps/leaderboard/src/handlers/kick-auth.js` — `handleKickAuthCallback`
  (`UPDATE users SET kick_*`, `UPDATE sites SET kick_channel_*`), unlink (`SET kick_* = null`).
- `apps/leaderboard/src/handlers/credits.js` — reward mapping + channel management (147 `kick` references).

Readers that hard-code a provider where the concept is generic:

- Display name: `viewer.kick_username || viewer.discord_username` in
  `packages/shared/src/site-render.ts`, `apps/leaderboard/src/handlers/people.js`,
  `apps/leaderboard/src/handlers/viewer-dashboard.js`, `apps/leaderboard/src/handlers/feedback.js`
  (persists `kick_username` into `viewer_feedback`), `apps/leaderboard/src/handlers/duels.js`
  (looks viewers up by `lower(kick_username)` — legacy games scope, not touched).
- Provider labels: inline `provider === "kick" ? "Kick" : …` ternaries in
  `apps/leaderboard/src/assets/viewer-dashboard.js`, `people.js`.
- `ViewerRecord` type in `packages/shared/src/viewer-session.ts` exposes `kick_*` / `discord_*`.
- Connection status: `apps/leaderboard/src/handlers/account.js` builds the Kick card from `users.kick_*` + `sites.kick_channel_*`.
- Exports: `apps/consumer/src/viewer-export.js` serialises provider columns and `kick_reward_events`.
- Viewer OAuth readiness: `apps/leaderboard/src/viewer-oauth.js` — `VIEWER_OAUTH_PROVIDERS = ["kick","discord"]`, one `resolveX(env)` per provider, env switches `VIEWER_KICK_OAUTH_ENABLED` / `VIEWER_DISCORD_OAUTH_ENABLED`.
- Webhook: `apps/leaderboard/src/handlers/kick-webhook.js` — Kick headers, signature, `type: "kick-redemption"` queue message; `apps/consumer/src/worker.js` `case "kick-redemption"`.

Genuinely provider-specific (keep as is): "Log in with Kick" / "Sign in with Kick"
buttons (one per provider, `site-render.ts` `viewerAuthButtons`, `pages/viewer-dashboard.js`),
Kick OAuth/PKCE in `kick-oauth.ts`, Discord OAuth in `discord-oauth.ts`,
"Watch on Kick" footer link (derived from the creator's socials, already handles Twitch/YouTube hosts).

## 2. Highest-risk technical debt (ranked)

1. **`viewers.kick_user_id` UNIQUE as the identity key.** Every event, OAuth callback and export resolves a viewer through a provider column. A second provider means a second nullable column set or a rewrite of every resolver. Two Kick/Discord callback functions already duplicate ~60 lines each.
2. **`kick_reward_events` is the idempotency ledger and `credit_ledger.kick_event_id` the audit link.** A Twitch event has nowhere to land; loyalty code would have to learn a second table.
3. **One channel per site** (`sites.kick_channel_*`, partial unique index). The verified-ownership rule (`kick_channel_verified_at`, corroborated by `users.kick_user_id`) is good and must survive the move.
4. **Credentials on identity rows** (`viewers.kick_access_token_enc`, `users.kick_access_token_enc`). Any `SELECT *` on `viewers` pulls tokens; `ViewerRecord` is only safe because it lists columns explicitly.
5. **Per-provider booleans** for auth (`viewer_kick_auth_enabled`) and per-provider env switches. Adding a provider means a column + a flag + a resolver + a UI branch.
6. **`credit_reward_mappings` column names** hard-wire the "external reward" concept to Kick even though the table is generic.
7. **Provider label / display-name logic** is duplicated inline in ≥5 files.
8. **`provider_events` name is taken** by billing. The new creator-platform event table needs a different name to avoid semantic collision.

Not debt (already generic): `site_viewers`, `credit_ledger` core, `shop_items`/`redemptions`, `site_members` roles (`team.ts`), `viewer_sessions`, `oauth_states.provider`.

## 3. Recommended domain boundaries

```
identity/        viewers (account) ── viewer_identities (provider link + credentials)
                 users   (creator) ── creator_connections
community/       sites ── community_channels (N providers per site) ── site_members
integrations/    providers/<id>.ts adapters  → integration_events (raw + normalized envelope)
loyalty/         site_viewers, credit_ledger, streaks, seasons  (keyed only by viewer/site ids)
rewards/         shop_items, redemptions, credit_reward_mappings (external reward → credits)
```

Rules:

- Loyalty and rewards code takes `viewerId` / `siteId` / `integration_event_id`, never a provider column.
- Only `providers/*` adapters and the identity/community modules may reference a provider's external ids.
- Adapters expose *optional* capabilities; callers check `hasCapability(adapter, "rewards")` instead of `if (provider === "kick")`.
- Organizations: keep `sites.user_id` + `site_members`. A future `organizations` table would sit above `sites`; nothing added now assumes `1 user = 1 site` (the new tables key on `user_id`/`site_id`, not on each other).

## 4. Schema migration plan (expand → backfill → switch → verify → contract)

### Expand + backfill (shipped: `supabase/migrations/20260919000000_provider_portability_expand.sql`)

New tables, all additive, RLS-enabled with the standard `yourrank_app` / `service_role` policies:

- `viewer_identities(id, viewer_id → viewers, provider, external_user_id, username, avatar_url, access_token_enc, refresh_token_enc, token_expires_at, scopes, status, linked_at, metadata, created_at, updated_at)`
  UNIQUE `(provider, external_user_id)`, UNIQUE `(viewer_id, provider)`.
  Decision: credentials live on the identity row (one OAuth grant per provider link today), so there is no separate `oauth_connections` table. Splitting it later is a mechanical move; the `*_enc` column convention is unchanged.
- `creator_connections(id, user_id → users, provider, external_user_id, username, access_token_enc, refresh_token_enc, token_expires_at, scopes, status, linked_at, metadata, …)`
  UNIQUE `(provider, external_user_id)`, UNIQUE `(user_id, provider)`.
- `community_channels(id, site_id → sites, provider, external_channel_id, external_channel_name, linked_at, verified_at, metadata, …)`
  UNIQUE `(provider, external_channel_id)`, UNIQUE `(site_id, provider)`.
  `verified_at` keeps the ownership-proof semantics of `sites.kick_channel_verified_at`.
- `integration_events(id, provider, external_event_id, event_type, site_id, external_actor_id, viewer_id, status, payload, occurred_at, received_at, processed_at)`
  UNIQUE `(provider, external_event_id)`. `event_type` is the normalized type (`reward_redemption` today); the raw provider type is `payload_type`.
- `credit_ledger.integration_event_id bigint` (nullable FK → `integration_events`).
- `credit_reward_mappings.provider text DEFAULT 'kick'` (nullable during expand).

Backfill runs in the same migration (`INSERT … SELECT … ON CONFLICT DO NOTHING`) from `viewers.kick_*`/`discord_*`, `users.kick_*`, `sites.kick_channel_*`. `kick_reward_events` had 0 rows in production; the backfill statement is included anyway for staging/local copies.

**Dual-write is done in the database, not in application code.** Triggers on `viewers`, `users`, and `sites` mirror every legacy-column write into the new tables (upsert when the external id is present, mark `revoked` / `verified_at = NULL` when it is cleared — e.g. Kick unlink — so history stays auditable). This means every existing writer (`viewer-auth.js`, `kick-credits.ts`, `kick-auth.js`, `credits.js`) is covered without touching it, the new tables cannot drift while both exist, and rollback is "drop the triggers".

`processKickRewardRedemption` additionally writes the normalized `integration_events` row and stamps `credit_ledger.integration_event_id` in the same transaction as the legacy `kick_reward_events` insert (both are needed until reads switch).

### Switch reads/writes (next PRs, one seam per PR)

1. Viewer OAuth callbacks: resolve/create the viewer via `viewer_identities` (`WHERE provider=$1 AND external_user_id=$2`) — the trigger keeps `viewers.kick_*` populated on the way back, so reads elsewhere stay valid. Kick and Discord callbacks collapse into one `completeViewerOAuth(adapter, …)`.
2. `processKickRewardRedemption` → `processRewardRedemption(normalizedEvent)`: site lookup via `community_channels`, viewer via `viewer_identities`, idempotency via `integration_events`, mapping via `credit_reward_mappings WHERE provider=… AND external_reward_id=…`.
3. Creator connect/unlink → `creator_connections` + `community_channels`; `account.js` connection card reads from them.
4. `ViewerRecord` gains `identities: ViewerIdentity[]`; display-name/labels use `viewer-identity.ts` helpers (shipped now).
5. `viewer-oauth.js` readiness becomes registry-driven (loop over `PROVIDER_IDS`); `sites.viewer_*_auth_enabled` folds into a `viewer_auth_providers text[]` column (expand + backfill first).
6. Exports (`viewer-export.js`) read identities/events from the new tables.

### Verify

Row-count and content parity between legacy columns and new tables (query in §8), all Kick journeys green in staging, `integration_events` count == `kick_reward_events` count for new events.

### Contract (much later, separate release, `-- yourrank:migration-phase: contract`)

Drop triggers, then `viewers.kick_*`/`discord_*` token+identity columns, `users.kick_*`, `sites.kick_channel_*`, `kick_reward_events`, `credit_ledger.kick_event_id`; rename `credit_reward_mappings.kick_reward_*` → `external_reward_*`. Only after every reader in §1 has switched and one full release has run on the new tables.

## 5. Exact files / tables / functions affected

Shipped now:

- `supabase/migrations/20260919000000_provider_portability_expand.sql` (new)
- `packages/shared/src/providers/types.ts`, `registry.ts`, `kick.ts` (new adapter boundary; Kick adapter delegates to existing `kick-oauth.ts` / `kick-credits.ts`)
- `packages/shared/src/viewer-identity.ts` (new: `linkedViewerIdentities`, `viewerDisplayName` — read legacy columns today, the only place to change when reads move to `viewer_identities`)
- `packages/shared/src/kick-credits.ts` — `processKickRewardRedemption` dual-writes `integration_events` and `credit_ledger.integration_event_id`
- `apps/leaderboard/src/handlers/people.js` — `displayName` / `linkedIdentities` delegate to the shared helpers (same output). The remaining inline `kick_username || discord_username` ternaries (`site-render.ts`, `pages/viewer-dashboard.js`, `handlers/viewer-dashboard.js`, `assets/credits.js`) are switch-phase work listed in §1.
- Tests: `apps/leaderboard/src/__tests__/provider-portability-postgres.test.js` (runs with `AUDIT_TEST_DATABASE_URL`, like `provider-binding-postgres.test.js`), `packages/shared/src/__tests__/providers.test.ts`, `credits-lifecycle.test.js` (ledger now carries `integration_event_id`)

Switch phase (not shipped): `viewer-auth.js`, `kick-auth.js`, `credits.js`, `account.js`, `viewer-oauth.js`, `viewer-session.ts`, `viewer-export.js`, `kick-webhook.js`, `consumer/worker.js`, `feedback.js`.

## 6. Compatibility strategy

- No column is renamed, dropped, or made NOT NULL. All existing SQL keeps working.
- Legacy columns remain the read source for every current route; new tables are populated but not yet read by product code.
- Triggers make the new tables a faithful projection of the legacy columns, so a partially deployed Worker fleet (N-1) writing only legacy columns still produces correct new-table rows.
- `integration_events` insert uses `ON CONFLICT DO NOTHING`; a failure there would abort the whole redemption transaction, so it runs after the legacy idempotency check and cannot double-credit.
- Rollback: drop the three trigger functions; leave tables in place (additive records are harmless).
- Public URLs, `/api/*` shapes, cookies, session semantics: unchanged.

## 7. What changes now vs. what is postponed

Now (this PR): the expand migration, DB-level dual-write, normalized event dual-write, adapter types + registry + Kick adapter wrapper, shared label/handle helpers, verification tests, this document.

Explicitly postponed:

- Twitch/YouTube/Discord-automation/Patreon/Shopify adapters (only `kick` is registered; `discord` has an *identity-only* capability entry so the existing viewer login is representable, no new behavior).
- Switching any read path to the new tables (§4 switch list).
- `viewer_auth_providers` column, generic `viewer-oauth.js`, unified OAuth callback.
- `shop_items.fulfillment_type` — rewards are manual today; the enum is a one-line expand later and nothing now assumes "manual forever" except the fixed copy in `reward-detail.ts`.
- Entitlements (`subscriber`, `vip`, Patreon tier), XP/badges/streak generalization, quests, CRM, sponsor campaigns, commerce, organizations/teams above `site_members`.
- Contract migrations.

## 8. Migration risks

| Risk | Mitigation |
|---|---|
| Trigger bug corrupts new tables | Triggers only write to the new tables; legacy columns are never touched by them. Parity test below. |
| Trigger cost on hot writes (`viewers` update per redemption) | One upsert per write; tables are tiny. `set_updated_at_credits_viewers` already fires on `viewers`. |
| `integration_events` insert fails inside redemption transaction | Would roll back the credit (no double credit, no partial state); covered by Postgres test. |
| Unique `(provider, external_user_id)` conflicts during backfill | Legacy columns are already UNIQUE per provider, so backfill cannot conflict. |
| Discord and Kick linked on the same viewer | Two identity rows for one `viewer_id` — intended. |
| Name confusion with billing `provider_events` | New table is `integration_events`; documented here and in table comment. |
| Migration policy gate | Migration is marked `-- yourrank:migration-phase: expand`, contains no DROP/RENAME/NOT NULL, and is newer than the recorded baseline. |

## 9. Tests required before rollout

Shipped (run with `AUDIT_TEST_DATABASE_URL` pointing at a disposable local DB with all migrations applied):

- Backfill parity: every `viewers.kick_user_id` / `discord_user_id`, `users.kick_user_id`, `sites.kick_channel_external_id` has exactly one matching new-table row with the same username/verified time.
- Trigger dual-write: inserting/updating/clearing legacy columns creates/updates/deletes the mirrored row; credentials are copied encrypted-as-is.
- Uniqueness: a second viewer with the same `(provider, external_user_id)` is rejected.
- Redemption: `processKickRewardRedemption` writes `kick_reward_events` **and** `integration_events`, stamps `credit_ledger.integration_event_id`, and stays idempotent on replay.
- Registry: `getProvider("kick")` exposes `viewerAuth`, `creatorAuth`, `webhooks`, `rewards`; `hasCapability(kick, "roles")` is false; unknown providers return `undefined`.

Existing suites that must stay green: `kick-oauth-state.test.js`, `provider-binding-postgres.test.js`, `credits-lifecycle.test.js`, `credits-loop.test.js`, `viewer-oauth-readiness.test.js`, `viewer-account-client.test.js`, `site-routes.test.js`, full `bun run test`.

Before the *switch* phase additionally: staging Kick viewer login + hard refresh, creator Kick connect/unlink, a real webhook redemption end to end, `SELECT count(*) FROM kick_reward_events` == `SELECT count(*) FROM integration_events WHERE provider='kick'`.

Parity query (verify step):

```sql
SELECT 'viewers' AS t, count(*) FILTER (WHERE vi.id IS NULL) AS missing
  FROM viewers v LEFT JOIN viewer_identities vi
    ON vi.viewer_id = v.id AND vi.provider = 'kick' AND vi.external_user_id = v.kick_user_id
 WHERE v.kick_user_id IS NOT NULL
UNION ALL
SELECT 'users', count(*) FILTER (WHERE cc.id IS NULL)
  FROM users u LEFT JOIN creator_connections cc
    ON cc.user_id = u.id AND cc.provider = 'kick' AND cc.external_user_id = u.kick_user_id
 WHERE u.kick_user_id IS NOT NULL
UNION ALL
SELECT 'sites', count(*) FILTER (WHERE ch.id IS NULL)
  FROM sites s LEFT JOIN community_channels ch
    ON ch.site_id = s.id AND ch.provider = 'kick' AND ch.external_channel_id = s.kick_channel_external_id
 WHERE s.kick_channel_external_id IS NOT NULL;
```
