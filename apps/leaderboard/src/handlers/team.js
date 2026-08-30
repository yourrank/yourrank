// ============================================================================
//  YourRank — TEAM & MODERATOR HANDLERS
//
//  API endpoints for inviting, managing, and accepting V1 Moderator access
// ============================================================================

import { requireUser, json, readJson, rateLimit, rateLimitHeaders, clientIp } from "../auth.js";
import { getSiteById } from "../site.js";
import { one as defaultOne } from "@yourrank/shared/db";
import {
  getSiteRole,
  canRoleManageTeam,
  listSiteMembers,
  listSiteInvites,
  getOperatorSeatUsage,
  createSiteInvite,
  revokeSiteInvite,
  removeSiteMember,
  getInviteByToken,
  acceptSiteInvite,
} from "@yourrank/shared/team";
import { PLATFORM_HOST } from "../constants.js";

function getDeps(overrides = {}) {
  const deps = {
    requireUser,
    getSiteById,
    one: defaultOne,
    getSiteRole,
    listSiteMembers,
    listSiteInvites,
    getOperatorSeatUsage,
    createSiteInvite,
    revokeSiteInvite,
    removeSiteMember,
    getInviteByToken,
    acceptSiteInvite,
    rateLimit,
    rateLimitHeaders,
    clientIp,
    ...overrides,
  };
  if (!overrides.getTeamSiteByUser) {
    deps.getTeamSiteByUser = (env, userId) => getTeamSiteByUser(env, userId, deps.one);
  }
  return deps;
}

const PRIVATE_CACHE = "no-store, no-cache, must-revalidate";
const privateJson = (data, status = 200, headers = {}) => json(
  data,
  status,
  { "cache-control": PRIVATE_CACHE, ...headers },
);
const privateBad = (message, status = 400, code = undefined, headers = {}) => privateJson(
  { ok: false, error: message, ...(code ? { code } : {}) },
  status,
  headers,
);
const privateResponse = (response) => {
  const headers = new Headers(response.headers);
  headers.set("cache-control", PRIVATE_CACHE);
  return new Response(response.body, { status: response.status, headers });
};

async function getTeamSiteByUser(env, userId, one) {
  // Same board the rest of the dashboard defaults to: the active one.
  const owned = await one(
    `SELECT id FROM sites WHERE user_id=$1
      ORDER BY CASE WHEN id=(SELECT active_site_id FROM users WHERE id=$1) THEN 0 ELSE 1 END, id ASC
      LIMIT 1`,
    [userId],
  );
  if (owned) return owned;
  return one(
    `SELECT s.id
       FROM sites s
       JOIN site_members sm ON sm.site_id=s.id
       JOIN users owner ON owner.id=s.user_id
      WHERE sm.user_id=$1
        AND sm.role='moderator'
        AND lower(owner.plan)='team'
        AND owner.status IS DISTINCT FROM 'suspended'
        AND owner.plan_expires_at > now()
      ORDER BY sm.created_at ASC, s.id ASC
      LIMIT 1`,
    [userId],
  );
}

async function resolveTeamSite(env, user, siteId, deps) {
  const site = siteId
    ? await deps.getSiteById(env, siteId)
    : await deps.getTeamSiteByUser(env, user.id);
  if (!site) return null;
  const role = await deps.getSiteRole(site.id, user.id);
  return role ? { site, role } : null;
}

/**
 * GET /api/site/team?siteId=...
 * List members and pending invites for a site.
 */
export async function handleTeamList(request, env, overrides) {
  const deps = getDeps(overrides);
  const { user, res } = await deps.requireUser(request, env);
  if (res) return privateResponse(res);

  const url = new URL(request.url);
  const siteId = url.searchParams.get("siteId");
  const resolved = await resolveTeamSite(env, user, siteId, deps);
  if (!resolved) return privateBad("Site not found", 404);
  const { site, role } = resolved;

  const [members, invites, seats] = await Promise.all([
    deps.listSiteMembers(site.id),
    role === "owner" ? deps.listSiteInvites(site.id) : Promise.resolve([]),
    deps.getOperatorSeatUsage(site.id),
  ]);
  const visibleMembers = members.map((member) => ({
    ...member,
    accessStatus: member.role === "owner" || seats?.plan === "team" ? "active" : "paused",
  }));

  return privateJson({
    ok: true,
    siteId: site.id,
    currentRole: role,
    canManageTeam: canRoleManageTeam(role),
    members: visibleMembers,
    invites,
    seats,
  });
}

/**
 * POST /api/site/team/invite
 * Send or generate a Moderator invite.
 */
export async function handleTeamInvite(request, env, overrides) {
  const deps = getDeps(overrides);
  const { user, res } = await deps.requireUser(request, env);
  if (res) return privateResponse(res);

  const rl = await deps.rateLimit(env, `team-invite:${user.id}`, 20, 3600);
  if (!rl.ok) return privateBad("Too many invitations sent. Please wait.", 429, "rate_limited", deps.rateLimitHeaders(rl));

  const body = await readJson(request);
  if (!body) return privateBad("Invalid JSON payload", 400);

  const { siteId, email, role = "moderator" } = body;
  if (!siteId || typeof siteId !== "string") return privateBad("siteId is required.");
  if (!email || typeof email !== "string") return privateBad("A valid email address is required.", 400);

  const resolved = await resolveTeamSite(env, user, siteId, deps);
  if (!resolved) return privateBad("Site not found", 404);
  const { site, role: requesterRole } = resolved;
  if (!canRoleManageTeam(requesterRole)) return privateBad("Only the site owner can invite team members.", 403, "forbidden");

  const result = await deps.createSiteInvite(site.id, user.id, email, role);
  if (!result.ok) {
    const status = ["forbidden", "requires_team", "seat_limit"].includes(result.code) ? 403 : 400;
    return privateBad(result.error || "Failed to create invitation.", status, result.code);
  }

  return privateJson({
    ok: true,
    inviteId: result.inviteId,
    inviteUrl: `https://${PLATFORM_HOST}/invite/${result.token}`,
    message: `Moderator invitation generated for ${email}.`,
  });
}

/**
 * POST /api/site/team/invite/revoke
 * Cancel an active invitation.
 */
export async function handleTeamRevokeInvite(request, env, overrides) {
  const deps = getDeps(overrides);
  const { user, res } = await deps.requireUser(request, env);
  if (res) return privateResponse(res);

  const body = await readJson(request);
  if (!body?.inviteId || !body?.siteId) return privateBad("Missing inviteId or siteId", 400);

  const resolved = await resolveTeamSite(env, user, body.siteId, deps);
  if (!resolved) return privateBad("Site not found", 404);
  const { site, role: requesterRole } = resolved;
  if (!canRoleManageTeam(requesterRole)) return privateBad("Only the site owner can revoke invitations.", 403, "forbidden");

  const result = await deps.revokeSiteInvite(site.id, body.inviteId, user.id);
  if (!result.ok) return privateBad(result.error || "Failed to revoke invitation", result.code === "forbidden" ? 403 : 400, result.code);

  return privateJson({ ok: true });
}

/**
 * POST /api/site/team/remove
 * Remove a member from the site.
 */
export async function handleTeamRemoveMember(request, env, overrides) {
  const deps = getDeps(overrides);
  const { user, res } = await deps.requireUser(request, env);
  if (res) return privateResponse(res);

  const body = await readJson(request);
  if (!body?.siteId || !body?.targetUserId) return privateBad("Missing siteId or targetUserId", 400);

  const resolved = await resolveTeamSite(env, user, body.siteId, deps);
  if (!resolved) return privateBad("Site not found", 404);
  const { site, role: requesterRole } = resolved;
  if (requesterRole !== "owner" && user.id !== body.targetUserId) {
    return privateBad("Only the site owner can remove team members.", 403, "forbidden");
  }

  const result = await deps.removeSiteMember(site.id, body.targetUserId, user.id);
  if (!result.ok) return privateBad(result.error || "Failed to remove member", result.code === "forbidden" ? 403 : 400, result.code);

  return privateJson({ ok: true });
}

/**
 * POST /api/site/team/accept-invite
 * Accept an invite for the current user.
 */
export async function handleTeamAcceptInvite(request, env, overrides) {
  const deps = getDeps(overrides);
  const { user, res } = await deps.requireUser(request, env);
  if (res) return privateResponse(res);

  const body = await readJson(request);
  const token = body?.token;
  if (!token) return privateBad("Invite token is required", 400);

  const result = await deps.acceptSiteInvite(token, user.id);
  if (!result.ok) {
    return privateBad(result.error || "Unable to accept invite", 400, result.code);
  }

  return privateJson({
    ok: true,
    siteId: result.siteId,
    role: result.role,
    message: "You have joined the team!",
  });
}

/**
 * GET /api/site/team/invite-info?token=...
 * Fetch public metadata about an invite.
 */
export async function handleGetInviteInfo(request, env, overrides) {
  const deps = getDeps(overrides);
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const rl = await deps.rateLimit(env, `team-invite-info:${deps.clientIp(request)}`, 30, 900);
  if (!rl.ok) return privateBad("Invitation is not available.", 404, undefined, deps.rateLimitHeaders(rl));
  if (!token) return privateBad("Invitation is not available.", 404, undefined, deps.rateLimitHeaders(rl));

  const invite = await deps.getInviteByToken(token);
  if (!invite) return privateBad("Invitation is not available.", 404, undefined, deps.rateLimitHeaders(rl));

  const isExpired = new Date(invite.expiresAt).getTime() < Date.now();
  if (isExpired || invite.status !== "pending") {
    return privateBad("Invitation is not available.", 404, undefined, deps.rateLimitHeaders(rl));
  }

  return privateJson({
    ok: true,
    siteName: invite.siteName,
    siteSlug: invite.siteSlug,
    ownerName: invite.ownerName,
    role: invite.role,
    status: "pending",
    expiresAt: invite.expiresAt,
  }, 200, deps.rateLimitHeaders(rl));
}
