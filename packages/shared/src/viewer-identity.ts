// Provider-neutral viewer identity: the application contract over
// `viewer_identities`. Generic code (account, people, session, exports, display
// names) reads linked identities through this module; the legacy
// `viewers.kick_*` / `discord_*` columns stay mirrored for the compatibility
// phase and are only read here as a fallback when a row carries no
// `identities` aggregate (docs/PROVIDER_PORTABILITY_PLAN.md §4).
import { PROVIDER_IDS, PROVIDER_LABELS, isProviderId, type ProviderId } from "./providers/types.js";

export type SqlRunner = (sql: string, params?: unknown[]) => Promise<unknown[] | { length: number } | void>;

/** Row of `viewer_identities` as exposed to the application (no tokens). */
export interface ViewerIdentity {
  provider: ProviderId;
  externalUserId: string;
  username: string | null;
  avatarUrl: string | null;
  linkedAt: string | Date | null;
}

export interface ViewerIdentityRow {
  /** Aggregate produced by `viewerIdentitiesSql()`; generic source of truth. */
  identities?: ViewerIdentity[] | string | null;
  // Legacy mirror columns, fallback only.
  kick_user_id?: string | null;
  kick_username?: string | null;
  kick_linked_at?: string | Date | null;
  discord_user_id?: string | null;
  discord_username?: string | null;
  discord_linked_at?: string | Date | null;
}

export interface LinkedViewerIdentity extends ViewerIdentity {
  label: string;
}

const PROVIDER_ORDER_SQL = `ARRAY[${PROVIDER_IDS.map((id) => `'${id}'`).join(",")}]::text[]`;

/**
 * Correlated subquery yielding the active identities of viewer `alias` as a
 * jsonb array in canonical provider order. Embed as a select-list expression:
 * `SELECT v.id, ${viewerIdentitiesSql("v")} AS identities FROM viewers v`.
 */
export function viewerIdentitiesSql(alias = "v"): string {
  return `(SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'provider', vi.provider, 'externalUserId', vi.external_user_id, 'username', vi.username,
              'avatarUrl', vi.avatar_url, 'linkedAt', vi.linked_at)
            ORDER BY array_position(${PROVIDER_ORDER_SQL}, vi.provider), vi.linked_at), '[]'::jsonb)
       FROM viewer_identities vi
      WHERE vi.viewer_id = ${alias}.id AND vi.status = 'active')`;
}

function parseIdentities(value: ViewerIdentityRow["identities"]): ViewerIdentity[] | null {
  if (value == null) return null;
  let list: unknown = value;
  if (typeof list === "string") {
    try { list = JSON.parse(list); } catch { return null; }
  }
  if (!Array.isArray(list)) return null;
  const out: ViewerIdentity[] = [];
  for (const item of list as Record<string, unknown>[]) {
    if (!item || !isProviderId(item.provider) || !item.externalUserId) continue;
    out.push({
      provider: item.provider,
      externalUserId: String(item.externalUserId),
      username: item.username ? String(item.username) : null,
      avatarUrl: item.avatarUrl ? String(item.avatarUrl) : null,
      linkedAt: (item.linkedAt as string | null) ?? null,
    });
  }
  return out;
}

/** Legacy columns → identity list, same shape as the generic aggregate. */
function legacyIdentities(row: ViewerIdentityRow): ViewerIdentity[] {
  const out: ViewerIdentity[] = [];
  for (const prefix of ["kick", "discord"] as const) {
    const linkedAt = row[`${prefix}_linked_at`] ?? null;
    if (!linkedAt) continue;
    out.push({
      provider: prefix,
      externalUserId: row[`${prefix}_user_id`] || "",
      username: row[`${prefix}_username`] || null,
      avatarUrl: null,
      linkedAt,
    });
  }
  return out;
}

export function linkedViewerIdentities(row: ViewerIdentityRow | null | undefined): LinkedViewerIdentity[] {
  if (!row) return [];
  const identities = parseIdentities(row.identities) ?? legacyIdentities(row);
  return identities.map((identity) => ({ ...identity, label: PROVIDER_LABELS[identity.provider] }));
}

/** First non-empty linked username in provider order, else `fallback`. */
export function viewerDisplayName(row: ViewerIdentityRow | null | undefined, fallback = "Member"): string {
  const identities = parseIdentities(row?.identities);
  if (identities) return identities.find((identity) => identity.username)?.username || fallback;
  return row?.kick_username || row?.discord_username || fallback;
}

// ---------------------------------------------------------------------------
// Resolution + persistence (shared by every provider's viewer OAuth callback).
// Provider protocol (token exchange, profile fetch) stays in the provider
// module; only what ends up in `viewer_identities` goes through here.
// ---------------------------------------------------------------------------

export interface ExternalViewerIdentity {
  provider: ProviderId;
  externalUserId: string;
  username: string;
  avatarUrl: string | null;
  accessTokenEnc: string | null;
  refreshTokenEnc: string | null;
  tokenExpiresAt: string | null;
}

export interface ResolvedViewerIdentity {
  viewerId: string;
  username: string | null;
}

/** Active owner of `(provider, externalUserId)`, or null. Revoked rows never match. */
export async function findViewerByExternalIdentity(
  run: SqlRunner,
  provider: ProviderId,
  externalUserId: string,
  { forUpdate = false }: { forUpdate?: boolean } = {},
): Promise<ResolvedViewerIdentity | null> {
  const rows = (await run(
    `SELECT viewer_id, username
       FROM viewer_identities
      WHERE provider = $1 AND external_user_id = $2 AND status = 'active'
      LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [provider, externalUserId],
  )) as { viewer_id: string; username: string | null }[] | undefined;
  const row = rows?.[0];
  return row ? { viewerId: row.viewer_id, username: row.username ?? null } : null;
}

// Legacy mirror: providers that still own columns on `viewers`. New providers
// have no entry and are persisted in `viewer_identities` only.
const LEGACY_VIEWER_COLUMNS: Partial<Record<ProviderId, {
  userId: string; username: string; avatar: string | null;
  access: string; refresh: string; expires: string; linkedAt: string;
}>> = {
  kick: {
    userId: "kick_user_id", username: "kick_username", avatar: "kick_avatar_url",
    access: "kick_access_token_enc", refresh: "kick_refresh_token_enc", expires: "kick_token_expires_at", linkedAt: "kick_linked_at",
  },
  discord: {
    userId: "discord_user_id", username: "discord_username", avatar: null,
    access: "discord_access_token_enc", refresh: "discord_refresh_token_enc", expires: "discord_token_expires_at", linkedAt: "discord_linked_at",
  },
};

async function recordUsername(run: SqlRunner, viewerId: string, username: string | null | undefined) {
  const value = String(username || "").trim().toLowerCase();
  if (!value) return;
  await run(
    `INSERT INTO viewer_username_history (viewer_id, username)
     VALUES ($1, $2)
     ON CONFLICT (viewer_id, username)
     DO UPDATE SET seen_at = now()`,
    [viewerId, value],
  );
}

/**
 * Link `identity` to `viewerId` (or create a new viewer when null) and return
 * the viewer id. Writes the generic row first, then the legacy mirror columns
 * for providers that still have them. Username history is kept for anti-fraud.
 * Raises SQLSTATE 23505 when another active viewer owns the identity.
 */
export async function persistViewerIdentity(
  run: SqlRunner,
  identity: ExternalViewerIdentity,
  viewerId: string | null,
  { previousUsername = null, tokens = true }: { previousUsername?: string | null; tokens?: boolean } = {},
): Promise<string> {
  let id = viewerId;
  if (!id) {
    const rows = (await run(
      "INSERT INTO viewers (avatar_url) VALUES ($1) RETURNING id",
      [identity.avatarUrl],
    )) as { id: string }[];
    id = rows[0].id;
  }
  const oldUsername = String(previousUsername || "").trim().toLowerCase();
  const newUsername = identity.username.trim().toLowerCase();
  if (oldUsername && oldUsername !== newUsername) await recordUsername(run, id, oldUsername);

  await run(
    `INSERT INTO viewer_identities AS vi
       (viewer_id, provider, external_user_id, username, avatar_url, access_token_enc, refresh_token_enc, token_expires_at, linked_at)
     VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6, $7, $8, CASE WHEN $9 THEN now() END)
     ON CONFLICT (viewer_id, provider) DO UPDATE
        SET external_user_id = EXCLUDED.external_user_id,
            username = EXCLUDED.username,
            avatar_url = COALESCE(EXCLUDED.avatar_url, vi.avatar_url),
            access_token_enc = CASE WHEN $9 THEN EXCLUDED.access_token_enc ELSE vi.access_token_enc END,
            refresh_token_enc = CASE WHEN $9 THEN EXCLUDED.refresh_token_enc ELSE vi.refresh_token_enc END,
            token_expires_at = CASE WHEN $9 THEN EXCLUDED.token_expires_at ELSE vi.token_expires_at END,
            linked_at = CASE WHEN $9 THEN now() ELSE vi.linked_at END,
            status = 'active',
            updated_at = now()`,
    [id, identity.provider, identity.externalUserId, identity.username, identity.avatarUrl,
      identity.accessTokenEnc, identity.refreshTokenEnc, identity.tokenExpiresAt, tokens],
  );

  const legacy = LEGACY_VIEWER_COLUMNS[identity.provider];
  if (legacy) {
    const sets = [
      `${legacy.userId} = $1`,
      `${legacy.username} = $2`,
      "avatar_url = COALESCE($3, avatar_url)",
      "updated_at = now()",
    ];
    const params: unknown[] = [identity.externalUserId, identity.username, identity.avatarUrl];
    if (legacy.avatar) sets.push(`${legacy.avatar} = COALESCE($3, ${legacy.avatar})`);
    if (tokens) {
      params.push(identity.accessTokenEnc, identity.refreshTokenEnc, identity.tokenExpiresAt);
      sets.push(`${legacy.access} = $4`, `${legacy.refresh} = $5`, `${legacy.expires} = $6`, `${legacy.linkedAt} = now()`);
    }
    params.push(id);
    await run(`UPDATE viewers SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
  }

  await recordUsername(run, id, newUsername);
  return id;
}

/** Unlink a provider identity from a viewer. The row is kept (revoked) for audit; legacy mirror columns are cleared. */
export async function revokeViewerIdentity(run: SqlRunner, viewerId: string, provider: ProviderId): Promise<void> {
  await run(
    `UPDATE viewer_identities
        SET status = 'revoked', access_token_enc = NULL, refresh_token_enc = NULL, updated_at = now()
      WHERE viewer_id = $1 AND provider = $2 AND status <> 'revoked'`,
    [viewerId, provider],
  );
  const legacy = LEGACY_VIEWER_COLUMNS[provider];
  if (legacy) {
    await run(
      `UPDATE viewers
          SET ${legacy.userId} = NULL, ${legacy.username} = NULL,
              ${legacy.access} = NULL, ${legacy.refresh} = NULL, ${legacy.expires} = NULL, ${legacy.linkedAt} = NULL,
              updated_at = now()
        WHERE id = $1`,
      [viewerId],
    );
  }
}
