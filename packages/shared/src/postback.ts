// Shared postback key lifecycle: creation, hashed lookup, rotation,
// revocation, and replay-guard deduplication.

import { one, exec, query } from "./db.js";
import { hashToken, newPostbackKey, safeEqual } from "./crypto.js";
import { encrypt, decrypt } from "./crypto.js";

const DEFAULT_TTL_S = 24 * 60 * 60;
const KEY_TTL_S = 365 * 24 * 60 * 60;

export interface PostbackOwner { id: string; userId: string; siteId: string | null; }
export type PostbackUsage = "signed" | "unsigned";

export const POSTBACK_SUNSET = "2026-10-01";

export function unsignedPostbacksEnabled(value?: string): boolean {
  return value !== "false" && value !== "0";
}

export function logPostbackIntake(
  path: "pb_legacy" | "api_postback_unsigned" | "pb_signed" | "scores_signed",
  owner: PostbackOwner,
  signed: boolean
): void {
  console.info(JSON.stringify({
    level: "info",
    event: "postback_intake",
    path,
    signed,
    owner_id: owner.userId,
    key_id: owner.id,
    ts: new Date().toISOString(),
  }));
}

async function hashPostbackKey(key: string): Promise<string> { return hashToken(key); }

async function getEncKey(): Promise<string> {
  const hex = process.env.TOKEN_ENC_KEY || "";
  if (hex.length !== 64) throw new Error("TOKEN_ENC_KEY must be 64 hex characters (32 bytes)");
  return hex;
}

export async function findPostbackOwner(
  key: string,
  usage?: PostbackUsage
): Promise<PostbackOwner | null> {
  const hash = await hashPostbackKey(key);
  const row = await one<{ id: string; user_id: string; site_id: string | null }>(
    `SELECT id, user_id, site_id FROM postback_keys
       WHERE key_hash = $1
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > now())
       LIMIT 1`,
    [hash]
  );
  if (!row) return null;
  try {
    await exec(
      `UPDATE postback_keys
          SET last_used_at = now(),
              last_signed_used_at = CASE WHEN $2 = 'signed' THEN now() ELSE last_signed_used_at END,
              last_unsigned_used_at = CASE WHEN $2 = 'unsigned' THEN now() ELSE last_unsigned_used_at END
        WHERE id = $1`,
      [row.id, usage || null]
    );
  } catch (error) {
    const compatibilityFallback = (error as { code?: string })?.code === "42703";
    if (compatibilityFallback) {
      await exec("UPDATE postback_keys SET last_used_at = now() WHERE id = $1", [row.id]).catch(() => {});
    }
    console[compatibilityFallback ? "warn" : "error"](JSON.stringify({
      level: compatibilityFallback ? "warn" : "error",
      event: compatibilityFallback
        ? "postback_usage_breakdown_unavailable"
        : "postback_usage_update_failed",
      key_id: row.id,
      error: error instanceof Error ? error.message : String(error),
      ts: new Date().toISOString(),
    }));
  }
  return { id: row.id, userId: row.user_id as string, siteId: row.site_id ?? null };
}

export async function getActivePostbackKey(userId: string): Promise<string | null> {
  const row = await one<{ id: string; key_plaintext: string | null; key_enc: string | null }>(
    `SELECT id, key_plaintext, key_enc FROM postback_keys
       WHERE user_id = $1
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > now())
       ORDER BY created_at DESC
       LIMIT 1`,
    [userId]
  );
  if (!row) return null;
  if (row.key_enc) {
    const hexKey = await getEncKey();
    const raw = await decrypt(row.key_enc, hexKey);
    return raw;
  }
  if (row.key_plaintext) return row.key_plaintext;
  return null;
}

export interface CreatedPostbackKey {
  key: string;
  id: string | null;
  createdAt: string | null;
  expiresAt: string | null;
}

export async function createPostbackKeyRecord(
  userId: string,
  { label, revokeOthers = false, siteId = null, execImpl = exec }: { label?: string; revokeOthers?: boolean; siteId?: string | null; execImpl?: typeof exec } = {}
): Promise<CreatedPostbackKey> {
  const raw = newPostbackKey();
  const hash = await hashPostbackKey(raw);
  const hexKey = await getEncKey();
  const keyEnc = await encrypt(raw, hexKey);
  const inserted = await execImpl(
    `INSERT INTO postback_keys (user_id, site_id, key_hash, key_plaintext, key_enc, label, created_at, expires_at)
     VALUES ($1, $2, $3, NULL, $4, $5, now(), now() + make_interval(secs => $6))
     RETURNING id, created_at, expires_at`,
    [userId, siteId, hash, keyEnc, label || null, KEY_TTL_S]
  );
  const row = Array.isArray(inserted) ? inserted[0] : null;
  if (revokeOthers && row?.id) {
    await revokePostbackKeys(userId, row.id, { siteId, execImpl });
  }
  return { key: raw, id: row?.id ?? null, createdAt: row?.created_at ?? null, expiresAt: row?.expires_at ?? null };
}

export async function createPostbackKey(
  userId: string,
  options: { label?: string; revokeOthers?: boolean; siteId?: string | null; execImpl?: typeof exec } = {}
): Promise<string> {
  const created = await createPostbackKeyRecord(userId, options);
  return created.key;
}

export async function revokePostbackKeys(
  userId: string,
  keyId?: string | null,
  { siteId, execImpl = exec }: { siteId?: string | null; execImpl?: typeof exec } = {}
): Promise<number> {
  // Without a siteId the revocation stays account-scoped (site_id IS NULL) so
  // account flows can never revoke board keys, and vice versa.
  const siteClause = siteId ? "AND site_id = $3::uuid" : "AND site_id IS NULL";
  const params: unknown[] = [userId, keyId || null];
  if (siteId) params.push(siteId);
  const result = await execImpl(
    `UPDATE postback_keys SET revoked_at = now()
       WHERE user_id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR id != $2::uuid)
         ${siteClause}
       RETURNING id`,
    params
  );
  return Array.isArray(result) ? result.length : 0;
}

// Revokes exactly one board-scoped key owned by the user. Returns the number
// of rows revoked (0 when the key does not exist, is already revoked, or is
// scoped to a different board).
export async function revokePostbackKeyById(
  userId: string,
  keyId: string,
  siteId: string,
  { execImpl = exec }: { execImpl?: typeof exec } = {}
): Promise<number> {
  const result = await execImpl(
    `UPDATE postback_keys SET revoked_at = now()
       WHERE id = $1::uuid AND user_id = $2 AND site_id = $3::uuid
         AND revoked_at IS NULL
       RETURNING id`,
    [keyId, userId, siteId]
  );
  return Array.isArray(result) ? result.length : 0;
}

export interface ApiKeyInfo {
  id: string;
  siteId: string | null;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  key: string;
}

export async function listApiKeys(userId: string, siteId?: string | null): Promise<ApiKeyInfo[]> {
  // Account keys (site_id IS NULL) plus keys scoped to the requested board.
  const rows = await query<{ id: string; site_id: string | null; label: string | null; created_at: string; last_used_at: string | null; expires_at: string | null; key_plaintext: string | null; key_enc: string | null }>(
    `SELECT id, site_id, label, created_at, last_used_at, expires_at, key_plaintext, key_enc
       FROM postback_keys
      WHERE user_id = $1
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())
        AND (site_id IS NULL OR site_id = $2::uuid)
      ORDER BY created_at DESC`,
    [userId, siteId || null]
  );
  const hexKey = await getEncKey();
  const keys: ApiKeyInfo[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    let raw: string | null = null;
    if (row.key_enc) raw = await decrypt(row.key_enc, hexKey);
    else if (row.key_plaintext) raw = row.key_plaintext;
    if (!raw) continue;
    keys.push({
      id: row.id,
      siteId: row.site_id ?? null,
      label: row.label,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      expiresAt: row.expires_at,
      key: raw,
    });
  }
  return keys;
}

export async function recordReplayHash(
  userId: string,
  replayHash: string,
  ttlSec = DEFAULT_TTL_S,
  { execImpl = exec }: { execImpl?: typeof exec } = {},
): Promise<boolean> {
  try {
    const result = await execImpl(
      `INSERT INTO postback_replay_guard (user_id, replay_hash, expires_at)
       VALUES ($1, $2, now() + make_interval(secs => $3))
       ON CONFLICT (user_id, replay_hash) DO UPDATE
         SET expires_at = now() + make_interval(secs => $3)
         WHERE postback_replay_guard.expires_at <= now()
       RETURNING id`,
      [userId, replayHash, ttlSec]
    );
    return Array.isArray(result) && result.length > 0;
  } catch (e: any) {
    if (e?.code === "23505") return false;
    throw e;
  }
}

// Compensating action for a replay claim whose conversion never became durable.
export async function releaseReplayHash(
  userId: string,
  replayHash: string,
  { execImpl = exec }: { execImpl?: typeof exec } = {},
): Promise<boolean> {
  const result = await execImpl(
    `DELETE FROM postback_replay_guard
       WHERE user_id = $1 AND replay_hash = $2
       RETURNING id`,
    [userId, replayHash]
  );
  return Array.isArray(result) && result.length > 0;
}

const REPLAY_PURGE_BATCH_SIZE = 1000;
const REPLAY_PURGE_MAX_BATCHES = 1000;

export async function purgeExpiredReplayHashes(
  batchSize = REPLAY_PURGE_BATCH_SIZE,
  { execImpl = exec }: { execImpl?: typeof exec } = {},
): Promise<number> {
  const size = Math.max(1, Math.floor(batchSize));
  let deleted = 0;
  for (let batch = 0; batch < REPLAY_PURGE_MAX_BATCHES; batch += 1) {
    const rows = await execImpl(
      `DELETE FROM postback_replay_guard
       WHERE ctid IN (
         SELECT ctid FROM postback_replay_guard WHERE expires_at <= now() LIMIT $1
       )
       RETURNING id`,
      [size]
    );
    const count = Array.isArray(rows) ? rows.length : 0;
    deleted += count;
    if (count < size) break;
  }
  return deleted;
}

export async function computeReplayHash(payload: Record<string, string | string[] | undefined>): Promise<string> {
  const cleaned: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(payload)) {
    const lower = k.toLowerCase();
    if (lower === "key" || lower === "signature" || lower === "x-postback-key" || lower === "x-postback-signature") continue;
    if (v === undefined) continue;
    cleaned[k] = v;
  }
  const canonical = Object.keys(cleaned)
    .sort((a, b) => a.localeCompare(b))
    .map((k) => {
      const v = cleaned[k];
      return `${encodeURIComponent(k)}=${Array.isArray(v) ? v.map(encodeURIComponent).join(",") : encodeURIComponent(v)}`;
    })
    .join("&");
  const enc = new TextEncoder().encode(canonical);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export { safeEqual };
