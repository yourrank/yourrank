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
import { linkedViewerIdentities, viewerDisplayName, viewerIdentitiesSql } from "@yourrank/shared/viewer-identity";
import { routeContext } from "../middleware/handler.js";
import { likePattern, pageMeta, readListCursor, readListLimit, readListSearch } from "../list-cursor.js";

const MEMBER_PAGE = 25;
const MEMBER_PAGE_MAX = 100;
const MEMBER_SORTS = new Set(["activity", "balance", "status"]);

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
  return viewerDisplayName(row, "Unnamed member");
}

function linkedIdentities(row) {
  return linkedViewerIdentities(row).map((identity) => ({
    provider: identity.label,
    displayName: identity.username,
  }));
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

  const url = new URL(request.url);
  const { cursor, valid: cursorValid } = readListCursor(url);
  if (!cursorValid) return bad("Invalid members cursor. Refresh the list.");
  const limit = readListLimit(url, { fallback: MEMBER_PAGE, max: MEMBER_PAGE_MAX });
  const search = readListSearch(url);
  const sortParam = String(url.searchParams.get("sort") || "activity");
  if (!MEMBER_SORTS.has(sortParam)) return bad("Unsupported members sort.");

  // Every sort collapses to one descending numeric key plus created_at/id tie
  // breakers so the keyset cursor works identically for each mode.
  const rows = await deps.query(
    `WITH ranked AS (
      SELECT sv.id, sv.balance, sv.total_earned, sv.total_spent, sv.blocked,
             sv.last_earned_at, sv.last_seen_at, sv.created_at,
             v.avatar_url, ${viewerIdentitiesSql("v")} AS identities,
             (CASE $3::text
                WHEN 'balance' THEN sv.balance::double precision
                WHEN 'status' THEN (CASE WHEN sv.blocked THEN 1 ELSE 0 END)::double precision
                ELSE extract(epoch FROM COALESCE(sv.last_seen_at, sv.last_earned_at, sv.created_at))
              END) AS sort_key
        FROM site_viewers sv
        JOIN viewers v ON v.id = sv.viewer_id
       WHERE sv.site_id=$1
         AND ($2 = '' OR EXISTS (
               SELECT 1 FROM viewer_identities vi
                WHERE vi.viewer_id = v.id AND vi.status = 'active'
                  AND vi.username ILIKE '%' || $2 || '%' ESCAPE '\\')
             OR v.kick_username ILIKE '%' || $2 || '%' ESCAPE '\\'
             OR v.discord_username ILIKE '%' || $2 || '%' ESCAPE '\\')
    )
    SELECT * FROM ranked m
     WHERE ($4::uuid IS NULL OR (m.sort_key, m.created_at, m.id) < (
             SELECT a.sort_key, a.created_at, a.id FROM ranked a WHERE a.id = $4::uuid))
     ORDER BY m.sort_key DESC, m.created_at DESC, m.id DESC
     LIMIT $5`,
    [site.id, likePattern(search), sortParam, cursor, limit + 1],
  );
  const { items, page } = pageMeta(rows || [], limit, (row) => row.id);
  const totalRow = search
    ? null
    : await deps.one(`SELECT count(*)::integer AS total FROM site_viewers WHERE site_id=$1`, [site.id]);

  return privateOk({
    site: { id: site.id, name: site.name || site.slug, slug: site.slug },
    search,
    sort: sortParam,
    total: totalRow ? Number(totalRow.total) || 0 : null,
    page,
    members: items.map(memberSummary),
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
            v.avatar_url, ${viewerIdentitiesSql("v")} AS identities
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
