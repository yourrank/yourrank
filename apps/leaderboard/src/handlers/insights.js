import { queryWithTimeout, one } from "@yourrank/shared/db";
import { effectivePlan, HISTORY_DAYS } from "@yourrank/shared/plans";
import { rateLimit } from "@yourrank/shared/ratelimit";
import { requireUser, bad, json } from "../auth.js";
import { getByUser, getBoardById } from "../site.js";
import { requireSiteCapability } from "../site-authorization.js";
import { loadPeopleReviewCounts } from "./people-reviews.js";

const PRIVATE_CACHE = "no-store, no-cache, must-revalidate";
const ALLOWED_WINDOWS = new Set([7, 30]);

const timeoutOne = async (sql, params) => (await queryWithTimeout(sql, params, 5000))?.[0] || null;

const defaults = {
  requireUser,
  getByUser,
  getBoardById,
  requireSiteCapability,
  rateLimit,
  one,
  loadPeopleReviewCounts: (siteId) => loadPeopleReviewCounts(siteId, timeoutOne),
  analyticsQuery: timeoutOne,
  now: () => new Date(),
};

const privateBad = (message, status = 400) => bad(message, status, { "cache-control": PRIVATE_CACHE });
const privateOk = (data) => json({ ok: true, ...data }, 200, { "cache-control": PRIVATE_CACHE });
function privateResponse(response) {
  if (!response) return response;
  const headers = new Headers(response.headers);
  headers.set("cache-control", PRIVATE_CACHE);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function requestedDays(url) {
  const value = Number(url.searchParams.get("days") || 30);
  return ALLOWED_WINDOWS.has(value) ? value : 0;
}

async function selectedSite(request, env, user, deps) {
  const url = new URL(request.url);
  const siteId = String(url.searchParams.get("siteId") || "").trim();
  return siteId ? deps.getBoardById(env, user.id, siteId) : deps.getByUser(env, user.id);
}

async function ownerPlan(site, user, deps) {
  if (site.user_id === user.id) return effectivePlan(user);
  const owner = await deps.one("SELECT plan, plan_expires_at, status FROM users WHERE id=$1", [site.user_id]);
  return effectivePlan(owner || {});
}

export async function handleInsights(request, env, injected = {}) {
  const deps = { ...defaults, ...injected };
  const { user, res } = await deps.requireUser(request, env);
  if (res) return privateResponse(res);

  const url = new URL(request.url);
  const days = requestedDays(url);
  if (!days) return privateBad("Insights supports 7-day and 30-day windows.");

  const site = await selectedSite(request, env, user, deps);
  if (!site) return privateBad("Site not found.", 404);
  const authorization = await deps.requireSiteCapability(user, site, "canRoleViewInsights");
  if (authorization.res) return privateResponse(authorization.res);
  if (!(await deps.rateLimit(env, `insights:${user.id}:${site.id}`, 60, 60)).ok) {
    return privateBad("Too many requests.", 429);
  }

  const plan = await ownerPlan(site, user, deps);
  const effectiveDays = Math.min(days, HISTORY_DAYS[plan] || HISTORY_DAYS.free);
  const endsAt = new Date(deps.now());
  const startsAt = new Date(endsAt.getTime() - effectiveDays * 86_400_000);
  const params = [site.id, startsAt.toISOString(), endsAt.toISOString()];

  const settled = await Promise.allSettled([
    deps.analyticsQuery(
      `SELECT
         count(*) FILTER (WHERE sv.created_at >= $2::timestamptz AND sv.created_at < $3::timestamptz)::integer AS new_members,
         count(*) FILTER (
           WHERE sv.created_at < $2::timestamptz
             AND sv.last_seen_at >= $2::timestamptz
             AND sv.last_seen_at < $3::timestamptz
         )::integer AS returning_members
       FROM site_viewers sv
       JOIN viewers v ON v.id=sv.viewer_id
       WHERE sv.site_id=$1 AND v.is_system=FALSE`,
      params,
    ),
    deps.analyticsQuery(
      `WITH claims AS (
         SELECT c.viewer_id, c.code_drop_id
           FROM code_drop_claims c
           JOIN code_drops d ON d.id=c.code_drop_id
           JOIN viewers v ON v.id=c.viewer_id
          WHERE d.site_id=$1
            AND c.created_at >= $2::timestamptz
            AND c.created_at < $3::timestamptz
            AND v.is_system=FALSE
       ), participant_activity AS (
         SELECT viewer_id, count(DISTINCT code_drop_id)::integer AS activities
           FROM claims GROUP BY viewer_id
       )
       SELECT
         (SELECT count(*)::integer FROM participant_activity) AS participants,
         (SELECT count(*)::integer FROM participant_activity WHERE activities >= 2) AS repeat_participants,
         (SELECT count(DISTINCT code_drop_id)::integer FROM claims) AS active_code_drops`,
      params,
    ),
    deps.analyticsQuery(
       `WITH window_claims AS (
         SELECT r.id, r.status, r.shop_item_id
           FROM redemptions r
           JOIN site_viewers sv ON sv.id=r.site_viewer_id
           JOIN viewers v ON v.id=sv.viewer_id
          WHERE sv.site_id=$1
            AND r.created_at >= $2::timestamptz
            AND r.created_at < $3::timestamptz
            AND v.is_system=FALSE
       ), completed_claims AS (
         SELECT DISTINCT r.id
           FROM audit_log a
           JOIN redemptions r
             ON r.id=(a.details->>'source_id')::uuid
           JOIN site_viewers sv ON sv.id=r.site_viewer_id
           JOIN viewers v ON v.id=sv.viewer_id
          WHERE a.entity_type='claim'
            AND (a.details->>'site_id')=$1::text
            AND a.action='claim_completed'
            AND a.created_at >= $2::timestamptz
            AND a.created_at < $3::timestamptz
            AND sv.site_id=$1
            AND v.is_system=FALSE
       ), top_reward AS (
         SELECT i.name, count(*)::integer AS claim_count
           FROM window_claims wc
           JOIN shop_items i ON i.id=wc.shop_item_id
          WHERE wc.status <> 'cancelled'
          GROUP BY i.id, i.name
          ORDER BY count(*) DESC, i.name ASC
          LIMIT 1
       )
       SELECT
         (SELECT count(*)::integer FROM window_claims) AS claims_submitted,
         (SELECT count(*)::integer FROM completed_claims) AS claims_completed,
         (SELECT count(*)::integer FROM redemptions r JOIN site_viewers sv ON sv.id=r.site_viewer_id JOIN viewers v ON v.id=sv.viewer_id WHERE sv.site_id=$1 AND r.status='pending' AND v.is_system=FALSE) AS pending_claims,
         (SELECT name FROM top_reward) AS top_reward_name,
         (SELECT claim_count FROM top_reward) AS top_reward_claims`,
      params,
    ),
    deps.loadPeopleReviewCounts(site.id),
  ]);

  const names = ["community", "participation", "rewards", "reviews"];
  settled.forEach((result, index) => {
    if (result.status === "rejected") {
      console.warn(JSON.stringify({ event: "insights_section_failed", section: names[index], siteId: site.id }));
    }
  });
  const value = (index) => settled[index].status === "fulfilled" ? settled[index].value : null;
  const community = value(0);
  const participation = value(1);
  const rewards = value(2);
  const reviews = value(3);
  const availability = {
    community: community !== null,
    participation: participation !== null,
    rewards: rewards !== null,
    pendingReviews: reviews !== null,
    pendingClaims: rewards !== null,
  };

  return privateOk({
    site: { id: site.id, name: site.name || site.slug, slug: site.slug },
    window: { requestedDays: days, effectiveDays, plan, timeZone: "UTC", startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
    community: community ? {
      newMembers: Number(community?.new_members) || 0,
      returningMembers: Number(community?.returning_members) || 0,
    } : null,
    participation: participation ? {
      participants: Number(participation?.participants) || 0,
      repeatParticipants: Number(participation?.repeat_participants) || 0,
      activeCodeDrops: Number(participation?.active_code_drops) || 0,
    } : null,
    rewards: rewards ? {
      claimsSubmitted: Number(rewards?.claims_submitted) || 0,
      claimsCompleted: Number(rewards?.claims_completed) || 0,
      topReward: rewards?.top_reward_name ? {
        name: rewards.top_reward_name,
        claims: Number(rewards.top_reward_claims) || 0,
      } : null,
    } : null,
    operations: {
      pendingReviews: reviews ? Number(reviews?.pending) || 0 : null,
      pendingClaims: rewards ? Number(rewards?.pending_claims) || 0 : null,
    },
    availability,
  });
}
