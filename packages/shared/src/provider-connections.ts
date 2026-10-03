// Provider-neutral creator connections and community channel bindings: the
// application contract over `creator_connections`, `site_creator_connections`
// and `community_channels`. A channel is proven either by the owner's
// account-level connection or, when a site was connected with a different
// provider account than the one the owner's other sites use, by that site's
// own authorization; each OAuth grant lives in exactly one row.
// Generic rows are written first (active-ownership trigger enforces one active
// owner per external id); legacy `users.kick_*` / `sites.kick_channel_*`
// columns are mirrored afterwards for the compatibility phase
// (docs/PROVIDER_PORTABILITY_PLAN.md §4). Provider protocol stays in the
// provider modules; only persisted connection state goes through here.
import type { ProviderId } from "./providers/types.js";
import type { SqlRunner } from "./viewer-identity.js";

export interface CreatorConnectionInput {
  userId: string;
  provider: ProviderId;
  externalUserId: string;
  username: string;
  accessTokenEnc: string | null;
  refreshTokenEnc: string | null;
  tokenExpiresAt: string | null;
}

export interface CreatorConnection {
  id: string;
  provider: ProviderId;
  externalUserId: string;
  username: string | null;
  linkedAt: string | Date | null;
  tokenExpiresAt: string | Date | null;
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
}

export interface CommunityChannelInput {
  siteId: string;
  provider: ProviderId;
  externalChannelId: string;
  externalChannelName: string;
  /**
   * Creator connection whose provider-specific verification proved that the
   * creator owns / may act on this channel. How that is proven (Kick: the
   * broadcaster user id is the channel id; Twitch: a broadcaster or editor
   * lookup; YouTube/Discord: a channel/guild membership check) is the
   * provider module's business. Required for a verified binding.
   */
  creatorConnectionId?: string | null;
  /**
   * Site-scoped authorization that verified the channel instead of the
   * owner's account-level connection. A verified binding names exactly one of
   * `creatorConnectionId` / `siteCreatorConnectionId`.
   */
  siteCreatorConnectionId?: string | null;
  verified: boolean;
}

export interface SiteCreatorConnectionInput extends CreatorConnectionInput {
  siteId: string;
  /** Channel the provider-specific verification proved this authorization owns. */
  verifiedChannelId: string;
}

export interface SiteProviderAuthorizationInput extends CreatorConnectionInput {
  siteId: string;
  externalChannelId: string;
  externalChannelName: string;
}

/**
 * The OAuth grant that proves a site's routable channel: the owner's
 * account-level connection (`scope: "account"`) or the site's own
 * authorization (`scope: "site"`).
 */
export interface ChannelAuthorization {
  scope: "account" | "site";
  connectionId: string;
  siteId: string;
  userId: string;
  provider: ProviderId;
  externalUserId: string;
  username: string | null;
  externalChannelId: string;
  externalChannelName: string | null;
  linkedAt: string | Date | null;
  accessTokenEnc: string | null;
  refreshTokenEnc: string | null;
  tokenExpiresAt: string | Date | null;
}

export interface OAuthTokens {
  accessTokenEnc: string;
  refreshTokenEnc: string | null;
  tokenExpiresAt: string | Date | null;
}

export interface CommunityChannel {
  siteId: string;
  provider: ProviderId;
  externalChannelId: string;
  externalChannelName: string | null;
  creatorConnectionId: string | null;
  siteCreatorConnectionId: string | null;
  linkedAt: string | Date | null;
  verifiedAt: string | Date | null;
}

// Providers that still own legacy mirror columns. New providers have no entry.
const LEGACY_CREATOR = new Set<ProviderId>(["kick"]);
const LEGACY_CHANNEL = new Set<ProviderId>(["kick"]);

async function rows<T>(run: SqlRunner, sql: string, params: unknown[]): Promise<T[]> {
  return ((await run(sql, params)) ?? []) as T[];
}

export async function loadCreatorConnection(run: SqlRunner, userId: string, provider: ProviderId): Promise<CreatorConnection | null> {
  const [row] = await rows<{
    id: string; external_user_id: string; username: string | null; linked_at: string | null; token_expires_at: string | null;
    has_access: boolean; has_refresh: boolean;
  }>(run,
    `SELECT id, external_user_id, username, linked_at, token_expires_at,
            access_token_enc IS NOT NULL AS has_access, refresh_token_enc IS NOT NULL AS has_refresh
       FROM creator_connections
      WHERE user_id = $1 AND provider = $2 AND status = 'active'`,
    [userId, provider]);
  if (!row) return null;
  return {
    id: row.id,
    provider,
    externalUserId: row.external_user_id,
    username: row.username ?? null,
    linkedAt: row.linked_at ?? null,
    tokenExpiresAt: row.token_expires_at ?? null,
    hasAccessToken: Boolean(row.has_access),
    hasRefreshToken: Boolean(row.has_refresh),
  };
}

/**
 * Upsert the creator's connection and return its id (the handle a verified
 * channel binding references); raises 23505 if another user actively owns the
 * external id.
 */
export async function linkCreatorConnection(run: SqlRunner, input: CreatorConnectionInput): Promise<string> {
  const [row] = await rows<{ id: string }>(run,
    `INSERT INTO creator_connections AS cc
       (user_id, provider, external_user_id, username, access_token_enc, refresh_token_enc, token_expires_at, linked_at)
     VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6, $7, now())
     ON CONFLICT (user_id, provider) DO UPDATE
        SET external_user_id = EXCLUDED.external_user_id,
            username = EXCLUDED.username,
            access_token_enc = EXCLUDED.access_token_enc,
            refresh_token_enc = EXCLUDED.refresh_token_enc,
            token_expires_at = EXCLUDED.token_expires_at,
            linked_at = now(),
            status = 'active',
            updated_at = now()
     RETURNING id`,
    [input.userId, input.provider, input.externalUserId, input.username, input.accessTokenEnc, input.refreshTokenEnc, input.tokenExpiresAt],
  );
  if (LEGACY_CREATOR.has(input.provider)) {
    await run(
      `UPDATE users
          SET kick_user_id = $1,
              kick_username = $2,
              kick_access_token_enc = $3,
              kick_refresh_token_enc = $4,
              kick_token_expires_at = $5,
              kick_linked_at = now(),
              updated_at = now()
        WHERE id = $6`,
      [input.externalUserId, input.username, input.accessTokenEnc, input.refreshTokenEnc, input.tokenExpiresAt, input.userId],
    );
  }
  return row.id;
}

export async function revokeCreatorConnection(run: SqlRunner, userId: string, provider: ProviderId): Promise<void> {
  await run(
    `UPDATE creator_connections
        SET status = 'revoked', access_token_enc = NULL, refresh_token_enc = NULL, updated_at = now()
      WHERE user_id = $1 AND provider = $2 AND status <> 'revoked'`,
    [userId, provider],
  );
  if (LEGACY_CREATOR.has(provider)) {
    await run(
      `UPDATE users
          SET kick_user_id = null,
              kick_username = null,
              kick_access_token_enc = null,
              kick_refresh_token_enc = null,
              kick_token_expires_at = null,
              kick_linked_at = null,
              updated_at = now()
        WHERE id = $1`,
      [userId],
    );
  }
}

/**
 * The provider proved the saved grant is invalid (401 / invalid_grant): drop
 * the credentials but keep the identity link, so health reads "Reconnect
 * required" instead of pretending the creator disconnected on purpose.
 */
export async function clearCreatorConnectionTokens(run: SqlRunner, userId: string, provider: ProviderId): Promise<void> {
  await run(
    `UPDATE creator_connections
        SET access_token_enc = NULL, refresh_token_enc = NULL, token_expires_at = NULL, updated_at = now()
      WHERE user_id = $1 AND provider = $2`,
    [userId, provider],
  );
  if (LEGACY_CREATOR.has(provider)) {
    await run(
      `UPDATE users
          SET kick_access_token_enc = null,
              kick_refresh_token_enc = null,
              kick_token_expires_at = null,
              updated_at = now()
        WHERE id = $1`,
      [userId],
    );
  }
}

/** Persist refreshed OAuth credentials on the connection and its legacy mirror. */
export async function storeCreatorConnectionTokens(
  run: SqlRunner,
  userId: string,
  provider: ProviderId,
  tokens: OAuthTokens,
): Promise<void> {
  await run(
    `UPDATE creator_connections
        SET access_token_enc = $3, refresh_token_enc = $4, token_expires_at = $5, updated_at = now()
      WHERE user_id = $1 AND provider = $2 AND status = 'active'`,
    [userId, provider, tokens.accessTokenEnc, tokens.refreshTokenEnc, tokens.tokenExpiresAt],
  );
  if (LEGACY_CREATOR.has(provider)) {
    await run(
      `UPDATE users
          SET kick_access_token_enc = $2,
              kick_refresh_token_enc = $3,
              kick_token_expires_at = $4,
              updated_at = now()
        WHERE id = $1`,
      [userId, tokens.accessTokenEnc, tokens.refreshTokenEnc, tokens.tokenExpiresAt],
    );
  }
}

export async function loadCommunityChannel(run: SqlRunner, siteId: string, provider: ProviderId): Promise<CommunityChannel | null> {
  const [row] = await rows<{
    external_channel_id: string; external_channel_name: string | null; creator_connection_id: string | null;
    site_creator_connection_id: string | null; linked_at: string | null; verified_at: string | null;
  }>(run,
    `SELECT external_channel_id, external_channel_name, creator_connection_id, site_creator_connection_id,
            linked_at, verified_at
       FROM community_channels
      WHERE site_id = $1 AND provider = $2 AND status = 'active'`,
    [siteId, provider]);
  if (!row) return null;
  return {
    siteId,
    provider,
    externalChannelId: row.external_channel_id,
    externalChannelName: row.external_channel_name ?? null,
    creatorConnectionId: row.creator_connection_id ?? null,
    siteCreatorConnectionId: row.site_creator_connection_id ?? null,
    linkedAt: row.linked_at ?? null,
    verifiedAt: row.verified_at ?? null,
  };
}

/**
 * Bind a channel to a site; raises 23505 if another site actively owns the
 * channel. A verified binding must name the authorization that verified it:
 * an active account-level connection of the site owner, or an active
 * authorization of this very site (owned by the site owner) that verified
 * this channel. Otherwise a creator could bind a channel to a site they do
 * not own.
 */
export async function linkCommunityChannel(run: SqlRunner, input: CommunityChannelInput): Promise<void> {
  const creatorConnectionId = input.creatorConnectionId ?? null;
  const siteCreatorConnectionId = input.siteCreatorConnectionId ?? null;
  if (creatorConnectionId && siteCreatorConnectionId) {
    throw new Error("A community channel binding is verified by one creator connection, not two");
  }
  if (input.verified && !creatorConnectionId && !siteCreatorConnectionId) {
    throw new Error("A verified community channel binding requires the verifying creator connection");
  }
  if (creatorConnectionId) {
    const [owner] = await rows<{ id: string }>(run,
      `SELECT cc.id
         FROM creator_connections cc
         JOIN sites s ON s.user_id = cc.user_id
        WHERE cc.id = $1 AND s.id = $2 AND cc.provider = $3
          AND cc.status = 'active' AND cc.linked_at IS NOT NULL
        FOR SHARE OF cc`,
      [creatorConnectionId, input.siteId, input.provider]);
    if (!owner) throw new Error("Creator connection does not belong to the site owner for this provider");
  }
  if (siteCreatorConnectionId) {
    const [owner] = await rows<{ id: string }>(run,
      `SELECT sc.id
         FROM site_creator_connections sc
         JOIN sites s ON s.id = sc.site_id AND s.user_id = sc.user_id
        WHERE sc.id = $1 AND sc.site_id = $2 AND sc.provider = $3
          AND sc.status = 'active' AND sc.linked_at IS NOT NULL
          AND sc.verified_channel_id = $4
        FOR SHARE OF sc`,
      [siteCreatorConnectionId, input.siteId, input.provider, input.externalChannelId]);
    if (!owner) throw new Error("Site creator connection does not belong to this site and channel");
  }
  await run(
    `INSERT INTO community_channels AS ch
       (site_id, provider, external_channel_id, external_channel_name, creator_connection_id,
        site_creator_connection_id, linked_at, verified_at)
     VALUES ($1, $2, $3, NULLIF($4, ''), $6, $7, now(), CASE WHEN $5 THEN now() END)
     ON CONFLICT (site_id, provider) DO UPDATE
        SET external_channel_id = EXCLUDED.external_channel_id,
            external_channel_name = EXCLUDED.external_channel_name,
            creator_connection_id = EXCLUDED.creator_connection_id,
            site_creator_connection_id = EXCLUDED.site_creator_connection_id,
            linked_at = now(),
            verified_at = EXCLUDED.verified_at,
            status = 'active',
            updated_at = now()`,
    [input.siteId, input.provider, input.externalChannelId, input.externalChannelName, input.verified,
      creatorConnectionId, siteCreatorConnectionId],
  );
  if (LEGACY_CHANNEL.has(input.provider)) {
    await run(
      `UPDATE sites
          SET kick_channel_external_id = $1,
              kick_channel_name = $2,
              kick_channel_linked_at = now(),
              kick_channel_verified_at = CASE WHEN $3 THEN now() END,
              updated_at = now()
        WHERE id = $4`,
      [input.externalChannelId, input.externalChannelName, input.verified, input.siteId],
    );
  }
}

export async function revokeCommunityChannel(run: SqlRunner, siteId: string, provider: ProviderId): Promise<void> {
  await run(
    `UPDATE community_channels
        SET status = 'revoked', verified_at = NULL, creator_connection_id = NULL,
            site_creator_connection_id = NULL, chat_events_subscribed_at = NULL, reward_events_subscribed_at = NULL,
            event_subscriptions_checked_at = NULL, updated_at = now()
      WHERE site_id = $1 AND provider = $2 AND status <> 'revoked'`,
    [siteId, provider],
  );
  if (LEGACY_CHANNEL.has(provider)) {
    await run(
      `UPDATE sites
          SET kick_channel_external_id = null,
              kick_channel_name = null,
              kick_channel_linked_at = null,
              kick_channel_verified_at = null,
              updated_at = now()
        WHERE id = $1`,
      [siteId],
    );
  }
}

// A binding is routable when: active, verified, and its verifying
// authorization is still active and still belongs to the site owner — either
// the owner's account-level connection (`cc`) or the site's own authorization
// (`sc`), which must also still name the bound channel. Nothing else compares
// external ids: whether a creator owns a channel was decided by
// provider-specific verification at bind time and is recorded by the
// reference. Expects `community_channels ch` and `sites s` in scope.
export const ROUTABLE_CHANNEL_AUTHORIZATION_JOINS_SQL = `
       LEFT JOIN creator_connections cc
         ON cc.id = ch.creator_connection_id AND cc.provider = ch.provider
        AND cc.user_id = s.user_id AND cc.status = 'active' AND cc.linked_at IS NOT NULL
       LEFT JOIN site_creator_connections sc
         ON sc.id = ch.site_creator_connection_id AND sc.provider = ch.provider
        AND sc.site_id = ch.site_id AND sc.user_id = s.user_id AND sc.status = 'active'
        AND sc.linked_at IS NOT NULL AND sc.verified_channel_id = ch.external_channel_id`;

export const ROUTABLE_CHANNEL_CONDITION_SQL =
  `ch.status = 'active' AND ch.verified_at IS NOT NULL AND (cc.id IS NOT NULL OR sc.id IS NOT NULL)`;

/**
 * Other sites of `userId` still bound (active + verified) through the
 * creator's account-level connection. Sites proven by their own authorization
 * do not depend on it. Used to decide whether disconnecting one site must also
 * revoke the account-level connection, and whether a site connected with a
 * different provider account may re-point it.
 */
export async function otherVerifiedChannelForCreator(
  run: SqlRunner, userId: string, provider: ProviderId, excludeSiteId: string,
): Promise<string | null> {
  const [row] = await rows<{ id: string }>(run,
    `SELECT ch.site_id AS id
       FROM community_channels ch
       JOIN sites s ON s.id = ch.site_id
       JOIN creator_connections cc ON cc.id = ch.creator_connection_id
      WHERE ch.provider = $1
        AND ch.status = 'active' AND ch.verified_at IS NOT NULL
        AND cc.provider = ch.provider AND cc.user_id = s.user_id
        AND cc.status = 'active' AND cc.linked_at IS NOT NULL
        AND s.user_id = $2 AND ch.site_id <> $3
      LIMIT 1`,
    [provider, userId, excludeSiteId]);
  return row?.id ?? null;
}

/**
 * Routing for inbound provider events: the site a verified, active channel
 * binding routes to, or null. Locks the site row and the verifying
 * authorization for the caller's transaction.
 */
export async function resolveVerifiedCommunityChannel(
  run: SqlRunner, provider: ProviderId, externalChannelId: string,
): Promise<{ siteId: string; userId: string } | null> {
  const [row] = await rows<{ site_id: string; user_id: string; cc_id: string | null; sc_id: string | null }>(run,
    `SELECT s.id AS site_id, s.user_id, cc.id AS cc_id, sc.id AS sc_id
       FROM community_channels ch
       JOIN sites s ON s.id = ch.site_id${ROUTABLE_CHANNEL_AUTHORIZATION_JOINS_SQL}
      WHERE ch.provider = $1 AND ch.external_channel_id = $2
        AND ${ROUTABLE_CHANNEL_CONDITION_SQL}
      LIMIT 1 FOR UPDATE OF s`,
    [provider, externalChannelId]);
  if (!row) return null;
  const [proof] = row.cc_id
    ? await rows<{ id: string }>(run,
      `SELECT id FROM creator_connections WHERE id = $1 AND status = 'active' FOR SHARE`, [row.cc_id])
    : await rows<{ id: string }>(run,
      `SELECT id FROM site_creator_connections WHERE id = $1 AND status = 'active' FOR SHARE`, [row.sc_id]);
  return proof ? { siteId: row.site_id, userId: row.user_id } : null;
}

/** The authorization proving the site's routable channel, with its credentials; null when none routes. */
export async function loadChannelAuthorization(
  run: SqlRunner, siteId: string, provider: ProviderId,
): Promise<ChannelAuthorization | null> {
  const [row] = await rows<{
    user_id: string; external_channel_id: string; external_channel_name: string | null;
    cc_id: string | null; cc_external_user_id: string | null; cc_username: string | null; cc_linked_at: string | null;
    cc_access: string | null; cc_refresh: string | null; cc_expires: string | null;
    sc_id: string | null; sc_external_user_id: string | null; sc_username: string | null; sc_linked_at: string | null;
    sc_access: string | null; sc_refresh: string | null; sc_expires: string | null;
  }>(run,
    `SELECT s.user_id, ch.external_channel_id, ch.external_channel_name,
            cc.id AS cc_id, cc.external_user_id AS cc_external_user_id, cc.username AS cc_username,
            cc.linked_at AS cc_linked_at, cc.access_token_enc AS cc_access, cc.refresh_token_enc AS cc_refresh,
            cc.token_expires_at AS cc_expires,
            sc.id AS sc_id, sc.external_user_id AS sc_external_user_id, sc.username AS sc_username,
            sc.linked_at AS sc_linked_at, sc.access_token_enc AS sc_access, sc.refresh_token_enc AS sc_refresh,
            sc.token_expires_at AS sc_expires
       FROM community_channels ch
       JOIN sites s ON s.id = ch.site_id${ROUTABLE_CHANNEL_AUTHORIZATION_JOINS_SQL}
      WHERE ch.site_id = $1 AND ch.provider = $2
        AND ${ROUTABLE_CHANNEL_CONDITION_SQL}
      LIMIT 1`,
    [siteId, provider]);
  if (!row) return null;
  const site = Boolean(row.sc_id);
  return {
    scope: site ? "site" : "account",
    connectionId: (site ? row.sc_id : row.cc_id) as string,
    siteId,
    userId: row.user_id,
    provider,
    externalUserId: (site ? row.sc_external_user_id : row.cc_external_user_id) as string,
    username: (site ? row.sc_username : row.cc_username) ?? null,
    externalChannelId: row.external_channel_id,
    externalChannelName: row.external_channel_name ?? null,
    linkedAt: (site ? row.sc_linked_at : row.cc_linked_at) ?? null,
    accessTokenEnc: (site ? row.sc_access : row.cc_access) ?? null,
    refreshTokenEnc: (site ? row.sc_refresh : row.cc_refresh) ?? null,
    tokenExpiresAt: (site ? row.sc_expires : row.cc_expires) ?? null,
  };
}

/**
 * The authorization a site's provider operations act with: the one proving its
 * routable channel; otherwise the site's own active authorization; otherwise
 * the owner's active account-level connection (`externalChannelId` empty when
 * no channel is bound yet).
 */
export async function loadSiteProviderAuthorization(
  run: SqlRunner, siteId: string, provider: ProviderId,
): Promise<ChannelAuthorization | null> {
  const routed = await loadChannelAuthorization(run, siteId, provider);
  if (routed) return routed;
  const [row] = await rows<{
    scope: "account" | "site"; id: string; user_id: string; external_user_id: string; username: string | null;
    verified_channel_id: string | null; linked_at: string | null; access_token_enc: string | null;
    refresh_token_enc: string | null; token_expires_at: string | null;
  }>(run,
    `SELECT 'site' AS scope, sc.id, sc.user_id, sc.external_user_id, sc.username, sc.verified_channel_id,
            sc.linked_at, sc.access_token_enc, sc.refresh_token_enc, sc.token_expires_at, 0 AS rank
       FROM site_creator_connections sc
       JOIN sites s ON s.id = sc.site_id AND s.user_id = sc.user_id
      WHERE sc.site_id = $1 AND sc.provider = $2 AND sc.status = 'active' AND sc.linked_at IS NOT NULL
     UNION ALL
     SELECT 'account', cc.id, cc.user_id, cc.external_user_id, cc.username, NULL,
            cc.linked_at, cc.access_token_enc, cc.refresh_token_enc, cc.token_expires_at, 1
       FROM creator_connections cc
       JOIN sites s ON s.user_id = cc.user_id
      WHERE s.id = $1 AND cc.provider = $2 AND cc.status = 'active' AND cc.linked_at IS NOT NULL
      ORDER BY rank
      LIMIT 1`,
    [siteId, provider]);
  if (!row) return null;
  return {
    scope: row.scope,
    connectionId: row.id,
    siteId,
    userId: row.user_id,
    provider,
    externalUserId: row.external_user_id,
    username: row.username ?? null,
    externalChannelId: row.verified_channel_id ?? "",
    externalChannelName: null,
    linkedAt: row.linked_at ?? null,
    accessTokenEnc: row.access_token_enc ?? null,
    refreshTokenEnc: row.refresh_token_enc ?? null,
    tokenExpiresAt: row.token_expires_at ?? null,
  };
}

/** Persist refreshed OAuth credentials on exactly the authorization they were refreshed from. */
export async function storeChannelAuthorizationTokens(
  run: SqlRunner, authorization: Pick<ChannelAuthorization, "scope" | "connectionId" | "userId" | "provider">, tokens: OAuthTokens,
): Promise<void> {
  if (authorization.scope === "account") {
    await storeCreatorConnectionTokens(run, authorization.userId, authorization.provider, tokens);
    return;
  }
  await run(
    `UPDATE site_creator_connections
        SET access_token_enc = $2, refresh_token_enc = $3, token_expires_at = $4, updated_at = now()
      WHERE id = $1 AND status = 'active'`,
    [authorization.connectionId, tokens.accessTokenEnc, tokens.refreshTokenEnc, tokens.tokenExpiresAt],
  );
}

/**
 * The provider proved this authorization's grant is invalid: drop its
 * credentials only (other sites' authorizations are untouched), keeping the
 * identity link so health reads "Reconnect required".
 */
export async function clearChannelAuthorizationTokens(
  run: SqlRunner, authorization: Pick<ChannelAuthorization, "scope" | "connectionId" | "userId" | "provider">,
): Promise<void> {
  if (authorization.scope === "account") {
    await clearCreatorConnectionTokens(run, authorization.userId, authorization.provider);
    return;
  }
  await run(
    `UPDATE site_creator_connections
        SET access_token_enc = NULL, refresh_token_enc = NULL, token_expires_at = NULL, updated_at = now()
      WHERE id = $1`,
    [authorization.connectionId],
  );
}

/** Upsert a site's own provider authorization and return its id; raises 23505 if another user actively owns the identity. */
export async function linkSiteCreatorConnection(run: SqlRunner, input: SiteCreatorConnectionInput): Promise<string> {
  const [row] = await rows<{ id: string }>(run,
    `INSERT INTO site_creator_connections AS sc
       (site_id, user_id, provider, external_user_id, username, verified_channel_id,
        access_token_enc, refresh_token_enc, token_expires_at, linked_at)
     VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6, $7, $8, $9, now())
     ON CONFLICT (site_id, provider) DO UPDATE
        SET user_id = EXCLUDED.user_id,
            external_user_id = EXCLUDED.external_user_id,
            username = EXCLUDED.username,
            verified_channel_id = EXCLUDED.verified_channel_id,
            access_token_enc = EXCLUDED.access_token_enc,
            refresh_token_enc = EXCLUDED.refresh_token_enc,
            token_expires_at = EXCLUDED.token_expires_at,
            linked_at = now(),
            status = 'active',
            updated_at = now()
     RETURNING id`,
    [input.siteId, input.userId, input.provider, input.externalUserId, input.username, input.verifiedChannelId,
      input.accessTokenEnc, input.refreshTokenEnc, input.tokenExpiresAt],
  );
  return row.id;
}

export async function revokeSiteCreatorConnection(run: SqlRunner, siteId: string, provider: ProviderId): Promise<void> {
  await run(
    `UPDATE site_creator_connections
        SET status = 'revoked', access_token_enc = NULL, refresh_token_enc = NULL, token_expires_at = NULL, updated_at = now()
      WHERE site_id = $1 AND provider = $2 AND status <> 'revoked'`,
    [siteId, provider],
  );
}

/**
 * Record a freshly verified provider authorization for one site and bind the
 * channel it proved. The owner's account-level connection is used (and
 * re-pointed if needed) unless it currently verifies another of the owner's
 * sites under a different provider account; then the authorization is stored
 * for this site alone, so connecting one site never invalidates another.
 * Provider-specific code must have proven `externalUserId` owns
 * `externalChannelId` before calling. Run inside a transaction.
 */
export async function linkSiteProviderAuthorization(
  run: SqlRunner, input: SiteProviderAuthorizationInput,
): Promise<{ scope: "account" | "site"; connectionId: string }> {
  const { siteId, externalChannelId, externalChannelName, ...creator } = input;
  const [account] = await rows<{ external_user_id: string; status: string }>(run,
    `SELECT external_user_id, status FROM creator_connections
      WHERE user_id = $1 AND provider = $2
      FOR UPDATE`,
    [creator.userId, creator.provider]);
  const accountServesOtherSite = Boolean(account)
    && account.status === "active"
    && account.external_user_id !== creator.externalUserId
    && Boolean(await otherVerifiedChannelForCreator(run, creator.userId, creator.provider, siteId));
  const binding = { siteId, provider: creator.provider, externalChannelId, externalChannelName, verified: true };
  if (accountServesOtherSite) {
    const connectionId = await linkSiteCreatorConnection(run, { ...creator, siteId, verifiedChannelId: externalChannelId });
    await linkCommunityChannel(run, { ...binding, siteCreatorConnectionId: connectionId });
    return { scope: "site", connectionId };
  }
  const connectionId = await linkCreatorConnection(run, creator);
  await revokeSiteCreatorConnection(run, siteId, creator.provider);
  await linkCommunityChannel(run, { ...binding, creatorConnectionId: connectionId });
  return { scope: "account", connectionId };
}
