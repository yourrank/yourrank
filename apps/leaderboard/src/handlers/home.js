import { queryWithTimeout } from "@yourrank/shared/db";
import { rateLimit } from "@yourrank/shared/ratelimit";
import { requireUser, bad, json } from "../auth.js";
import { getByUser, getBoardById } from "../site.js";
import { requireSiteCapability } from "../site-authorization.js";

const PRIVATE_CACHE = "no-store, no-cache, must-revalidate";
// Home shows a bounded preview of the newest creator-readable events for the
// selected site. It is not a feed: Audience → Activity and Insights own the
// complete, paginated views.
export const HOME_ACTIVITY_LIMIT = 8;

const defaults = {
  requireUser,
  getByUser,
  getBoardById,
  requireSiteCapability,
  rateLimit,
  activityQuery: (sql, params) => queryWithTimeout(sql, params, 5000),
};

const privateBad = (message, status = 400) => bad(message, status, { "cache-control": PRIVATE_CACHE });

function privateResponse(response) {
  if (!response) return response;
  const headers = new Headers(response.headers);
  headers.set("cache-control", PRIVATE_CACHE);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// One UNION over the site-scoped event sources; each branch is already sorted
// and capped so the outer sort never touches more than 5 × limit rows.
const HOME_EVENTS_SQL = `
  WITH member_joined AS (
    SELECT 'member_joined' AS kind, sv.created_at AS at,
           COALESCE(NULLIF(v.kick_username, ''), NULLIF(v.discord_username, ''), 'A member') AS actor,
           NULL::text AS subject, NULL::text AS status
      FROM site_viewers sv JOIN viewers v ON v.id = sv.viewer_id
     WHERE sv.site_id = $1 AND v.is_system = FALSE
     ORDER BY sv.created_at DESC LIMIT $2
  ), claim_submitted AS (
    SELECT 'claim' AS kind, r.created_at AS at,
           COALESCE(NULLIF(v.kick_username, ''), NULLIF(v.discord_username, ''), 'A member') AS actor,
           i.name AS subject, r.status AS status
      FROM redemptions r
      JOIN site_viewers sv ON sv.id = r.site_viewer_id
      JOIN viewers v ON v.id = sv.viewer_id
      JOIN shop_items i ON i.id = r.shop_item_id
     WHERE sv.site_id = $1 AND v.is_system = FALSE
     ORDER BY r.created_at DESC LIMIT $2
  ), drop_claimed AS (
    SELECT 'drop_claimed' AS kind, c.created_at AS at,
           COALESCE(NULLIF(v.kick_username, ''), NULLIF(v.discord_username, ''), 'A member') AS actor,
           NULL::text AS subject, c.points_awarded::text AS status
      FROM code_drop_claims c
      JOIN code_drops d ON d.id = c.code_drop_id
      JOIN viewers v ON v.id = c.viewer_id
     WHERE d.site_id = $1 AND v.is_system = FALSE
     ORDER BY c.created_at DESC LIMIT $2
  ), drop_ended AS (
    SELECT 'drop_ended' AS kind, ended.at, NULL::text AS actor,
           ended.claimed_count::text AS subject, ended.status AS status
      FROM (
        SELECT d.claimed_count, d.status,
               COALESCE(d.closed_at, CASE WHEN d.status = 'expired' THEN d.expires_at ELSE d.updated_at END) AS at
          FROM code_drops d
         WHERE d.site_id = $1 AND d.status IN ('expired', 'exhausted')
      ) ended
     WHERE ended.at IS NOT NULL AND ended.at <= now()
     ORDER BY ended.at DESC LIMIT $2
  ), giveaway_drawn AS (
    SELECT 'giveaway_drawn' AS kind, g.drawn_at AS at, e.username AS actor,
           g.keyword AS subject, g.status AS status
      FROM chat_giveaway_sessions g
      LEFT JOIN chat_giveaway_entries e ON e.id = g.winner_entry_id
     WHERE g.site_id = $1 AND g.drawn_at IS NOT NULL
     ORDER BY g.drawn_at DESC LIMIT $2
  )
  SELECT * FROM (
    SELECT * FROM member_joined
    UNION ALL SELECT * FROM claim_submitted
    UNION ALL SELECT * FROM drop_claimed
    UNION ALL SELECT * FROM drop_ended
    UNION ALL SELECT * FROM giveaway_drawn
  ) events
  ORDER BY at DESC
  LIMIT $3`;

// Creator-readable copy for one raw event row. Anything the UI does not need
// (ids, provider ids, codes) never leaves the Worker.
export function normalizeHomeEvent(row) {
  if (!row?.at) return null;
  const at = new Date(row.at);
  if (Number.isNaN(at.getTime())) return null;
  const actor = row.actor || "A member";
  switch (row.kind) {
    case "member_joined":
      return { kind: "member_joined", at: at.toISOString(), title: actor, detail: "Joined your community" };
    case "claim": {
      const item = row.subject || "a reward";
      const detail = row.status === "fulfilled" ? `Claim for ${item} completed`
        : row.status === "cancelled" ? `Claim for ${item} cancelled`
          : `Claimed ${item} · waiting for you`;
      return { kind: "claim", at: at.toISOString(), title: actor, detail };
    }
    case "drop_claimed": {
      const credits = Number(row.status) || 0;
      return { kind: "drop_claimed", at: at.toISOString(), title: actor, detail: credits > 0 ? `Claimed a code drop · ${credits.toLocaleString("en-US")} credits` : "Claimed a code drop" };
    }
    case "drop_ended": {
      const claims = Number(row.subject) || 0;
      return { kind: "drop_ended", at: at.toISOString(), title: "Code drop ended", detail: `${claims.toLocaleString("en-US")} ${claims === 1 ? "claim" : "claims"}` };
    }
    case "giveaway_drawn":
      return {
        kind: "giveaway_drawn",
        at: at.toISOString(),
        title: "Giveaway winner drawn",
        detail: row.actor
          ? `${row.actor} won${row.subject ? ` the “${row.subject}” giveaway` : ""}`
          : "Winner drawn",
      };
    default:
      return null;
  }
}

export async function handleHomeActivity(request, env, injected = {}) {
  const deps = { ...defaults, ...injected };
  const { user, res } = await deps.requireUser(request, env);
  if (res) return privateResponse(res);

  const url = new URL(request.url);
  const siteId = String(url.searchParams.get("siteId") || "").trim();
  const site = siteId ? await deps.getBoardById(env, user.id, siteId) : await deps.getByUser(env, user.id);
  if (!site) return privateBad("Site not found.", 404);
  const authorization = await deps.requireSiteCapability(user, site, "canRoleViewMembers");
  if (authorization.res) return privateResponse(authorization.res);
  if (!(await deps.rateLimit(env, `home:activity:${user.id}:${site.id}`, 60, 60)).ok) {
    return privateBad("Too many requests.", 429);
  }

  // One extra row tells the client whether older events exist without a count.
  const rows = await deps.activityQuery(HOME_EVENTS_SQL, [site.id, HOME_ACTIVITY_LIMIT, HOME_ACTIVITY_LIMIT + 1]);
  const normalized = (rows || []).map(normalizeHomeEvent).filter(Boolean);
  const events = normalized.slice(0, HOME_ACTIVITY_LIMIT);
  return json({
    ok: true,
    site: { id: site.id, name: site.name || site.slug, slug: site.slug },
    limit: HOME_ACTIVITY_LIMIT,
    truncated: normalized.length > HOME_ACTIVITY_LIMIT,
    events,
  }, 200, { "cache-control": PRIVATE_CACHE });
}
