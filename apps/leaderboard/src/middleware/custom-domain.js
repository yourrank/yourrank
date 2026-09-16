// Custom domain resolution with in-memory caching
// Maps custom domain hostnames to site slugs for serving leaderboards on custom domains
import { one, withTransaction } from "@yourrank/shared/db";
import { PLATFORM_HOST } from "../constants.js";

// Per-isolate L1 cache. Invalidation (invalidateCustomDomain) only clears the
// current isolate; other live isolates keep a stale mapping until the 60s TTL
// expires. That bound is acceptable for domain routing.
const CUSTOM_DOMAIN_CACHE = new Map();
const CUSTOM_DOMAIN_TTL = 60_000; // 60 seconds
const CUSTOM_DOMAIN_MAX = 1000;   // PERF-005: cap entries to prevent unbounded memory growth

function normalizedHost(host) {
  return String(host || "").trim().toLowerCase().replace(/\.$/, "");
}

export async function resolveCustomDomain(env, host) {
  const normalized = normalizedHost(host);
  const now = Date.now();
  const cached = CUSTOM_DOMAIN_CACHE.get(normalized);
  if (cached && cached.expires > now) return cached.slug;
  try {
    const row = await one("SELECT s.slug FROM sites s JOIN users u ON u.id = s.user_id WHERE lower(s.custom_domain)=$1 AND s.published=true AND s.is_draft=false AND u.status != 'suspended'", [normalized]);
    const slug = row?.slug || null;
    CUSTOM_DOMAIN_CACHE.set(normalized, { slug, expires: now + CUSTOM_DOMAIN_TTL });
    // PERF-005: FIFO eviction — delete oldest entries when cache exceeds max size
    while (CUSTOM_DOMAIN_CACHE.size > CUSTOM_DOMAIN_MAX) {
      const first = CUSTOM_DOMAIN_CACHE.keys().next().value;
      CUSTOM_DOMAIN_CACHE.delete(first);
    }
    return slug;
  } catch {
    // Public routing may tolerate a still-live cache entry, but never extend an
    // expired mapping during a database failure.
    return cached && cached.expires > now ? cached.slug : null;
  }
}

/**
 * Resolve authentication authority from current database evidence only.
 * This intentionally bypasses the public-routing cache and fails closed.
 */
export async function resolveVerifiedCustomDomain(env, host, { oneImpl = (text, params) => withTransaction((tx) => tx.one(text, params)) } = {}) {
  const normalized = normalizedHost(host);
  if (!normalized || !isCustomHost(normalized)) return null;
  try {
    return await oneImpl(
      `SELECT s.id AS site_id, s.slug, lower(s.custom_domain) AS hostname,
              s.domain_auth_binding_id AS binding_id
         FROM sites s
         JOIN users u ON u.id = s.user_id
        WHERE lower(s.custom_domain)=$1
          AND s.domain_status='active'
          AND s.custom_hostname_id IS NOT NULL
          AND s.domain_auth_binding_id IS NOT NULL
          AND s.domain_auth_verified_at IS NOT NULL
          AND s.published=true
          AND s.is_draft=false
          AND u.status != 'suspended'
          AND u.email_verified=true
        FOR SHARE OF s, u`,
      [normalized]
    );
  } catch {
    return null;
  }
}

// A shared CNAME or active TLS certificate alone does not establish which Site
// may claim the hostname. Require the owner to publish this Site's TXT challenge.
export async function verifyDomainOwnership(domain, challenge, { fetchImpl = fetch } = {}) {
  if (!domain || !challenge) return false;
  try {
    const response = await fetchImpl(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(`_yourrank.${domain}`)}&type=TXT`,
      { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(10000) }
    );
    if (!response.ok) return false;
    const result = await response.json();
    return result?.Status === 0 && Array.isArray(result.Answer) && result.Answer.some((answer) => {
      const name = String(answer.name || "").toLowerCase().replace(/\.$/, "");
      const value = String(answer.data || "").replace(/^"|"$/g, "");
      return answer.type === 16 && name === `_yourrank.${domain}` && value === `yourrank-verification=${challenge}`;
    });
  } catch { return false; }
}

export function verifiedProviderHostname(result, domain, id = result?.id) {
  return Boolean(id && result?.id === id && normalizedHost(result.hostname) === domain
    && result.status === "active" && result.ssl?.status === "active");
}

// Drop cached hostname→slug mappings after a domain is added, changed, or
// removed so the mutating isolate stops routing on the old value immediately.
export function invalidateCustomDomain(...hosts) {
  for (const host of hosts) {
    if (host) CUSTOM_DOMAIN_CACHE.delete(String(host).toLowerCase());
  }
}

export function isCustomHost(host) {
  return host !== PLATFORM_HOST && host !== "localhost" && host !== "127.0.0.1" && !host.endsWith(`.${PLATFORM_HOST}`);
}
