# Provider portability: architecture and migration record

Status: **Phases 1, 2 and 2.5 shipped; architecture accepted as the base for the
next provider.** Kick is the only live creator provider; Discord is a viewer
sign-in provider only. Twitch is the expected second creator provider and is
not wired anywhere yet. The contract (column-drop) phase is deliberately unshipped.

Goal: adding a provider means writing a provider module plus mapping rows — not
redesigning viewer identity, community identity, event storage, rewards, or auth.

Sections §A–§E describe **current HEAD**, verified against the code at the time
of writing. §1–§9 are the original audit and phase-by-phase record; they are kept
for history and are marked as such — where a statement there conflicts with §A–§E,
§A–§E wins.

## A. Current architecture (what production code uses now)

### Identity: Viewer Account and its provider identities

- `viewers` is the Viewer Account; `viewer_identities (viewer_id, provider, external_user_id, …)`
  is the **source of truth** for which external identities a viewer owns. One viewer may own
  one active identity per provider; one external identity may have exactly one *active* owner
  (`provider_active_ownership` trigger, SQLSTATE `23505`; revoked rows are kept for audit).
- `packages/shared/src/viewer-identity.ts` is the only writer:
  `linkExternalViewerIdentity(run, identity, { mode: "signin" } | { mode: "link", viewerId })`.
  Sign-in resolves the active owner or creates a viewer; link attaches to the initiating viewer,
  never creates one, and returns `identity_owned_by_other_viewer` /
  `provider_already_connected` / `viewer_not_found` without writing. No merge ever happens on
  username, email, display name, avatar or provider metadata.
- Every identity write (`viewers`, `viewer_identities`, the legacy `viewers.kick_*`/`discord_*`
  mirror, `viewer_username_history`) runs in one `withTransaction()` that first takes
  `pg_advisory_xact_lock(hashtext('viewer_identities:<provider>:<external_id>'))` and reads the
  owning row `FOR UPDATE`. Concurrent first logins therefore yield exactly one Viewer Account.
- Readers use `viewerIdentitiesSql()` / `linkedViewerIdentities()` / `viewerDisplayName()`:
  viewer session (`ViewerRecord.identities`), `/api/viewer/me` (`connectedAccounts[]` via
  `describeConnectedAccounts()`), people/member views, review linked accounts, viewer export.
- Viewer OAuth (`apps/leaderboard/src/handlers/viewer-auth.js`): Kick and Discord start/callback
  handlers; `?intent=link` stores `intent`, `linkViewerId` and the session authority
  (`global` or `site:<id>`) in the single-use `oauth_states` row and the callback re-validates
  nonce, callback URI, origin, freshness, authority and that the *current* session resolves to
  the same viewer. Link callbacks never mint a session.

### Creator connections and community channels

- `creator_connections (user_id, provider, external_user_id, …)` is the source of truth for a
  creator's provider login; `packages/shared/src/provider-connections.ts` writes it
  (connect / reconnect / disconnect) and `account.js` reads it (`loadCreatorConnection`).
- `community_channels (site_id, provider, external_channel_id, creator_connection_id, verified_at,
  status)` is the source of truth for which provider resource a community owns.
  `creator_connection_id` records **which** creator connection verified the binding.
  `linkCommunityChannel({ verified: true })` refuses to run without it and checks the connection
  is active, same provider, and belongs to the site owner.
- Generic routing (`resolveVerifiedCommunityChannel`) checks only: provider match,
  `ch.status='active'`, `ch.verified_at IS NOT NULL`, `cc.id = ch.creator_connection_id`,
  `cc.status='active'`, `cc.linked_at IS NOT NULL`, `cc.user_id = s.user_id`. It never compares
  `external_user_id` with `external_channel_id`; the creator identity and the channel id are
  independent values (`user-123` may own `channel-999`).
- Revoking a creator connection or re-linking it as a different external identity clears
  `verified_at` and `creator_connection_id` on dependent channels
  (`creator_connection_invalidates_channels` trigger), so a stale ownership proof never routes;
  rebinding re-verifies through provider code.
- Reward redemption (`processKickRewardRedemption`) resolves the community through
  `resolveVerifiedCommunityChannel`, resolves/creates the redeeming viewer through
  `findViewerByExternalIdentity` / `persistViewerIdentity`, and dual-writes
  `integration_events` + `credit_ledger.integration_event_id` next to the legacy
  `kick_reward_events` row.

### Provider registry

`packages/shared/src/providers/registry.ts` lists provider modules with optional capabilities
(`viewerAuth`, `creatorAuth`, `webhooks`, `rewards`). `kick` has all four; `discord` is
`viewerAuth` only. `apps/leaderboard/src/viewer-oauth.js` derives `VIEWER_OAUTH_PROVIDERS` from
`listProviders("viewerAuth")`.

### Access model

The four generic tables have `GRANT ALL` to `yourrank_app` and `service_role`. Row-level security
is **not** enabled on them (same as the other post-baseline expand tables); tenant scoping is
enforced in application SQL, as for the rest of the schema.

### CI enforcement

The `Migration Dry-Run` job in `.github/workflows/pr-check.yml` applies every migration to a fresh
Postgres 16 service container and then runs `bun run verify:portability-postgres`
(`scripts/verify-portability-postgres.mjs`). That wrapper requires `AUDIT_TEST_DATABASE_URL`,
refuses non-local/non-test databases, runs each suite in its own process and fails the job when a
suite has any failure, any skip, or zero executed tests. Mandatory suites
(`apps/leaderboard/src/__tests__/`):

| Suite | Guarantees |
|---|---|
| `viewer-link-postgres` | Kick sign-in → Connect Discord → same viewer, no Viewer B; identity owned by Viewer B rejected with both accounts intact; second identity for one provider rejected; sign-in vs link mode; stale/forged/wrong-session/wrong-viewer states write nothing; custom-domain link via handoff |
| `provider-neutral-postgres` | rollback of viewer/identity/mirror/username-history on failure and on a DB error; 8 concurrent first logins → 1 viewer; racing links → 1 owner; `user-123`/`channel-999` verified binding routes; unverified, foreign-connection, hijack (`23505`), revoked connection, re-linked identity and revoked channel do not route; unlink → rebind by another creator routes |
| `provider-rebind-postgres` | A owns channel → unlink → B legitimately binds; late events for A are skipped |
| `provider-portability-postgres` | legacy `sites.kick_channel_*` mirror stays consistent with the generic binding |
| `provider-binding-postgres` | Kick creator callback → generic binding; unverified binding never routes |
| `viewer-authority-postgres` | viewer session authority (global vs custom domain) for Kick and Discord flows |

The same files self-skip in the database-free `Test` job; that skip is not verification and the
Dry-Run job is the required gate.

## B. Legacy compatibility (retained on purpose, temporary)

All of these are still written and still readable; none is the source of truth for routing or
identity ownership.

- `viewers.kick_*` / `discord_*` identity + token columns — mirrored from `persistViewerIdentity`
  and by the `mirror_viewer_identities` trigger (legacy → generic, idempotent) so an N-1 Worker
  writing only legacy columns still produces correct generic rows.
- `users.kick_*` creator columns — mirrored by `provider-connections.ts` and
  `mirror_creator_connections`. Kick creator **token refresh** in `credits.js` still reads and
  writes `users.kick_*_token_enc` directly.
- `sites.kick_channel_external_id / _name / _linked_at / _verified_at` — mirrored by
  `linkCommunityChannel` and by `mirror_community_channels`, `mirror_community_channels_status`,
  `mirror_community_channels_zz_ownership` (the last derives `creator_connection_id` with the Kick
  rule for legacy writers).
- `sites.viewer_kick_auth_enabled` / `viewer_discord_auth_enabled` per-site opt-in booleans.
- `kick_reward_events` — still the idempotency ledger for redemptions; `integration_events` is
  dual-written and linked from `credit_ledger.integration_event_id`.
- `credit_ledger.kick_event_id`, `credit_reward_mappings.kick_reward_*` (read through
  `reward-mappings.ts` as `externalReward*`; writes still target the `kick_reward_*` names).
- Remaining inline `kick_username || discord_username` fallbacks: `assets/credits.js` (dashboard
  member/redemption rows), `feedback.js` (persists `kick_username` into `viewer_feedback`),
  `duels.js` (legacy games scope, out of bounds).

## C. Provider-specific code (correctly provider-specific)

- Kick OAuth/PKCE (`kick-oauth.ts`), Discord OAuth (`discord-oauth.ts`), and the per-provider
  viewer start/callback/handoff handlers in `viewer-auth.js`.
- Kick ownership rule "broadcaster user id = channel id":
  `packages/shared/src/providers/kick-ownership.ts` (`kickCreatorOwnsChannel`), applied only by
  `bindSiteKickChannel`, the Kick creator callback (`kick-auth.js`) and the legacy mirror trigger —
  always *before* `linkCommunityChannel`, never inside generic routing.
- Kick webhook signature verification and the `kick-redemption` queue message
  (`kick-webhook.js`, `consumer/worker.js`).
- Kick anti-fraud signals (look-alike `viewers.kick_username`, alt history) in `kick-credits.ts`.
- "Log in with Kick" / "Sign in with Discord" buttons and provider labels.

## D. Deferred contract cleanup (intentionally not done)

A separate `-- yourrank:migration-phase: contract` release, only after one full release has run
on the generic tables with parity confirmed (§9 query): drop the mirror triggers, then
`viewers.kick_*`/`discord_*`, `users.kick_*`, `sites.kick_channel_*`, `kick_reward_events`,
`credit_ledger.kick_event_id`; rename `credit_reward_mappings.kick_reward_*` →
`external_reward_*`; fold `sites.viewer_*_auth_enabled` into `viewer_auth_providers text[]`;
switch redemption idempotency to `integration_events`. Also deferred: a generic
`/api/viewer/auth/:provider` router (the shared link/sign-in logic is factored, the routes are
still per provider), `shop_items.fulfillment_type`, entitlements, organizations above
`site_members`, and any Twitch/YouTube/Patreon/Shopify module.

## E. Exact work required to begin Twitch

1. `packages/shared/src/providers/twitch.ts` registered in `registry.ts` with `viewerAuth`,
   `creatorAuth` and (if channel-point redemptions are in scope) `webhooks` + `rewards`
   capabilities; Twitch OAuth + EventSub signature verification live only in that module.
2. A Twitch ownership check (broadcaster lookup, optionally editor role) that calls
   `linkCommunityChannel({ provider: "twitch", creatorConnectionId, verified: true })`.
   No schema change: `creator_connections`, `community_channels.creator_connection_id` and
   `resolveVerifiedCommunityChannel` already accept any provider.
3. Viewer sign-in / Connect Twitch: either the generic `/api/viewer/auth/:provider` router or a
   third handler pair in `viewer-auth.js` reusing `linkExternalViewerIdentity` and the same
   link-state validation.
4. Per-site opt-in: `viewer_auth_providers` fold, or a `sites.viewer_twitch_auth_enabled` column
   plus a `describeConnectedAccounts` / `maskViewerAuthProviders` entry.
5. Only if Twitch redemptions are in scope: switch reward-mapping writes to
   `provider` + `external_reward_*` and idempotency to `integration_events`.
6. Extend `verify-portability-postgres.mjs` suites with a Twitch fixture
   (creator `twitch-user-…`, channel `twitch-channel-…`) so the generic guarantees are proven for a
   second creator provider before launch.

---

## Historical record (Phases 1–2.5)

> Everything below this line describes the audit and each phase **as it was written**. Statements
> such as "not shipped", "legacy columns remain the read source" or "switch phase" refer to the
> state at that phase, not to HEAD. See §A–§E for current truth.

## 1. Coupling map at audit time (`main`, September 2026, before Phase 1)

Production data volume at audit time: 4 viewers (all Kick, 0 Discord), 2 creator
users with Kick linked, 2 sites with a Kick channel, 0 `kick_reward_events`,
2 `credit_reward_mappings`. Backfill cost is negligible; the risk is code paths,
not data volume.

### Schema (as of the audit)

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

### Code (as of the audit; most items below have since moved — see §A/§B)

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

## 2. Highest-risk technical debt at audit time (ranked; items 1 and 3 resolved, 2/4/5/6/7 partially — see §B/§D)

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

## 4. Schema migration record (expand → backfill → switch → verify → contract)

### Phase 1 — Expand + backfill (shipped: `supabase/migrations/20260919000000_provider_portability_expand.sql`)

New tables, all additive, granted to `yourrank_app` / `service_role` (RLS not enabled; see §A "Access model"):

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

**Phase 1 dual-write was done in the database, not in application code.** Triggers on `viewers`, `users`, and `sites` mirror every legacy-column write into the new tables (upsert when the external id is present, mark `revoked` / `verified_at = NULL` when it is cleared — e.g. Kick unlink — so history stays auditable). In Phase 1 this covered every existing writer without touching it. Since Phase 2 the application writes the generic tables first and mirrors the legacy columns itself; the triggers remain as the N-1 safety net (§B).

`processKickRewardRedemption` additionally writes the normalized `integration_events` row and stamps `credit_ledger.integration_event_id` in the same transaction as the legacy `kick_reward_events` insert (both are needed until reads switch).

### Phase 2 — Switch reads/writes (shipped)

Migration `20260920000000_provider_portability_active_ownership.sql` replaces the unconditional
`UNIQUE (provider, external_*_id)` constraints on `viewer_identities`, `creator_connections` and
`community_channels` with non-unique indexes plus a `BEFORE INSERT OR UPDATE` trigger
(`trg_provider_active_ownership`) that raises SQLSTATE `23505` only when a *different owner* holds
the same external id in `status = 'active'`. Revoked rows are kept for audit (`unlinked_at`), so
"A links X → A unlinks → B links X" works while two active owners remain impossible.
`(owner, provider)` uniqueness is kept for `ON CONFLICT` reactivation.

Application paths now on the generic tables (legacy columns kept mirrored by the same code paths):

1. Viewer OAuth (Kick and Discord keep separate protocol code): lookup via
   `findViewerByExternalIdentity`, persistence via `persistViewerIdentity`, unlink via
   `revokeViewerIdentity` (`packages/shared/src/viewer-identity.ts`).
2. Viewer reads — session `identities`, Viewer Account, people/member views, review linked accounts,
   public display names, viewer export — use `viewerIdentitiesSql` / `linkedViewerIdentities`.
3. Creator connect / reconnect / disconnect / account status → `creator_connections` via
   `packages/shared/src/provider-connections.ts` (`users.kick_*` mirrored).
4. Channel binding and event routing → `community_channels`; `resolveVerifiedCommunityChannel`
   requires an active **and** verified binding whose `creator_connection_id` points at an active
   creator connection of the site owner for the same provider (Phase 2.5, below).
5. `viewer-oauth.js` readiness and `maskViewerAuthProviders` iterate `listProviders("viewerAuth")`;
   `sites.viewer_kick_auth_enabled` / `viewer_discord_auth_enabled` stay as the per-site opt-in
   columns (a `viewer_auth_providers text[]` fold is deferred).
6. Reward mappings are read through `packages/shared/src/reward-mappings.ts`
   (`provider`, `externalRewardId`, `externalRewardTitle`, `externalRewardCost`) aliasing the
   `kick_reward_*` columns; writes still target the legacy column names.

Still legacy after Phase 2 (unchanged at HEAD, tracked in §B/§D): idempotency is `kick_reward_events`
(`integration_events` is dual-written and linked from `credit_ledger.integration_event_id`); mapping
writes and the dashboard mapping editor use `kick_reward_*`; the anti-fraud signals read
`viewers.kick_username`; Kick creator token refresh reads `users.kick_*`.

### Phase 2.5 — remaining portability blockers (shipped; PR #793)

Migration `20260921000000_provider_portability_channel_ownership.sql` (expand-safe: one nullable
column, one index, a backfill, two triggers).

**Cross-platform Viewer Account linking.** `linkExternalViewerIdentity(run, identity, mode)` in
`packages/shared/src/viewer-identity.ts` is the single generic entry point for a provider callback:

- `{ mode: "signin" }` (logged out): resolve the viewer that actively owns
  `(provider, external_user_id)` or create a new Viewer Account. Never merges on username, email,
  display name, avatar or provider metadata.
- `{ mode: "link", viewerId }` (logged in, "Connect <provider>"): attach the identity to that
  viewer. Never creates a viewer. Returns `identity_owned_by_other_viewer` when Viewer B actively
  owns the identity (both accounts untouched), `provider_already_connected` when the viewer already
  has a different active identity for the provider, `viewer_not_found` when the viewer is gone.

OAuth link mode (`apps/leaderboard/src/handlers/viewer-auth.js`, Kick and Discord): the start route
accepts `?intent=link`, requires an authenticated viewer, and stores `intent`, `linkViewerId` and the
session authority (`global` or `site:<id>`) in the single-use `oauth_states` row alongside the
existing callback URI, origin and browser-nonce hash. The callback (or, on custom domains, the Kick
handoff on the site host) re-validates all of those and additionally requires the *current* viewer
session to resolve to the same viewer id under the same authority; any mismatch redirects with a
stable error code (`link_requires_signin`, `link_session_mismatch`, `link_identity_in_use`,
`link_provider_already_connected`) and persists nothing. Link callbacks do not mint a new session.

**Atomicity and concurrency.** All identity persistence runs inside one `withTransaction()`:
`viewers` insert/update, `viewer_identities` upsert, the legacy `viewers.kick_*`/`discord_*` mirror
and `viewer_username_history`. The transaction first takes
`pg_advisory_xact_lock(hashtext('viewer_identities:<provider>:<external_id>'))` and reads the
owning row `FOR UPDATE`, so concurrent first logins serialize on the database and produce exactly
one Viewer Account; the active-ownership trigger (`23505`) remains the last line of defence.

**Connected Accounts API.** `GET /api/viewer/me` returns `connectedAccounts[]`
(`{ provider, label, state: connected|available|unavailable, username, linkedAt, connectUrl }`),
built by `describeConnectedAccounts()` from the generic identities and the per-site provider
readiness; `connectUrl` is `/api/viewer/auth/<provider>?intent=link`. The Viewer Account page renders
it and surfaces `?connected=<provider>` / `?error=link_*` results.

**Provider-neutral channel ownership.** `community_channels.creator_connection_id` records WHICH
creator connection verified a binding. `linkCommunityChannel({ verified: true })` refuses to run
without it and checks that the connection exists, is active, has the same provider and belongs to
the site owner. Generic routing (`resolveVerifiedCommunityChannel`) checks only: provider match,
`ch.status='active'`, `ch.verified_at IS NOT NULL`, `cc.id = ch.creator_connection_id`,
`cc.status='active'`, `cc.linked_at IS NOT NULL`, `cc.user_id = s.user_id`. It never compares
`external_user_id` with `external_channel_id`. The Kick rule "broadcaster user id = channel id"
lives only in `packages/shared/src/providers/kick-ownership.ts` (`kickCreatorOwnsChannel`) and is
applied by Kick-specific code before binding (`bindSiteKickChannel`, the Kick creator callback,
the legacy `sites.kick_channel_*` mirror trigger). A DB trigger
(`creator_connection_invalidates_channels`) clears `verified_at`/`creator_connection_id` when the
referenced connection is revoked or re-linked as a different external identity, so a stale proof
never routes; rebinding re-verifies through provider code.

Compatibility retained: every legacy column and mirror trigger from Phases 1–2; `sites.kick_channel_*`
still written and mirrored (the mirror derives `creator_connection_id` with the Kick rule); the
sign-in-only OAuth flow is byte-for-byte the old flow with persistence moved into the transaction.

Still provider-specific after Phase 2.5 (deliberate, not blockers):

- Kick and Discord keep separate OAuth protocol handlers (`handleKickViewerAuth*`,
  `handleDiscordViewerAuth*`); the shared link/sign-in logic is factored but a generic
  `/api/viewer/auth/:provider` router does not exist yet.
- `sites.viewer_kick_auth_enabled` / `viewer_discord_auth_enabled` per-site opt-in columns.
- Reward idempotency (`kick_reward_events`), `credit_reward_mappings.kick_reward_*` writes, anti-fraud
  reading `viewers.kick_username`, Kick creator token refresh reading `users.kick_*`.
- Legacy Kick mirror columns and their triggers (contract phase).

Exact work before Twitch: see §E.

### Verify (ongoing)

Row-count and content parity between legacy columns and new tables (query in §9), all Kick journeys green in staging, `integration_events` count == `kick_reward_events` count for new events. The database-level guarantees are enforced on every PR by the mandatory suites in §A "CI enforcement".

### Contract (not shipped; see §D)

Drop triggers, then `viewers.kick_*`/`discord_*` token+identity columns, `users.kick_*`, `sites.kick_channel_*`, `kick_reward_events`, `credit_ledger.kick_event_id`; rename `credit_reward_mappings.kick_reward_*` → `external_reward_*`. Only after one full release has run on the new tables.

## 5. Files / tables / functions affected by Phase 1 (historical)

Shipped in Phase 1:

- `supabase/migrations/20260919000000_provider_portability_expand.sql` (new)
- `packages/shared/src/providers/types.ts`, `registry.ts`, `kick.ts` (new adapter boundary; Kick adapter delegates to existing `kick-oauth.ts` / `kick-credits.ts`)
- `packages/shared/src/viewer-identity.ts` (new in Phase 1 with `linkedViewerIdentities`, `viewerDisplayName` reading legacy columns; since Phase 2 it reads/writes `viewer_identities` and owns `linkExternalViewerIdentity`)
- `packages/shared/src/kick-credits.ts` — `processKickRewardRedemption` dual-writes `integration_events` and `credit_ledger.integration_event_id`
- `apps/leaderboard/src/handlers/people.js` — `displayName` / `linkedIdentities` delegate to the shared helpers (same output). Inline `kick_username || discord_username` ternaries were removed from `site-render.ts`, `pages/viewer-dashboard.js` and `handlers/viewer-dashboard.js` in Phase 2; the ones still present are listed in §B.
- Tests: `apps/leaderboard/src/__tests__/provider-portability-postgres.test.js` (runs with `AUDIT_TEST_DATABASE_URL`, like `provider-binding-postgres.test.js`), `packages/shared/src/__tests__/providers.test.ts`, `credits-lifecycle.test.js` (ledger now carries `integration_event_id`)

Switched in Phase 2 / 2.5 (historically listed here as "switch phase, not shipped"): `viewer-auth.js`, `kick-auth.js`, `credits.js` (channel binding), `account.js`, `viewer-oauth.js`, `viewer-session.ts`, `viewer-export.js`. Still on legacy columns: `credits.js` token refresh, `kick-webhook.js` / `consumer/worker.js` (Kick-specific by design), `feedback.js` (§B).

## 6. Compatibility strategy (Phase 1 wording; current state in §B)

- No column is renamed, dropped, or made NOT NULL. All existing SQL keeps working.
- *Phase 1:* legacy columns were the read source for every route and the new tables were populated but not read. *Since Phase 2:* the generic tables are the read/write source for identity, connections and channel routing (§A); legacy columns are mirrors.
- Triggers make the new tables a faithful projection of the legacy columns, so a partially deployed Worker fleet (N-1) writing only legacy columns still produces correct new-table rows.
- `integration_events` insert uses `ON CONFLICT DO NOTHING`; a failure there would abort the whole redemption transaction, so it runs after the legacy idempotency check and cannot double-credit.
- Rollback: drop the three trigger functions; leave tables in place (additive records are harmless).
- Public URLs, `/api/*` shapes, cookies, session semantics: unchanged.

## 7. What each phase changed vs. what was postponed (historical)

Phase 1: the expand migration, DB-level dual-write, normalized event dual-write, adapter types + registry + Kick adapter wrapper, shared label/handle helpers, verification tests, this document.
Phase 2: active-ownership trigger, generic reads/writes for viewer identity, creator connections and channel binding, registry-driven `viewer-oauth.js`.
Phase 2.5: link mode, transactional + advisory-locked identity persistence, `community_channels.creator_connection_id`, generic routing without the Kick equality rule, Connected Accounts API, mandatory CI Postgres gate.

Still postponed at HEAD (see §D):

- Twitch/YouTube/Discord-automation/Patreon/Shopify modules (only `kick` and identity-only `discord` are registered).
- `viewer_auth_providers` column, generic `/api/viewer/auth/:provider` router.
- `shop_items.fulfillment_type` — rewards are manual today; the enum is a one-line expand later and nothing now assumes "manual forever" except the fixed copy in `reward-detail.ts`.
- Entitlements (`subscriber`, `vip`, Patreon tier), XP/badges/streak generalization, quests, CRM, sponsor campaigns, commerce, organizations/teams above `site_members`.
- Contract migrations.

## 8. Migration risks (Phase 1 table; still accurate for the retained triggers)

| Risk | Mitigation |
|---|---|
| Trigger bug corrupts new tables | Triggers only write to the new tables; legacy columns are never touched by them. Parity test below. |
| Trigger cost on hot writes (`viewers` update per redemption) | One upsert per write; tables are tiny. `set_updated_at_credits_viewers` already fires on `viewers`. |
| `integration_events` insert fails inside redemption transaction | Would roll back the credit (no double credit, no partial state); covered by Postgres test. |
| Unique `(provider, external_user_id)` conflicts during backfill | Legacy columns are already UNIQUE per provider, so backfill cannot conflict. |
| Discord and Kick linked on the same viewer | Two identity rows for one `viewer_id` — intended. |
| Name confusion with billing `provider_events` | New table is `integration_events`; documented here and in table comment. |
| Migration policy gate | Migration is marked `-- yourrank:migration-phase: expand`, contains no DROP/RENAME/NOT NULL, and is newer than the recorded baseline. |

## 9. Tests

All suites below run with `AUDIT_TEST_DATABASE_URL` pointing at a disposable local DB with all migrations applied (`bun run verify:portability-postgres` runs the mandatory set; the CI gate is described in §A):

- Backfill parity: every `viewers.kick_user_id` / `discord_user_id`, `users.kick_user_id`, `sites.kick_channel_external_id` has exactly one matching new-table row with the same username/verified time.
- Trigger dual-write: inserting/updating/clearing legacy columns creates/updates/deletes the mirrored row; credentials are copied encrypted-as-is.
- Uniqueness: a second viewer with the same `(provider, external_user_id)` is rejected.
- Redemption: `processKickRewardRedemption` writes `kick_reward_events` **and** `integration_events`, stamps `credit_ledger.integration_event_id`, and stays idempotent on replay.
- Registry: `getProvider("kick")` exposes `viewerAuth`, `creatorAuth`, `webhooks`, `rewards`; `hasCapability(kick, "roles")` is false; unknown providers return `undefined`.
- Phase 2.5, `viewer-link-postgres.test.js` (real OAuth handlers, stubbed provider HTTP): logged-out Discord sign-in; Kick login → Connect Discord → one viewer owns both, no Viewer B; identity owned by Viewer B rejected with both accounts intact; second identity for the same provider rejected; link mode requires sign-in and stays distinct from sign-in; stale, forged, wrong-session and wrong-viewer link states fail without writes; custom-domain (site authority) link via the Kick handoff.
- Phase 2.5, `provider-neutral-postgres.test.js`: rollback of viewers/identities/mirror/username history on a failure before commit and on a DB error in the last write; 8 concurrent first logins → exactly one Viewer Account; two viewers racing to link one identity → one owner, both accounts kept; `user-123` creator connection verifying `channel-999`: unverified never routes, verified without a connection refused, another owner's connection refused, hijack rejected (`23505`), revoked connection / re-linked-as-other-identity / revoked channel stop routing, unlink then rebind by another creator routes.

Existing suites that must stay green: `kick-oauth-state.test.js`, `provider-binding-postgres.test.js`, `credits-lifecycle.test.js`, `credits-loop.test.js`, `viewer-oauth-readiness.test.js`, `viewer-account-client.test.js`, `site-routes.test.js`, full `bun run test`.

Before the *contract* phase additionally: staging Kick viewer login + hard refresh, creator Kick connect/unlink, a real webhook redemption end to end, `SELECT count(*) FROM kick_reward_events` == `SELECT count(*) FROM integration_events WHERE provider='kick'`.

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
