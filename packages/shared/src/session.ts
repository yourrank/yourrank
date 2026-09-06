// ============================================================================
//  YourRank — SHARED SESSION (canonical TypeScript source)
//
//  ONE session model used identically by BOTH Workers:
//    * Cookie name:      yr_session
//    * Cookie domain:    .yourrank.site (or SESSION_COOKIE_DOMAIN)
//    * Storage:          Postgres "sessions" table (replaces Cloudflare KV)
//    * DB columns:       token, user_id, created_at, expires_at, twofa_verified_at
//
//  Both Workers call populateEnv() before any session operation so that
//  process.env.DATABASE_URL is available for the shared db.js module.
//
//  Cookie: httpOnly, Secure, SameSite=Lax, Domain=.yourrank.site, Path=/
//  Token:  64-hex-char (32 random bytes), rotated after 24h.
//  Storage: only SHA-256(token) is stored; the cookie carries the raw token.
//
//  SEC-107: Tokens are rotated when older than SESSION_ROTATE_AFTER_S (24 h)
//  or on first read of a legacy bare-UUID session.  The rotation returns a
//  Set-Cookie header so the caller can propagate it.
//
//  COMPAT: loadUser() is re-exported here for the leaderboard Worker, which
//  used to define it in auth.js.  The function queries the DB, so it belongs
//  in the shared data layer.
// ============================================================================

import { one, exec, query } from "./db.js";
import { hashToken } from "./crypto.js";

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

// Minimal env shape — both Workers satisfy this.
// HYPERDRIVE is no longer required since we use process.env.DATABASE_URL
// set by populateEnv() in both Workers.
// NOTE: the optional `SESSIONS` KV binding is owned by the rate limiter, not
// by session storage. Sessions live exclusively in Postgres to avoid the KV/DB
// split-brain behavior described in audit C-04.
export interface SessionEnv {
  SESSION_COOKIE_DOMAIN?: string;
  ENVIRONMENT?: string;
  HYPERDRIVE?: unknown;         // kept for type compat, not used
}

export interface UserRecord {
  id: string;
  email: string;
  display_name: string | null;
  slug: string;
  plan: string;
  plan_expires_at: string | null;
  status: string;
  is_admin?: boolean;
}

// ---------------------------------------------------------------------------
//  Constants
// ---------------------------------------------------------------------------

export const COOKIE_NAME = "yr_session";
export const SESSION_TTL_S = 30 * 86400;    // 30 days
export const SESSION_ROTATE_AFTER_S = 86400; // 24 h
export const SESSION_ROTATE_GRACE_S = 120;
export const COOKIE_DOMAIN = ".yourrank.site";
export const KV_PREFIX = "sess:";
export const LEGACY_COOKIE_NAME = "sess";
export const LEGACY_COOKIE_NAME2 = "gm_session";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function newToken(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

// ---------------------------------------------------------------------------
//  Cookie helpers
// ---------------------------------------------------------------------------
function cookieAttrs(): string {
  return `HttpOnly; Secure; SameSite=Lax; Domain=${COOKIE_DOMAIN}; Path=/`;
}

export const cookieClearLegacy = (): string =>
  `${LEGACY_COOKIE_NAME}=; ${cookieAttrs()}; Max-Age=0`;

export const cookieClearLegacy2 = (): string =>
  `${LEGACY_COOKIE_NAME2}=; ${cookieAttrs()}; Max-Age=0`;

export function hasLegacyCookie(req: Request): boolean {
  const c = req.headers.get("cookie") || "";
  return new RegExp("(?:^|;\\s*)" + LEGACY_COOKIE_NAME + "=").test(c);
}


function legacyGmSessionEnabled(): boolean {
  const env = (typeof (globalThis as any).process !== "undefined") ? (globalThis as any).process.env : {};
  const cutoff = env?.LEGACY_GM_SESSION_CUTOFF;
  if (!cutoff) return true;
  const cutoffMs = Date.parse(cutoff);
  return Number.isNaN(cutoffMs) || Date.now() <= cutoffMs;
}

export function readTokenFromHeader(cookieHeader: string | undefined | null): string | null {
  if (!cookieHeader) return null;
  const names = [COOKIE_NAME];
  if (legacyGmSessionEnabled()) names.push(LEGACY_COOKIE_NAME2);
  for (const name of names) {
    const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
    if (m) return decodeURIComponent(m[1]);
  }
  return null;
}

export function readToken(req: Request): string | null {
  return readTokenFromHeader(req.headers.get("cookie") || "");
}

export function parseSessionValue(raw: string): { userId: string; createdAt: number } {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed.u === "string") {
      return { userId: parsed.u, createdAt: typeof parsed.c === "number" ? parsed.c : 0 };
    }
  } catch {
    // fall through to legacy bare-token handling
  }
  return { userId: raw, createdAt: 0 };
}

export function cookieDomain(env: SessionEnv): string {
  if (env.SESSION_COOKIE_DOMAIN !== undefined) return env.SESSION_COOKIE_DOMAIN;
  return COOKIE_DOMAIN;
}

/** Return a Set-Cookie header string that stores `token`. */
export function cookieSet(token: string, env?: SessionEnv): string {
  const domain = env ? cookieDomain(env) : COOKIE_DOMAIN;
  const secure = env?.ENVIRONMENT === "development" ? "" : "Secure; ";
  const domainAttr = domain ? ` Domain=${domain};` : "";
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; ${secure}SameSite=Lax;${domainAttr} Path=/; Max-Age=${SESSION_TTL_S}`;
}

/** Return a Set-Cookie header string that clears the session. */
export function cookieClear(env?: SessionEnv): string {
  const domain = env ? cookieDomain(env) : COOKIE_DOMAIN;
  const secure = env?.ENVIRONMENT === "development" ? "" : "Secure; ";
  const domainAttr = domain ? ` Domain=${domain};` : "";
  return `${COOKIE_NAME}=; HttpOnly; ${secure}SameSite=Lax;${domainAttr} Path=/; Max-Age=0`;
}

// ---------------------------------------------------------------------------
//  Session CRUD (Postgres-backed)
// ---------------------------------------------------------------------------

/** Create a new session for `userId`. Returns the raw token (cookie value). */
export async function createSession(_env: SessionEnv, userId: string): Promise<string> {
  const token = newToken();
  const tokenHash = await hashToken(token);
  await exec(
    `INSERT INTO sessions (token, user_id, created_at, expires_at)
     VALUES ($1, $2, now(), now() + make_interval(secs => $3))
     ON CONFLICT (token) DO NOTHING`,
    [tokenHash, userId, SESSION_TTL_S]
  );
  return token;
}

/** Delete one session.  Used during logout. */
export async function destroySession(_env: SessionEnv, token: string | null): Promise<void> {
  if (!token) return;
  const tokenHash = await hashToken(token);
  await exec("DELETE FROM sessions WHERE token = $1 OR previous_token = $1", [tokenHash]);
}

/**
 * Delete ALL sessions for a user.  Used during password change or admin
 * "log out everywhere".  DB cascade ON DELETE also handles this when the
 * user row is deleted, but explicit call is needed for revoke-all.
 */
export async function destroyAllUserSessions(_env: SessionEnv, userId: string): Promise<void> {
  await exec("DELETE FROM sessions WHERE user_id = $1", [userId]);
}

// ---------------------------------------------------------------------------
//  Session resolution (read + TTL refresh + rotation)
// ---------------------------------------------------------------------------

interface ResolveResult {
  userId: string | null;
  uid: string | null;      // alias for bot dashboard
  cookie: string | null;   // Set-Cookie header if rotation happened
  rotatedCookie: string | null; // alias for bot dashboard
}

interface SessionResolveDeps {
  query?: typeof query;
  exec?: typeof exec;
}

/**
 * Resolve the current user ID from the request cookie.
 *
 * Reads the session from Postgres. If valid, refreshes the expiry (sliding
 * window) and rotates the token if it's older than SESSION_ROTATE_AFTER_S.
 *
 * Returns { userId, cookie } — cookie is non-null when rotation happened and
 * must be appended to the response as a Set-Cookie header.
 */
export async function resolveSession(
  req: Request,
  env: SessionEnv,
  deps: SessionResolveDeps = {},
): Promise<ResolveResult> {
  const token = readToken(req);
  if (!token) return { userId: null, uid: null, cookie: null, rotatedCookie: null };
  const tokenHash = await hashToken(token);
  const queryImpl = deps.query || query;
  const execImpl = deps.exec || exec;

  // Read session from DB
  const row = await queryImpl(
    `SELECT user_id,
            extract(epoch FROM now() - created_at)::int AS age,
            (token = $1) AS is_current
       FROM sessions
      WHERE (token = $1 OR (previous_token = $1 AND rotated_at > now() - make_interval(secs => $2)))
        AND expires_at > now()`,
    [tokenHash, SESSION_ROTATE_GRACE_S]
  );
  if (!row || row.length === 0) return { userId: null, uid: null, cookie: null, rotatedCookie: null };

  const user_id = row[0].user_id as string;
  const age = Number(row[0].age || 0);
  const isCurrent = row[0].is_current !== false;
  const userId = user_id;

  // SEC-107: Rotate if session is older than threshold. Use the same 32-byte
  // token format as new sessions instead of a shorter UUID.
  if (isCurrent && age > SESSION_ROTATE_AFTER_S) {
    try {
      const rotated = newToken();
      const rotatedHash = await hashToken(rotated);
      // Atomic swap: update the existing row's token and reset created_at.
      // RETURNING token lets us detect the race where another request already rotated.
      // (The sessions PK is `token`; there is no `id` column — RETURNING id
      // made the whole UPDATE error out, so rotation silently never happened.)
      const updated = await execImpl(
        `UPDATE sessions
            SET token = $1,
                previous_token = $3,
                rotated_at = now(),
                created_at = now(),
                expires_at = now() + make_interval(secs => $2),
                twofa_verified_at = twofa_verified_at
          WHERE token = $3
          RETURNING token`,
        [rotatedHash, SESSION_TTL_S, tokenHash]
      );
      if (!updated || updated.length === 0) {
        console.warn("[session] rotation race lost, serving with old token");
      } else {
        const setCookie = cookieSet(rotated, env);
        return { userId, uid: userId, cookie: setCookie, rotatedCookie: setCookie };
      }
    } catch {
      // Rotation failed — still serve the request with the old token
      console.error("[session] rotation failed, serving with old token");
    }
  }

  // Sliding-window TTL refresh (if we didn't rotate)
  execImpl(
    "UPDATE sessions SET expires_at = now() + make_interval(secs => $1) WHERE token = $2 OR previous_token = $2",
    [SESSION_TTL_S, tokenHash]
  ).catch(e => console.error("[session] TTL refresh failed:", e?.message));

  return { userId, uid: userId, cookie: null, rotatedCookie: null };
}

/**
 * Resolve just the user ID (no rotation cookie).
 * Use resolveSession() when you need the rotation cookie.
 */
export async function currentUserId(req: Request, env: SessionEnv): Promise<string | null> {
  const token = readToken(req);
  if (!token) return null;
  const tokenHash = await hashToken(token);

  const row = await query(
    "SELECT user_id FROM sessions WHERE token = $1 AND expires_at > now()",
    [tokenHash]
  );
  if (!row || row.length === 0) return null;

  // Sliding-window TTL refresh
  exec(
    "UPDATE sessions SET expires_at = now() + make_interval(secs => $1) WHERE token = $2",
    [SESSION_TTL_S, tokenHash]
  ).catch(e => console.error("[session] TTL refresh failed:", e?.message));

  return row[0].user_id as string;
}

// ---------------------------------------------------------------------------
//  User loader (shared — both Workers need this)
// ---------------------------------------------------------------------------

export async function loadUser(env: SessionEnv, userId: string): Promise<UserRecord | null> {
  try {
    return (await one<UserRecord>(
      `SELECT u.id, u.email, u.display_name,
              COALESCE(sa.slug, sf.slug, '') AS slug,
              u.plan, u.plan_expires_at, u.status, u.is_admin
         FROM users u
         LEFT JOIN sites sa ON sa.id = u.active_site_id AND sa.user_id = u.id
         LEFT JOIN LATERAL (
           SELECT s.slug FROM sites s
            WHERE s.user_id = u.id
            ORDER BY s.board_order NULLS LAST, s.updated_at ASC, s.slug ASC
            LIMIT 1
         ) sf ON true
        WHERE u.id = $1`,
      [userId]
    )) ?? null;
  } catch (e) {
    console.error("[session] loadUser failed:", (e as Error)?.message ?? e);
    return null;
  }
}

// ---------------------------------------------------------------------------
//  High-level: resolve session + load user
// ---------------------------------------------------------------------------

/** Return the current user (or null) and propagate rotation cookie. */
export async function resolveUser(req: Request, env: SessionEnv): Promise<{ user: UserRecord | null; cookie: string | null }> {
  const { userId, cookie } = await resolveSession(req, env);
  if (!userId) return { user: null, cookie: null };
  const user = await loadUser(env, userId);
  return { user, cookie };
}

/** Return the current user (or null).  Convenience wrapper. */
export async function currentUser(req: Request, env: SessionEnv): Promise<UserRecord | null> {
  const uid = await currentUserId(req, env);
  if (!uid) return null;
  return loadUser(env, uid);
}
