// ============================================================================
//  YourRank — VIEWER SESSION (canonical TypeScript source)
//
//  Cookie:      yr_viewer
//  Cookie domain: .yourrank.site (or SESSION_COOKIE_DOMAIN)
//  Storage:     Postgres "viewer_sessions" table
//  Token:       64-hex-char (32 random bytes), hashed with SHA-256 in DB.
//
//  Viewers are a separate identity from streamer users, so they use a
//  separate cookie and session table.
// ============================================================================

import { one, exec, query } from "./db.js";
import { hashToken } from "./crypto.js";

export interface ViewerSessionEnv {
  SESSION_COOKIE_DOMAIN?: string;
  ENVIRONMENT?: string;
}

export interface ViewerRecord {
  id: string;
  kick_user_id: string | null;
  kick_username: string | null;
  discord_user_id: string | null;
  discord_username: string | null;
  avatar_url: string | null;
  kick_linked_at: string | null;
  discord_linked_at: string | null;
  created_at: string;
}

export const VIEWER_COOKIE_NAME = "yr_viewer";
export const VIEWER_SESSION_TTL_S = 30 * 86400;    // 30 days
export const VIEWER_SESSION_ROTATE_AFTER_S = 86400; // 24 h
export const VIEWER_SESSION_ROTATE_GRACE_S = 120;
const VIEWER_COOKIE_DOMAIN = ".yourrank.site";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function newViewerToken(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

function cookieDomainFromHostname(hostname: string | null): string | null {
  if (!hostname || hostname === "localhost" || hostname.includes(":")) return null;
  // Share the cookie across the yourrank.site apex and any subdomains.
  if (hostname === "yourrank.site" || hostname.endsWith(".yourrank.site")) return ".yourrank.site";
  // For custom domains, use a host-only cookie to avoid cross-domain leaks.
  return null;
}

function cookieDomain(env?: ViewerSessionEnv, req?: Request): string | null {
  if (req) {
    try {
      const hostname = new URL(req.url).hostname;
      return cookieDomainFromHostname(hostname);
    } catch { return null; }
  }
  return env?.SESSION_COOKIE_DOMAIN || VIEWER_COOKIE_DOMAIN;
}

function cookieAttrs(env?: ViewerSessionEnv, req?: Request): string {
  const domain = cookieDomain(env, req);
  const secure = env?.ENVIRONMENT === "development" ? "" : "Secure; ";
  const base = `HttpOnly; ${secure}SameSite=Lax; Path=/`;
  return domain ? `${base}; Domain=${domain}` : base;
}

export function viewerCookieSet(token: string, env?: ViewerSessionEnv, req?: Request): string {
  return `${VIEWER_COOKIE_NAME}=${encodeURIComponent(token)}; ${cookieAttrs(env, req)}; Max-Age=${VIEWER_SESSION_TTL_S}`;
}

export function viewerCookieClear(env?: ViewerSessionEnv, req?: Request): string {
  return `${VIEWER_COOKIE_NAME}=; ${cookieAttrs(env, req)}; Max-Age=0`;
}

export function readViewerToken(req: Request): string | null {
  const header = req.headers.get("cookie") || "";
  const m = header.match(new RegExp(`(?:^|;\\s*)${VIEWER_COOKIE_NAME}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export async function createViewerSession(_env: ViewerSessionEnv, viewerId: string): Promise<string> {
  const token = newViewerToken();
  const tokenHash = await hashToken(token);
  await exec(
    `INSERT INTO viewer_sessions (token, viewer_id, created_at, expires_at)
     VALUES ($1, $2, now(), now() + make_interval(secs => $3))
     ON CONFLICT (token) DO NOTHING`,
    [tokenHash, viewerId, VIEWER_SESSION_TTL_S]
  );
  return token;
}

export async function destroyViewerSession(_env: ViewerSessionEnv, token: string | null): Promise<void> {
  if (!token) return;
  const tokenHash = await hashToken(token);
  await exec("DELETE FROM viewer_sessions WHERE token = $1 OR previous_token = $1", [tokenHash]);
}

interface ResolveResult {
  viewerId: string | null;
  cookie: string | null;
}

interface ViewerSessionResolveDeps {
  query?: typeof query;
  exec?: typeof exec;
}

export async function resolveViewerSession(
  req: Request,
  env: ViewerSessionEnv,
  deps: ViewerSessionResolveDeps = {},
): Promise<ResolveResult> {
  const token = readViewerToken(req);
  if (!token) return { viewerId: null, cookie: null };
  const tokenHash = await hashToken(token);
  const queryImpl = deps.query || query;
  const execImpl = deps.exec || exec;

  const row = await queryImpl(
    `SELECT viewer_id, extract(epoch FROM now() - created_at)::int AS age
            ,(token = $1) AS is_current
       FROM viewer_sessions
      WHERE (token = $1 OR (previous_token = $1 AND rotated_at > now() - make_interval(secs => $2)))
        AND expires_at > now()`,
    [tokenHash, VIEWER_SESSION_ROTATE_GRACE_S]
  );
  if (!row || row.length === 0) return { viewerId: null, cookie: null };

  const viewerId = row[0].viewer_id as string;
  const age = Number(row[0].age || 0);
  const isCurrent = row[0].is_current !== false;

  // Rotate session if older than threshold.
  if (isCurrent && age > VIEWER_SESSION_ROTATE_AFTER_S) {
    try {
      const rotated = newViewerToken();
      const rotatedHash = await hashToken(rotated);
      const updated = await execImpl(
        `UPDATE viewer_sessions
            SET token = $1,
                previous_token = $3,
                rotated_at = now(),
                created_at = now(),
                expires_at = now() + make_interval(secs => $2)
          WHERE token = $3
        RETURNING token`,
        [rotatedHash, VIEWER_SESSION_TTL_S, tokenHash]
      );
      if (updated && updated.length > 0) {
        return { viewerId, cookie: viewerCookieSet(rotated, env, req) };
      }
    } catch {
      console.error("[viewer-session] rotation failed, serving with old token");
    }
  }

  // Sliding-window TTL refresh.
  execImpl(
    "UPDATE viewer_sessions SET expires_at = now() + make_interval(secs => $1) WHERE token = $2 OR previous_token = $2",
    [VIEWER_SESSION_TTL_S, tokenHash]
  ).catch((e) => console.error("[viewer-session] TTL refresh failed:", (e as Error)?.message));

  return { viewerId, cookie: null };
}

export async function loadViewer(_env: ViewerSessionEnv, viewerId: string): Promise<ViewerRecord | null> {
  try {
    return (await one<ViewerRecord>(
      `SELECT id, kick_user_id, kick_username, discord_user_id, discord_username,
              avatar_url, kick_linked_at, discord_linked_at, created_at
         FROM viewers WHERE id = $1`,
      [viewerId]
    )) ?? null;
  } catch (e) {
    console.error("[viewer-session] loadViewer failed:", (e as Error)?.message ?? e);
    return null;
  }
}

export async function resolveViewer(
  req: Request,
  env: ViewerSessionEnv
): Promise<{ viewer: ViewerRecord | null; cookie: string | null }> {
  const { viewerId, cookie } = await resolveViewerSession(req, env);
  if (!viewerId) return { viewer: null, cookie: null };
  const viewer = await loadViewer(env, viewerId);
  return { viewer, cookie };
}
