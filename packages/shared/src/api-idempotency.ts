// Server-persisted Idempotency-Key support for the write API. A reservation is
// a short-lived in-progress lock; completing it stores the response for replay
// until the row expires.

import { one, exec } from "./db.js";

export const IDEMPOTENCY_KEY_MAX_LENGTH = 200;
export const IDEMPOTENCY_TTL_S = 24 * 60 * 60;
export const IDEMPOTENCY_LOCK_S = 60;

export async function computeIdempotencyRequestHash(
  { method, path, siteId, body }: { method: string; path: string; siteId: string; body: string }
): Promise<string> {
  const enc = new TextEncoder().encode(`${method} ${path}\n${siteId}\n${body}`);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface KeyIdentity {
  userId: string;
  siteId: string;
  endpoint: string;
  key: string;
}

interface ExistingRow {
  request_hash: string;
  status: string;
  response_status: number | null;
  response_body: unknown;
}

export type IdempotencyReservation =
  | { state: "reserved" }
  | { state: "replay"; status: number | null; body: unknown }
  | { state: "mismatch" }
  | { state: "in_progress" };

export async function reserveIdempotencyKey(
  { userId, siteId, endpoint, key, requestHash }: KeyIdentity & { requestHash: string },
  { execImpl = exec, oneImpl = one }: { execImpl?: typeof exec; oneImpl?: typeof one } = {},
): Promise<IdempotencyReservation> {
  const inserted = await execImpl(
    `INSERT INTO api_idempotency_keys (user_id, site_id, endpoint, idempotency_key, request_hash, status, expires_at)
     VALUES ($1, $2, $3, $4, $5, 'in_progress', now() + make_interval(secs => ${IDEMPOTENCY_LOCK_S}))
     ON CONFLICT (user_id, site_id, endpoint, idempotency_key) DO UPDATE
       SET request_hash = EXCLUDED.request_hash,
           status = 'in_progress',
           response_status = NULL,
           response_body = NULL,
           created_at = now(),
           expires_at = EXCLUDED.expires_at
       WHERE api_idempotency_keys.expires_at <= now()
     RETURNING id`,
    [userId, siteId, endpoint, key, requestHash]
  );
  if (Array.isArray(inserted) && inserted.length > 0) return { state: "reserved" };
  const existing = await oneImpl<ExistingRow>(
    `SELECT request_hash, status, response_status, response_body
       FROM api_idempotency_keys
      WHERE user_id = $1 AND site_id = $2 AND endpoint = $3 AND idempotency_key = $4`,
    [userId, siteId, endpoint, key]
  );
  if (!existing) return { state: "in_progress" };
  if (existing.request_hash !== requestHash) return { state: "mismatch" };
  if (existing.status === "completed") {
    return { state: "replay", status: existing.response_status, body: existing.response_body };
  }
  return { state: "in_progress" };
}

export async function completeIdempotencyKey(
  { userId, siteId, endpoint, key, status, body }: KeyIdentity & { status: number; body: unknown },
  { execImpl = exec }: { execImpl?: typeof exec } = {},
): Promise<boolean> {
  const updated = await execImpl(
    `UPDATE api_idempotency_keys
        SET status = 'completed',
            response_status = $5,
            response_body = $6::jsonb,
            expires_at = now() + make_interval(secs => ${IDEMPOTENCY_TTL_S})
      WHERE user_id = $1 AND site_id = $2 AND endpoint = $3 AND idempotency_key = $4
      RETURNING id`,
    [userId, siteId, endpoint, key, status, body]
  );
  return Array.isArray(updated) && updated.length > 0;
}

export async function releaseIdempotencyKey(
  { userId, siteId, endpoint, key }: KeyIdentity,
  { execImpl = exec }: { execImpl?: typeof exec } = {},
): Promise<boolean> {
  const deleted = await execImpl(
    `DELETE FROM api_idempotency_keys
      WHERE user_id = $1 AND site_id = $2 AND endpoint = $3 AND idempotency_key = $4
      RETURNING id`,
    [userId, siteId, endpoint, key]
  );
  return Array.isArray(deleted) && deleted.length > 0;
}
