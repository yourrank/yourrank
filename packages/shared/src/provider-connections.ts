// Provider-neutral creator connections and community channel bindings: the
// application contract over `creator_connections` / `community_channels`.
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
  verified: boolean;
}

export interface CommunityChannel {
  siteId: string;
  provider: ProviderId;
  externalChannelId: string;
  externalChannelName: string | null;
  creatorConnectionId: string | null;
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
  tokens: { accessTokenEnc: string; refreshTokenEnc: string | null; tokenExpiresAt: string | Date | null },
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
    linked_at: string | null; verified_at: string | null;
  }>(run,
    `SELECT external_channel_id, external_channel_name, creator_connection_id, linked_at, verified_at
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
    linkedAt: row.linked_at ?? null,
    verifiedAt: row.verified_at ?? null,
  };
}

/**
 * Bind a channel to a site; raises 23505 if another site actively owns the
 * channel. A verified binding must name the creator connection that verified
 * it, and that connection must be an active connection of the site owner for
 * the same provider (otherwise a creator could bind a channel to a site they
 * do not own).
 */
export async function linkCommunityChannel(run: SqlRunner, input: CommunityChannelInput): Promise<void> {
  const creatorConnectionId = input.creatorConnectionId ?? null;
  if (input.verified && !creatorConnectionId) {
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
  await run(
    `INSERT INTO community_channels AS ch
       (site_id, provider, external_channel_id, external_channel_name, creator_connection_id, linked_at, verified_at)
     VALUES ($1, $2, $3, NULLIF($4, ''), $6, now(), CASE WHEN $5 THEN now() END)
     ON CONFLICT (site_id, provider) DO UPDATE
        SET external_channel_id = EXCLUDED.external_channel_id,
            external_channel_name = EXCLUDED.external_channel_name,
            creator_connection_id = EXCLUDED.creator_connection_id,
            linked_at = now(),
            verified_at = EXCLUDED.verified_at,
            status = 'active',
            updated_at = now()`,
    [input.siteId, input.provider, input.externalChannelId, input.externalChannelName, input.verified, creatorConnectionId],
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
            chat_events_subscribed_at = NULL, reward_events_subscribed_at = NULL,
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

// A binding is routable when: active, verified, and its verifying creator
// connection is still active and still belongs to the site owner. Nothing here
// compares external ids: whether a creator owns a channel was decided by
// provider-specific verification at bind time and is recorded by the reference.
const VERIFIED_BINDING_SQL = `
       FROM community_channels ch
       JOIN sites s ON s.id = ch.site_id
       JOIN creator_connections cc ON cc.id = ch.creator_connection_id
      WHERE ch.provider = $1
        AND ch.status = 'active' AND ch.verified_at IS NOT NULL
        AND cc.provider = ch.provider AND cc.user_id = s.user_id
        AND cc.status = 'active' AND cc.linked_at IS NOT NULL`;

/**
 * Other sites of `userId` still bound (active + verified) through one of the
 * creator's active connections. Used to decide whether disconnecting one site
 * must also revoke the creator connection.
 */
export async function otherVerifiedChannelForCreator(
  run: SqlRunner, userId: string, provider: ProviderId, excludeSiteId: string,
): Promise<string | null> {
  const [row] = await rows<{ id: string }>(run,
    `SELECT ch.site_id AS id${VERIFIED_BINDING_SQL}
        AND s.user_id = $2 AND ch.site_id <> $3
      LIMIT 1`,
    [provider, userId, excludeSiteId]);
  return row?.id ?? null;
}

/**
 * Routing for inbound provider events: the site a verified, active channel
 * binding routes to, or null. Locks the site row for the caller's transaction.
 */
export async function resolveVerifiedCommunityChannel(
  run: SqlRunner, provider: ProviderId, externalChannelId: string,
): Promise<{ siteId: string; userId: string } | null> {
  const [row] = await rows<{ site_id: string; user_id: string }>(run,
    `SELECT s.id AS site_id, s.user_id${VERIFIED_BINDING_SQL}
        AND ch.external_channel_id = $2
      LIMIT 1 FOR UPDATE OF s FOR SHARE OF cc`,
    [provider, externalChannelId]);
  return row ? { siteId: row.site_id, userId: row.user_id } : null;
}
