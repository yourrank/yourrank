// Canonical Viewer Account → community Membership boundary.
// Passive reads and generic sign-in must never call createViewerMembership().

import { one } from "@yourrank/shared/db";
import { getPublicSite } from "./site.js";
import { resolveCustomDomain } from "./middleware/custom-domain.js";
import { PLATFORM_HOST } from "./constants.js";

// Matches the canonical slugify() output, including a possible trailing hyphen
// when a longer generated slug is truncated at the 40-character boundary.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

function normalizedSlug(value) {
  const slug = String(value || "").trim().toLowerCase();
  return SLUG_RE.test(slug) ? slug : "";
}

function isPlatformHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === PLATFORM_HOST || host.endsWith(`.${PLATFORM_HOST}`);
}

export function requestIsSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

/** Resolve a public, accessible community and bind custom-domain requests to it. */
export async function resolveJoinableCommunity(request, env, rawSlug, deps = {}) {
  const getPublicSiteImpl = deps.getPublicSite || getPublicSite;
  const resolveCustomDomainImpl = deps.resolveCustomDomain || resolveCustomDomain;
  const slug = normalizedSlug(rawSlug);
  if (!slug) return null;

  const url = new URL(request.url);
  if (!isPlatformHost(url.hostname)) {
    const domainSlug = await resolveCustomDomainImpl(env, url.hostname);
    if (normalizedSlug(domainSlug) !== slug) return null;
  }

  const site = await getPublicSiteImpl(env, slug, request);
  if (!site || site.requiresPassword || site.suspended || site.pendingVerification) return null;
  if (!site.id || site.data?.siteSections?.me === false) return null;
  return { id: site.id, slug };
}

/** Idempotently create the one canonical site_viewers row without activity marks. */
export async function createViewerMembership(siteId, viewerId, { oneImpl = one } = {}) {
  return oneImpl(
    `WITH inserted AS (
       INSERT INTO site_viewers (site_id, viewer_id, balance, total_earned, total_spent)
       VALUES ($1, $2, 0, 0, 0)
       ON CONFLICT (site_id, viewer_id) DO NOTHING
       RETURNING id, balance, true AS created
     )
     SELECT id, balance, created FROM inserted
     UNION ALL
     SELECT sv.id, sv.balance, false AS created
       FROM site_viewers sv
      WHERE sv.site_id=$1 AND sv.viewer_id=$2
        AND NOT EXISTS (SELECT 1 FROM inserted)
     LIMIT 1`,
    [siteId, viewerId],
  );
}

/** Apply only an explicit, state-bound OAuth Join intent. Generic OAuth is a no-op. */
export async function applyOAuthJoinIntent(viewerId, stateData, { oneImpl = one } = {}) {
  if (stateData?.intent !== "join") return { attempted: false, membership: null };
  const siteId = String(stateData.joinSiteId || "").trim();
  const slug = normalizedSlug(stateData.joinSiteSlug);
  if (!siteId || !slug) return { attempted: true, membership: null };

  const target = await oneImpl(
    `SELECT s.id, s.slug
       FROM sites s
       JOIN users u ON u.id=s.user_id
      WHERE s.id=$1 AND s.slug=$2
        AND s.published=true AND s.is_draft=false
        AND s.credits_enabled=true
        AND u.status != 'suspended' AND u.email_verified=true`,
    [siteId, slug],
  );
  if (!target) return { attempted: true, membership: null };
  const membership = await createViewerMembership(target.id, viewerId, { oneImpl });
  return { attempted: true, membership };
}
