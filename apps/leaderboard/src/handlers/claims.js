// Canonical Claims adapter.
//
// Wave G has one proven safe fulfillment lifecycle: Rewards shop redemptions.
// Claims therefore adapts the existing redemptions/site_viewers/shop_items
// records instead of introducing a second persistence source. Fulfillment
// private data is intentionally absent until a real workflow requires it.
import { one, query, withTransaction } from "@yourrank/shared/db";
import { rateLimit } from "@yourrank/shared/ratelimit";
import { requireUser, bad, json, readJson } from "../auth.js";
import { getByUser, getBoardById } from "../site.js";
import { requireSiteCapability } from "../site-authorization.js";
import { routeContext } from "../middleware/handler.js";
import { requireViewer } from "./viewer-auth.js";
import {
  CLAIM_SOURCE_PREFIX,
  transitionRedemptionClaimStatus,
} from "./credits.js";

const CLAIM_LIMIT = 100;
const PRIVATE_CACHE = "no-store, no-cache, must-revalidate";
const CREATOR_FILTERS = new Set(["action_required", "submitted", "completed", "cancelled", "all"]);
const VIEWER_FILTERS = new Set(["submitted", "completed", "cancelled", "all"]);

const claimsDefaults = {
  one,
  query,
  withTransaction,
  rateLimit,
  requireUser,
  requireViewer,
  getByUser,
  getBoardById,
  requireSiteCapability,
  transitionRedemptionClaimStatus,
};

function privateResponse(response) {
  if (!response) return response;
  const headers = new Headers(response.headers);
  headers.set("cache-control", PRIVATE_CACHE);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const privateOk = (data) => json(
  { ok: true, ...data },
  200,
  { "cache-control": PRIVATE_CACHE },
);

const privateBad = (message, status = 400) => bad(
  message,
  status,
  { "cache-control": PRIVATE_CACHE },
);

function getSite(env, user, url, deps) {
  const siteId = url.searchParams.get("siteId");
  return siteId ? deps.getBoardById(env, user.id, siteId) : deps.getByUser(env, user.id);
}

function claimIdFromRequest(request) {
  const contextId = routeContext(request).slug;
  if (contextId) return contextId;
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const claimsIndex = parts.indexOf("claims");
  if (claimsIndex < 0 || !parts[claimsIndex + 1]) return "";
  try {
    return decodeURIComponent(parts[claimsIndex + 1]);
  } catch {
    return "";
  }
}

function sourceIdFromClaimId(claimId) {
  const value = String(claimId || "");
  if (!value.startsWith(CLAIM_SOURCE_PREFIX)) return "";
  const sourceId = value.slice(CLAIM_SOURCE_PREFIX.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sourceId)
    ? sourceId
    : "";
}

function claimStatusFromRedemption(status) {
  if (status === "fulfilled") return { status: "completed", statusLabel: "Completed", actionRequired: false, terminal: true };
  if (status === "cancelled") return { status: "cancelled", statusLabel: "Cancelled", actionRequired: false, terminal: true };
  return { status: "submitted", statusLabel: "Needs fulfillment", actionRequired: true, terminal: false };
}

function claimSummary(row) {
  const state = claimStatusFromRedemption(row.source_status);
  return {
    id: `${CLAIM_SOURCE_PREFIX}${row.source_id}`,
    type: "reward_redemption",
    typeLabel: "Reward claim",
    status: state.status,
    statusLabel: state.statusLabel,
    actionRequired: state.actionRequired,
    terminal: state.terminal,
    allowedActions: state.actionRequired ? ["complete", "cancel"] : [],
    subject: {
      membershipId: row.site_viewer_id,
      displayName: row.display_name || "Member",
    },
    source: {
      kind: "redemption",
      id: row.source_id,
      workflow: "Rewards redemption",
      title: row.item_name || "Reward",
    },
    reward: {
      id: row.shop_item_id,
      name: row.item_name || "Reward",
      cost: Number(row.cost) || 0,
    },
    site: row.site_id ? {
      id: row.site_id,
      name: row.site_name || row.site_slug,
      slug: row.site_slug,
    } : undefined,
    submittedAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.source_status === "fulfilled" ? row.updated_at : null,
    cancelledAt: row.source_status === "cancelled" ? row.updated_at : null,
  };
}

function claimDetail(row) {
  return {
    ...claimSummary(row),
    fulfillmentDetails: {
      privateDataStored: false,
      fields: [],
      note: "No private fulfillment details are stored for reward claims yet.",
    },
    guidance: {
      owner: "Rewards redemptions",
      identity: "Viewer Account plus this site's membership record",
      cachePolicy: "Private API responses are marked no-store.",
    },
  };
}

const CLAIM_SELECT = `
  SELECT r.id AS source_id, r.status AS source_status, r.cost, r.created_at, r.updated_at,
         sv.id AS site_viewer_id,
         COALESCE(NULLIF(v.kick_username, ''), NULLIF(v.discord_username, ''), 'Member') AS display_name,
         i.id AS shop_item_id, i.name AS item_name,
         s.id AS site_id, s.slug AS site_slug, s.name AS site_name
    FROM redemptions r
    JOIN site_viewers sv ON sv.id = r.site_viewer_id
    JOIN viewers v ON v.id = sv.viewer_id
    JOIN shop_items i ON i.id = r.shop_item_id
    JOIN sites s ON s.id = sv.site_id`;

async function creatorAccess(request, env, deps) {
  const { user, res } = await deps.requireUser(request, env);
  if (res) return { res: privateResponse(res) };
  const site = await getSite(env, user, new URL(request.url), deps);
  if (!site) return { res: privateBad("no site", 404) };
  const authorization = await deps.requireSiteCapability(user, site, "canRoleManageClaims");
  if (authorization.res) return { res: privateResponse(authorization.res) };
  return { user, site, role: authorization.role, res: null };
}

function creatorFilter(url) {
  const value = String(url.searchParams.get("status") || "action_required").toLowerCase();
  return CREATOR_FILTERS.has(value) ? value : "";
}

function viewerFilter(url) {
  const value = String(url.searchParams.get("status") || "all").toLowerCase();
  return VIEWER_FILTERS.has(value) ? value : "";
}

export async function handleCreatorClaims(request, env, injected = {}) {
  const deps = { ...claimsDefaults, ...injected };
  const access = await creatorAccess(request, env, deps);
  if (access.res) return access.res;
  const { user, site } = access;
  if (!(await deps.rateLimit(env, `claims:list:${user.id}:${site.id}`, 60, 60)).ok) {
    return privateBad("Too many requests.", 429);
  }

  const filter = creatorFilter(new URL(request.url));
  if (!filter) return privateBad("Unsupported claims filter.");

  const rows = await deps.query(
    `${CLAIM_SELECT}
      WHERE sv.site_id=$1
        AND (
          $2 = 'all'
          OR ($2 IN ('action_required', 'submitted') AND r.status = 'pending')
          OR ($2 = 'completed' AND r.status = 'fulfilled')
          OR ($2 = 'cancelled' AND r.status = 'cancelled')
        )
      ORDER BY
        CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END,
        CASE WHEN r.status = 'pending' THEN r.created_at END ASC,
        CASE WHEN r.status != 'pending' THEN r.updated_at END DESC,
        r.id ASC
      LIMIT $3`,
    [site.id, filter, CLAIM_LIMIT],
  );

  const countRow = await deps.one(
    `SELECT
       count(*) FILTER (WHERE r.status = 'pending')::integer AS action_required,
       count(*) FILTER (WHERE r.status = 'fulfilled')::integer AS completed,
       count(*) FILTER (WHERE r.status = 'cancelled')::integer AS cancelled
       FROM redemptions r
       JOIN site_viewers sv ON sv.id = r.site_viewer_id
      WHERE sv.site_id=$1`,
    [site.id],
  );
  const counts = {
    actionRequired: Number(countRow?.action_required) || 0,
    submitted: Number(countRow?.action_required) || 0,
    completed: Number(countRow?.completed) || 0,
    cancelled: Number(countRow?.cancelled) || 0,
  };
  const selectedCount = filter === "all"
    ? counts.submitted + counts.completed + counts.cancelled
    : filter === "action_required"
      ? counts.actionRequired
      : counts[filter] || 0;

  return privateOk({
    site: { id: site.id, name: site.name || site.slug, slug: site.slug },
    filter,
    counts,
    limit: CLAIM_LIMIT,
    truncated: selectedCount > CLAIM_LIMIT,
    claims: (rows || []).map(claimSummary),
  });
}

async function loadCreatorClaim(siteId, sourceId, deps) {
  return deps.one(
    `${CLAIM_SELECT}
      WHERE sv.site_id=$1 AND r.id=$2`,
    [siteId, sourceId],
  );
}

async function loadClaimHistory(sourceId, submittedAt, deps) {
  const auditRows = await deps.query(
    `SELECT a.action, a.created_at, a.actor_id,
            COALESCE(NULLIF(u.display_name, ''), u.email::text) AS actor_name
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.entity_type='claim' AND a.entity_id=$1
        AND a.action IN ('claim_completed', 'claim_cancelled')
      ORDER BY a.created_at ASC, a.id ASC
      LIMIT 100`,
    [`${CLAIM_SOURCE_PREFIX}${sourceId}`],
  );

  const history = [{
    action: "claim_submitted",
    label: "Claim submitted",
    actor: null,
    createdAt: submittedAt,
  }];
  for (const row of auditRows || []) {
    history.push({
      action: row.action === "claim_completed" ? "claim_completed" : "claim_cancelled",
      label: row.action === "claim_completed" ? "Claim completed" : "Claim cancelled",
      actor: row.actor_id ? { type: "creator", id: row.actor_id, displayName: row.actor_name || "Team member" } : null,
      createdAt: row.created_at,
    });
  }
  return history.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

export async function handleCreatorClaimDetail(request, env, injected = {}) {
  const deps = { ...claimsDefaults, ...injected };
  const access = await creatorAccess(request, env, deps);
  if (access.res) return access.res;
  const { user, site } = access;
  if (!(await deps.rateLimit(env, `claims:detail:${user.id}:${site.id}`, 60, 60)).ok) {
    return privateBad("Too many requests.", 429);
  }

  const sourceId = sourceIdFromClaimId(claimIdFromRequest(request));
  if (!sourceId) return privateBad("Claim not found.", 404);
  const row = await loadCreatorClaim(site.id, sourceId, deps);
  if (!row) return privateBad("Claim not found.", 404);

  return privateOk({
    site: { id: site.id, name: site.name || site.slug, slug: site.slug },
    claim: {
      ...claimDetail(row),
      history: await loadClaimHistory(sourceId, row.created_at, deps),
    },
  });
}

export async function handleCreatorClaimTransition(request, env, injected = {}) {
  const deps = { ...claimsDefaults, ...injected };
  const access = await creatorAccess(request, env, deps);
  if (access.res) return access.res;
  const { user, site } = access;
  if (!(await deps.rateLimit(env, `claims:transition:${user.id}:${site.id}`, 30, 60)).ok) {
    return privateBad("Too many requests.", 429);
  }

  const sourceId = sourceIdFromClaimId(claimIdFromRequest(request));
  if (!sourceId) return privateBad("Claim not found.", 404);
  const body = await readJson(request);
  const fields = body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body) : [];
  const validFields = fields.every((field) => field === "action" || field === "expectedStatus");
  const action = validFields ? String(body.action || "").trim().toLowerCase() : "";
  const expectedStatus = validFields ? String(body.expectedStatus || "").trim().toLowerCase() : "";
  if (!validFields || (action !== "complete" && action !== "cancel")) {
    return privateBad("Action must be complete or cancel.");
  }
  if (expectedStatus && expectedStatus !== "submitted") {
    return privateBad("Expected status must be submitted.");
  }

  const nextStatus = action === "complete" ? "fulfilled" : "cancelled";
  const result = await deps.withTransaction((tx) => deps.transitionRedemptionClaimStatus(tx, {
    siteId: site.id,
    userId: user.id,
    sourceId,
    nextStatus,
  }));
  if (result.error) return privateBad(result.error, result.status);

  const row = await loadCreatorClaim(site.id, sourceId, deps);
  return privateOk({
    replayed: result.replayed,
    claim: row ? claimSummary(row) : {
      id: `${CLAIM_SOURCE_PREFIX}${sourceId}`,
      status: claimStatusFromRedemption(nextStatus).status,
      statusLabel: claimStatusFromRedemption(nextStatus).statusLabel,
    },
  });
}

export async function handleViewerClaims(request, env, injected = {}) {
  const deps = { ...claimsDefaults, ...injected };
  const { viewer, res } = await deps.requireViewer(request, env);
  if (res) return privateResponse(res);
  if (!(await deps.rateLimit(env, `viewer:claims:${viewer.id}`, 60, 60)).ok) {
    return privateBad("Too many requests.", 429);
  }

  const url = new URL(request.url);
  const filter = viewerFilter(url);
  if (!filter) return privateBad("Unsupported claims filter.");
  const slug = String(url.searchParams.get("slug") || "").trim();

  const rows = await deps.query(
    `${CLAIM_SELECT}
     JOIN users u ON u.id = s.user_id
      WHERE sv.viewer_id=$1
        AND s.published = true
        AND s.is_draft = false
        AND u.status != 'suspended'
        AND u.email_verified = true
        AND ($2 = '' OR s.slug = $2)
        AND (
          $3 = 'all'
          OR ($3 = 'submitted' AND r.status = 'pending')
          OR ($3 = 'completed' AND r.status = 'fulfilled')
          OR ($3 = 'cancelled' AND r.status = 'cancelled')
        )
      ORDER BY r.created_at DESC
      LIMIT $4`,
    [viewer.id, slug, filter, CLAIM_LIMIT],
  );

  return privateOk({
    viewer: { id: viewer.id },
    filter,
    claims: (rows || []).map(claimSummary),
  });
}

async function loadViewerClaim(viewerId, sourceId, deps) {
  return deps.one(
    `${CLAIM_SELECT}
     JOIN users u ON u.id = s.user_id
      WHERE sv.viewer_id=$1
        AND r.id=$2
        AND s.published = true
        AND s.is_draft = false
        AND u.status != 'suspended'
        AND u.email_verified = true`,
    [viewerId, sourceId],
  );
}

export async function handleViewerClaimDetail(request, env, injected = {}) {
  const deps = { ...claimsDefaults, ...injected };
  const { viewer, res } = await deps.requireViewer(request, env);
  if (res) return privateResponse(res);
  if (!(await deps.rateLimit(env, `viewer:claim:${viewer.id}`, 60, 60)).ok) {
    return privateBad("Too many requests.", 429);
  }

  const sourceId = sourceIdFromClaimId(claimIdFromRequest(request));
  if (!sourceId) return privateBad("Claim not found.", 404);
  const row = await loadViewerClaim(viewer.id, sourceId, deps);
  if (!row) return privateBad("Claim not found.", 404);

  return privateOk({
    viewer: { id: viewer.id },
    claim: {
      ...claimDetail(row),
      history: await loadClaimHistory(sourceId, row.created_at, deps),
    },
  });
}
