// Creator-facing People API.
//
// `site_viewers` is the current viewer-to-site membership record. It remains
// separate from operator `site_members`, leaderboard players, and Telegram
// subscribers. A linked identity is reported only when the viewer completed
// that provider's authenticated OAuth flow (`*_linked_at`); matching names or
// raw platform IDs never create a link here.
import { query, one } from "@yourrank/shared/db";
import { requireUser, bad, json } from "../auth.js";
import { getByUser, getBoardById } from "../site.js";
import { requireSiteCapability } from "../site-authorization.js";
import { rateLimit } from "@yourrank/shared/ratelimit";
import { routeContext } from "../middleware/handler.js";

const peopleDefaults = {
  query,
  one,
  requireUser,
  getByUser,
  getBoardById,
  requireSiteCapability,
  rateLimit,
};

const privateOk = (data) => json(
  { ok: true, ...data },
  200,
  { "cache-control": "no-store, no-cache, must-revalidate" },
);

function displayName(row) {
  return row.kick_username || row.discord_username || "Unnamed member";
}

function linkedIdentities(row) {
  const identities = [];
  if (row.kick_linked_at) {
    identities.push({ provider: "Kick", displayName: row.kick_username || null });
  }
  if (row.discord_linked_at) {
    identities.push({ provider: "Discord", displayName: row.discord_username || null });
  }
  return identities;
}

function memberSummary(row) {
  return {
    id: row.id,
    displayName: displayName(row),
    avatarUrl: row.avatar_url || null,
    lastSeenAt: row.last_seen_at || null,
    lastCreditAt: row.last_earned_at || null,
    balance: Number(row.balance) || 0,
    totalEarned: Number(row.total_earned) || 0,
    totalSpent: Number(row.total_spent) || 0,
    blocked: row.blocked === true,
    linkedIdentities: linkedIdentities(row),
  };
}

async function resolvePeopleSite(request, env, user, deps) {
  const url = new URL(request.url);
  const siteId = String(url.searchParams.get("siteId") || "").trim();
  return siteId
    ? deps.getBoardById(env, user.id, siteId)
    : deps.getByUser(env, user.id);
}

export async function requirePeopleAccess(request, env, deps) {
  const { user, res } = await deps.requireUser(request, env);
  if (res) return { res };
  const site = await resolvePeopleSite(request, env, user, deps);
  if (!site) return { res: bad("Site not found.", 404) };
  const authorization = await deps.requireSiteCapability(
    user,
    site,
    "canRoleViewMembers",
  );
  if (authorization.res) return { res: authorization.res };
  return { user, site };
}

export async function handlePeopleMembers(request, env, injected = {}) {
  const deps = { ...peopleDefaults, ...injected };
  const access = await requirePeopleAccess(request, env, deps);
  if (access.res) return access.res;
  const { user, site } = access;
  if (!(await deps.rateLimit(env, `people:members:${user.id}:${site.id}`, 60, 60)).ok) {
    return bad("Too many requests.", 429);
  }

  const rows = await deps.query(
    `SELECT sv.id, sv.balance, sv.total_earned, sv.total_spent, sv.blocked,
            sv.last_earned_at, sv.last_seen_at, sv.created_at,
            v.kick_username, v.discord_username, v.avatar_url,
            v.kick_linked_at, v.discord_linked_at
       FROM site_viewers sv
       JOIN viewers v ON v.id = sv.viewer_id
      WHERE sv.site_id=$1
      ORDER BY COALESCE(sv.last_seen_at, sv.last_earned_at, sv.created_at) DESC,
               sv.created_at DESC
      LIMIT 100`,
    [site.id],
  );

  return privateOk({
    site: { id: site.id, name: site.name || site.slug, slug: site.slug },
    members: (rows || []).map(memberSummary),
  });
}

const CREDIT_DIRECTIONS = Object.freeze({
  earn: "credit",
  revoke: "credit",
  spend: "debit",
  redeem: "debit",
  refund: "debit",
});

export async function handlePeopleMemberDetail(request, env, injected = {}) {
  const deps = { ...peopleDefaults, ...injected };
  const access = await requirePeopleAccess(request, env, deps);
  if (access.res) return access.res;
  const { user, site } = access;
  if (!(await deps.rateLimit(env, `people:member:${user.id}:${site.id}`, 60, 60)).ok) {
    return bad("Too many requests.", 429);
  }

  const url = new URL(request.url);
  const memberId = routeContext(request).slug || url.pathname.split("/").filter(Boolean).pop();
  if (!memberId || memberId === "members") return bad("Member is required.");

  const row = await deps.one(
    `SELECT sv.id, sv.balance, sv.total_earned, sv.total_spent, sv.blocked,
            sv.block_reason, sv.last_earned_at, sv.last_seen_at,
            v.kick_username, v.discord_username, v.avatar_url,
            v.kick_linked_at, v.discord_linked_at
       FROM site_viewers sv
       JOIN viewers v ON v.id = sv.viewer_id
      WHERE sv.site_id=$1 AND sv.id=$2`,
    [site.id, memberId],
  );
  if (!row) return bad("Member not found.", 404);

  const activityRows = await deps.query(
    `SELECT id, type, amount, description, created_at
       FROM credit_ledger
      WHERE site_viewer_id=$1
      ORDER BY created_at DESC, id DESC
      LIMIT 25`,
    [row.id],
  );

  return privateOk({
    site: { id: site.id, name: site.name || site.slug, slug: site.slug },
    member: {
      ...memberSummary(row),
      moderation: {
        status: row.blocked === true ? "blocked" : "active",
        reason: row.blocked === true ? row.block_reason || null : null,
      },
      recentCreditActivity: (activityRows || []).map((event) => ({
        id: event.id,
        type: event.type,
        amount: Number(event.amount) || 0,
        direction: CREDIT_DIRECTIONS[event.type] || null,
        description: event.description || "",
        createdAt: event.created_at,
      })),
    },
  });
}
