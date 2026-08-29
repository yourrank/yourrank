import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { activityFromCodeDrop, handleGetActivities } from "../handlers/activities.js";
import { activitiesConfig, activitiesContentHtml } from "../pages/activities.jsx";
import { PAGES } from "../pages.jsx";
import { ROUTES } from "../routes.js";

const USER = { id: "operator-1" };
const SITE = { id: "site-1", name: "Creator site", slug: "creator" };

function deps(overrides = {}) {
  const calls = { query: [], capability: [], rateLimit: [] };
  return {
    calls,
    value: {
      requireUser: async () => ({ user: USER }),
      getByUser: async () => SITE,
      getBoardById: async (_env, userId, siteId) => (
        userId === USER.id && siteId === SITE.id ? SITE : null
      ),
      requireSiteCapability: async (user, site, capability) => {
        calls.capability.push({ user, site, capability });
        return {};
      },
      rateLimit: async (_env, key, max, windowSeconds) => {
        calls.rateLimit.push({ key, max, windowSeconds });
        return { ok: true };
      },
      query: async (sql, params) => {
        calls.query.push({ sql, params });
        return [{
          id: "drop-1",
          code: "HELLO100",
          points_reward: 100,
          max_claims: 50,
          claimed_count: 7,
          status: "active",
          expires_at: "2099-08-29T12:00:00.000Z",
          created_at: "2026-08-29T10:00:00.000Z",
        }];
      },
      ...overrides,
    },
  };
}

describe("Wave E safe Activities foundation", () => {
  it("adapts only site-scoped free code drops into safe activities", async () => {
    const mock = deps();
    const response = await handleGetActivities(
      new Request("https://yourrank.test/api/activities?siteId=site-1"),
      {},
      mock.value,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, no-cache, must-revalidate");
    expect(body.site).toEqual(SITE);
    expect(body.foundation).toEqual({
      persistence: "existing_workflow_adapter",
      membership: "site_viewers",
      includedTypes: ["drop"],
      challenges: "deferred",
    });
    expect(body.activities).toEqual([{
      id: "drop:drop-1",
      source: { kind: "code_drop", id: "drop-1" },
      type: "drop",
      typeLabel: "Drop",
      title: "Code drop HELLO100",
      state: "open",
      stateLabel: "Open",
      createdAt: "2026-08-29T10:00:00.000Z",
      endsAt: "2099-08-29T12:00:00.000Z",
      participation: { mode: "free", cost: 0, identity: "site_membership" },
      progress: { claimed: 7, capacity: 50 },
      reward: { creditsPerClaim: 100 },
    }]);

    expect(mock.calls.capability).toEqual([{ user: USER, site: SITE, capability: "canRoleManageBoard" }]);
    expect(mock.calls.rateLimit).toEqual([{ key: "activities:operator-1:site-1", max: 60, windowSeconds: 60 }]);
    expect(mock.calls.query).toHaveLength(1);
    expect(mock.calls.query[0].params).toEqual(["site-1"]);
    expect(mock.calls.query[0].sql).toContain("FROM code_drops");
    expect(mock.calls.query[0].sql).not.toMatch(/raffle|prediction|tournament|wager|ticket|payout|settlement/i);
  });

  it("derives presentation state without mutating workflow records", () => {
    const base = {
      id: "drop-2",
      code: "ENDED",
      points_reward: "25",
      max_claims: "4",
      claimed_count: "4",
      created_at: "2026-08-29T10:00:00.000Z",
      expires_at: null,
    };
    expect(activityFromCodeDrop({ ...base, status: "exhausted" }, Date.now())).toMatchObject({
      state: "completed",
      stateLabel: "Claimed out",
      progress: { claimed: 4, capacity: 4 },
    });
    expect(activityFromCodeDrop({
      ...base,
      status: "active",
      expires_at: "2026-08-29T09:00:00.000Z",
    }, Date.parse("2026-08-29T10:00:00.000Z"))).toMatchObject({
      state: "completed",
      stateLabel: "Expired",
    });
  });

  it("rejects site-id substitution before reading activity data", async () => {
    let queried = false;
    const mock = deps({
      getBoardById: async () => null,
      query: async () => { queried = true; return []; },
    });
    const response = await handleGetActivities(
      new Request("https://yourrank.test/api/activities?siteId=another-site"),
      {},
      mock.value,
    );
    expect(response.status).toBe(404);
    expect(queried).toBe(false);
  });

  it("rejects unauthenticated and unauthorized creator access before activity reads", async () => {
    let unauthenticatedQueried = false;
    const unauthenticated = deps({
      requireUser: async () => ({
        user: null,
        res: new Response(JSON.stringify({ error: "Authentication required." }), { status: 401 }),
      }),
      query: async () => { unauthenticatedQueried = true; return []; },
    });
    const unauthenticatedResponse = await handleGetActivities(
      new Request("https://yourrank.test/api/activities?siteId=site-1"),
      {},
      unauthenticated.value,
    );
    expect(unauthenticatedResponse.status).toBe(401);
    expect(unauthenticatedQueried).toBe(false);

    let unauthorizedQueried = false;
    const unauthorized = deps({
      requireSiteCapability: async () => ({
        role: null,
        res: new Response(JSON.stringify({ error: "Forbidden." }), { status: 403 }),
      }),
      query: async () => { unauthorizedQueried = true; return []; },
    });
    const unauthorizedResponse = await handleGetActivities(
      new Request("https://yourrank.test/api/activities?siteId=site-1"),
      {},
      unauthorized.value,
    );
    expect(unauthorizedResponse.status).toBe(403);
    expect(unauthorizedQueried).toBe(false);
  });

  it("ships a real private page, fragment, and API route without restricted workflow hooks", () => {
    expect(PAGES.activities.Component).toBeTruthy();
    expect(activitiesConfig.canonical).toBe("https://yourrank.site/dashboard/activities");
    expect(activitiesConfig.styles).toContain("/assets/activities.css");
    expect(activitiesContentHtml).toContain("Free community activities");
    expect(activitiesContentHtml).toContain("Challenges are deferred");
    expect(activitiesContentHtml).not.toMatch(/Raffles|Predictions|Games|wagering|stakes/i);
    expect(ROUTES.some((route) => route.path === "/api/activities" && route.method === "GET")).toBe(true);

    const client = readFileSync(new URL("../assets/activities.js", import.meta.url), "utf8");
    expect(client).toContain('sitePath("/api/activities"');
    expect(client).toContain('sitePath("/api/events/drops"');
    expect(client).not.toMatch(/\/api\/(?:predictions|tournaments|games)|\/api\/events\/raffles/i);
  });
});
