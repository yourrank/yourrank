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
import { addAuthMs } from "./request-id.js";
import { viewerIdentitiesSql, type ViewerIdentity } from "./viewer-identity.js";

export interface ViewerSessionEnv {
  SESSION_COOKIE_DOMAIN?: string;
  ENVIRONMENT?: string;
}

export type ViewerSessionAuthority =
  | { authority: "global" }
  | { authority: "site"; siteId: string; hostname: string; domainBindingId: string };

export interface ViewerRecord {
  id: string;
  /** Active provider identities (generic source). Legacy columns below stay for provider-specific callers. */
  identities: ViewerIdentity[];
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
/** Minimum gap between sliding-window TTL writes for the same session. */
export const SESSION_REFRESH_INTERVAL_S = 3600;
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
  try { return m ? decodeURIComponent(m[1]) : null; } catch { return null; }
}

export async function createViewerSession(
  _env: ViewerSessionEnv,
  viewerId: string,
  scope: ViewerSessionAuthority,
): Promise<string> {
  if (!scope || !["global", "site"].includes(scope.authority)) throw new Error("Viewer session authority required");
  const isSite = scope.authority === "site";
  if (isSite && (!scope.siteId || !scope.hostname || !scope.domainBindingId || cookieDomainFromHostname(scope.hostname))) {
    throw new Error("Invalid local viewer session authority");
  }
  const token = newViewerToken();
  // Domain-separated storage prevents a scope-blind N-1 reader from accepting
  // newly issued local tokens via its legacy sha256(rawToken) lookup.
  const tokenHash = await hashToken(isSite ? `site:${scope.hostname.toLowerCase()}:${token}` : token);
  const rows = await exec(
    `INSERT INTO viewer_sessions
       (token, viewer_id, authority, site_id, hostname, domain_binding_id, created_at, expires_at)
     SELECT $1, $2::uuid, $3, $4::uuid, $5, $6::uuid, now(), now() + make_interval(secs => $7)
      WHERE $3 = 'global' OR EXISTS (
        SELECT 1 FROM sites s JOIN users u ON u.id=s.user_id
         WHERE s.id=$4::uuid AND lower(s.custom_domain)=$5
           AND s.domain_auth_binding_id=$6::uuid AND s.domain_auth_verified_at IS NOT NULL
           AND s.domain_status='active' AND s.custom_hostname_id IS NOT NULL
           AND s.published=true AND s.is_draft=false AND u.email_verified=true AND u.status != 'suspended'
      )
     RETURNING token`,
    [tokenHash, viewerId, scope.authority, isSite ? scope.siteId : null,
      isSite ? scope.hostname.toLowerCase() : null, isSite ? scope.domainBindingId : null, VIEWER_SESSION_TTL_S]
  );
  if (!rows?.length) throw new Error("Viewer session domain authority changed");
  return token;
}

export async function destroyViewerSession(
  _env: ViewerSessionEnv,
  token: string | null,
  requestHostname?: string | null,
  { execImpl = exec, hashTokenImpl = hashToken }: {
    execImpl?: typeof exec;
    hashTokenImpl?: typeof hashToken;
  } = {},
): Promise<void> {
  if (!token) return;
  const hostname = String(requestHostname || "").toLowerCase();
  const globalHash = await hashTokenImpl(token);
  const localHash = hostname && cookieDomainFromHostname(hostname) !== VIEWER_COOKIE_DOMAIN
    ? await hashTokenImpl(`site:${hostname}:${token}`)
    : null;
  await execImpl(
    `DELETE FROM viewer_sessions
      WHERE token = $1 OR previous_token = $1 OR token = $2 OR previous_token = $2`,
    [globalHash, localHash],
  );
}

export interface ViewerSessionContext {
  authority: "global" | "site";
  siteId: string | null;
  hostname: string | null;
  domainBindingId: string | null;
}

interface ResolveResult {
  viewerId: string | null;
  cookie: string | null;
  session: ViewerSessionContext | null;
}

interface ViewerSessionResolveDeps {
  query?: typeof query;
  exec?: typeof exec;
  // Only an explicitly authorized Site operation may accept a local session.
  siteId?: string;
}

export async function resolveViewerSession(
  req: Request,
  env: ViewerSessionEnv,
  deps: ViewerSessionResolveDeps = {},
): Promise<ResolveResult> {
  const token = readViewerToken(req);
  if (!token) return { viewerId: null, cookie: null, session: null };
  const requestHost = new URL(req.url).hostname.toLowerCase();
  const platform = cookieDomainFromHostname(requestHost) === VIEWER_COOKIE_DOMAIN
    || (env.ENVIRONMENT === "development" && ["localhost", "127.0.0.1", "[::1]"].includes(requestHost));
  const tokenHash = await hashToken(platform ? token : `site:${requestHost}:${token}`);
  // Runs on the request-scoped client: a dedicated transaction connection
  // costs a second TCP + auth handshake per signed-in request.
  const queryImpl = deps.query || query;
  const execImpl = deps.exec || exec;
  const row = await queryImpl(
    `SELECT vs.viewer_id, vs.authority, vs.site_id, vs.hostname, vs.domain_binding_id,
            extract(epoch FROM now() - vs.created_at)::int AS age,
            (vs.token = $1) AS is_current,
            (vs.expires_at < now() + make_interval(secs => $6)) AS needs_refresh
       FROM viewer_sessions vs
       LEFT JOIN sites s ON s.id = vs.site_id
       LEFT JOIN users u ON u.id = s.user_id
      WHERE (vs.token = $1 OR (vs.previous_token = $1 AND vs.rotated_at > now() - make_interval(secs => $2)))
        AND vs.expires_at > now()
        AND (
          (vs.authority = 'global' AND $3 = true
            AND vs.site_id IS NULL AND vs.hostname IS NULL AND vs.domain_binding_id IS NULL)
          OR
          (vs.authority = 'site' AND $3 = false AND vs.site_id = $5::uuid
            AND lower(vs.hostname) = $4
            AND s.id = vs.site_id
            AND lower(s.custom_domain) = lower(vs.hostname)
            AND s.domain_status = 'active'
            AND s.custom_hostname_id IS NOT NULL
            AND s.domain_auth_binding_id = vs.domain_binding_id
            AND s.domain_auth_verified_at IS NOT NULL
            AND s.published = true
            AND s.is_draft = false
            AND u.status != 'suspended'
            AND u.email_verified = true)
        )
      FOR SHARE OF vs`,
    [
      tokenHash,
      VIEWER_SESSION_ROTATE_GRACE_S,
      platform,
      requestHost,
      deps.siteId || null,
      VIEWER_SESSION_TTL_S - SESSION_REFRESH_INTERVAL_S,
    ]
  );
  if (!row || row.length === 0) return { viewerId: null, cookie: null, session: null };

  const viewerId = row[0].viewer_id as string;
  const age = Number(row[0].age || 0);
  const isCurrent = row[0].is_current !== false;
  const session: ViewerSessionContext = {
    authority: row[0].authority as "global" | "site",
    siteId: (row[0].site_id as string | null) ?? null,
    hostname: (row[0].hostname as string | null) ?? null,
    domainBindingId: (row[0].domain_binding_id as string | null) ?? null,
  };

  // Rotate session if older than threshold.
  if (isCurrent && age > VIEWER_SESSION_ROTATE_AFTER_S) {
    try {
      const rotated = newViewerToken();
      const rotatedHash = await hashToken(platform ? rotated : `site:${requestHost}:${rotated}`);
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
        return { viewerId, cookie: viewerCookieSet(rotated, env, req), session };
      }
    } catch {
      console.error("[viewer-session] rotation failed, serving with old token");
    }
  }

  // Sliding-window TTL refresh, at most once per SESSION_REFRESH_INTERVAL_S so
  // the write does not queue ahead of the request's own reads on every hit.
  if (row[0].needs_refresh !== false) {
    execImpl(
      "UPDATE viewer_sessions SET expires_at = now() + make_interval(secs => $1) WHERE token = $2 OR previous_token = $2",
      [VIEWER_SESSION_TTL_S, tokenHash]
    ).catch((e) => console.error("[viewer-session] TTL refresh failed:", (e as Error)?.message));
  }

  return { viewerId, cookie: null, session };
}

export async function loadViewer(_env: ViewerSessionEnv, viewerId: string): Promise<ViewerRecord | null> {
  try {
    return (await one<ViewerRecord>(
      `SELECT v.id, v.kick_user_id, v.kick_username, v.discord_user_id, v.discord_username,
              v.avatar_url, v.kick_linked_at, v.discord_linked_at, v.created_at,
              ${viewerIdentitiesSql("v")} AS identities
         FROM viewers v WHERE v.id = $1`,
      [viewerId]
    )) ?? null;
  } catch (e) {
    console.error("[viewer-session] loadViewer failed:", (e as Error)?.message ?? e);
    return null;
  }
}

export async function resolveViewer(
  req: Request,
  env: ViewerSessionEnv,
  scope: { siteId?: string } = {},
): Promise<{ viewer: ViewerRecord | null; cookie: string | null; session: ViewerSessionContext | null }> {
  const started = performance.now();
  try {
    const { viewerId, cookie, session } = await resolveViewerSession(req, env, scope);
    if (!viewerId) return { viewer: null, cookie: null, session: null };
    const viewer = await loadViewer(env, viewerId);
    return { viewer, cookie, session };
  } finally {
    addAuthMs(performance.now() - started);
  }
}
