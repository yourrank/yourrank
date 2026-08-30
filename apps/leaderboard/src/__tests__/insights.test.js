import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { handleInsights } from "../handlers/insights.js";

const request = (path) => new Request(`https://yourrank.site${path}`);
const site = { id: "site-1", user_id: "owner-1", name: "Community One", slug: "one" };

function dependencies({ user = { id: "owner-1", plan: "free", status: "active" }, role = "owner", ownerPlan, rows = [] } = {}) {
  const calls = { capability: [], analytics: [], reviewSiteIds: [] };
  const queue = [...rows];
  return {
    calls,
    deps: {
      requireUser: async () => ({ user, res: null }),
      getByUser: async () => site,
      getBoardById: async (_env, _userId, siteId) => siteId === site.id ? site : null,
      requireSiteCapability: async (_user, selectedSite, capability) => {
        calls.capability.push({ siteId: selectedSite.id, capability });
        return { role, res: null };
      },
      rateLimit: async () => ({ ok: true }),
      one: async () => ownerPlan || { plan: "team", status: "active" },
      analyticsQuery: async (sql, params) => {
        calls.analytics.push({ sql: String(sql), params });
        return queue.shift() || {};
      },
      loadPeopleReviewCounts: async (siteId) => {
        calls.reviewSiteIds.push(siteId);
        return { pending: 2, resolved: 5 };
      },
    },
  };
}

describe("selected-site Insights", () => {
  it("returns only aggregate community, participation, reward, and operations facts", async () => {
    const { calls, deps } = dependencies({
      rows: [
        { new_members: 4, returning_members: 3 },
        { participants: 5, repeat_participants: 2, active_code_drops: 2 },
        { claims_submitted: 6, claims_fulfilled: 4, pending_claims: 1, top_reward_name: "VIP role", top_reward_claims: 3 },
      ],
    });
    const response = await handleInsights(request("/api/insights?siteId=site-1&days=7"), {}, deps);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body.site).toEqual({ id: "site-1", name: "Community One", slug: "one" });
    expect(body.window).toEqual({ requestedDays: 7, effectiveDays: 7, plan: "free", timeZone: "UTC" });
    expect(body.community).toEqual({ newMembers: 4, returningMembers: 3 });
    expect(body.participation).toEqual({ participants: 5, repeatParticipants: 2, activeCodeDrops: 2 });
    expect(body.rewards).toEqual({ claimsSubmitted: 6, claimsFulfilled: 4, topReward: { name: "VIP role", claims: 3 } });
    expect(body.operations).toEqual({ pendingReviews: 2, pendingClaims: 1 });
    expect(body).not.toHaveProperty("viewers");
    expect(JSON.stringify(body)).not.toMatch(/provider|externalId|telegram_user|kick_user|email/i);
    expect(calls.capability).toEqual([{ siteId: "site-1", capability: "canRoleViewInsights" }]);
    expect(calls.reviewSiteIds).toEqual(["site-1"]);
    expect(calls.analytics).toHaveLength(3);
    expect(calls.analytics.every(({ params }) => params[0] === "site-1" && params[1] === 7)).toBe(true);
    const aggregateSql = calls.analytics.map(({ sql }) => sql).join("\n");
    expect(aggregateSql).toContain("v.is_system=FALSE");
    expect(aggregateSql).toContain("sv.created_at <");
    expect(aggregateSql).toContain("sv.last_seen_at >=");
    expect(aggregateSql).toContain("count(DISTINCT code_drop_id)");
    expect(aggregateSql).toContain("GROUP BY viewer_id");
    expect(aggregateSql).toContain("wc.status <> 'cancelled'");
    expect(aggregateSql).toContain("r.status='pending'");
  });

  it("uses the owner plan and canonical history cap for a Team moderator", async () => {
    const moderator = { id: "moderator-1", plan: "free", status: "active" };
    const delegatedSite = { ...site, user_id: "owner-1" };
    const { calls, deps } = dependencies({ user: moderator, role: "moderator", ownerPlan: { plan: "team", plan_expires_at: "2027-08-30T00:00:00.000Z", status: "active" } });
    deps.getBoardById = async () => delegatedSite;

    const response = await handleInsights(request("/api/insights?siteId=site-1&days=30"), {}, deps);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.window).toEqual({ requestedDays: 30, effectiveDays: 30, plan: "team", timeZone: "UTC" });
    expect(calls.capability[0].capability).toBe("canRoleViewInsights");
  });

  it("delegates Pro history to the canonical shared plan source", async () => {
    const pro = { id: "owner-1", plan: "pro", plan_expires_at: "2027-08-30T00:00:00.000Z", status: "active" };
    const { deps } = dependencies({ user: pro });
    const response = await handleInsights(request("/api/insights?siteId=site-1&days=30"), {}, deps);
    const body = await response.json();
    expect(body.window).toEqual({ requestedDays: 30, effectiveDays: 30, plan: "pro", timeZone: "UTC" });
  });

  it("denies unauthenticated and viewer-only sessions with private responses", async () => {
    const unauthenticated = dependencies();
    unauthenticated.deps.requireUser = async () => ({ user: null, res: new Response("unauthorized", { status: 401 }) });
    const unauthenticatedResponse = await handleInsights(request("/api/insights?siteId=site-1"), {}, unauthenticated.deps);
    expect(unauthenticatedResponse.status).toBe(401);
    expect(unauthenticatedResponse.headers.get("cache-control")).toContain("no-store");

    const viewer = dependencies();
    viewer.deps.requireSiteCapability = async () => ({ role: null, res: new Response("forbidden", { status: 403 }) });
    const viewerResponse = await handleInsights(request("/api/insights?siteId=site-1"), {}, viewer.deps);
    expect(viewerResponse.status).toBe(403);
    expect(viewerResponse.headers.get("cache-control")).toContain("no-store");
    expect(viewer.calls.analytics).toHaveLength(0);
  });

  it("rejects unsupported windows and cross-site access without running aggregates", async () => {
    const unsupported = dependencies();
    const unsupportedResponse = await handleInsights(request("/api/insights?siteId=site-1&days=14"), {}, unsupported.deps);
    expect(unsupportedResponse.status).toBe(400);
    expect(unsupported.calls.analytics).toHaveLength(0);

    const missing = dependencies();
    missing.deps.getBoardById = async () => null;
    const missingResponse = await handleInsights(request("/api/insights?siteId=other&days=30"), {}, missing.deps);
    expect(missingResponse.status).toBe(404);
    expect(missing.calls.analytics).toHaveLength(0);
  });

  it("registers one canonical Insights API without creating another route family", () => {
    const routes = readFileSync(new URL("../routes.js", import.meta.url), "utf8");
    expect(routes.match(/path: "\/api\/insights"/g)).toHaveLength(1);
    expect(routes).not.toMatch(/api\/(analytics|insights-v2|connection-health-v2)/);
  });
});
