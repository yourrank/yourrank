import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { activityFromCodeDrop, handleCloseActivity, handleGetActivities } from "../handlers/activities.js";
import { activitiesConfig, activitiesContentHtml } from "../pages/activities.jsx";
import { PAGES } from "../pages.jsx";
import { ROUTES } from "../routes.js";

const USER = { id: "operator-1" };
const SITE = { id: "site-1", name: "Creator site", slug: "creator" };
const CURSOR = "11111111-1111-4111-8111-111111111111";
const STALE_CURSOR = "22222222-2222-4222-8222-222222222222";

function deps(overrides = {}) {
  const calls = { query: [], one: [], capability: [], rateLimit: [] };
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
      one: async (sql, params) => {
        calls.one.push({ sql, params });
        if (sql.includes("JOIN users")) {
          return { plan: "pro", plan_expires_at: "2099-01-01T00:00:00.000Z", status: "active" };
        }
        if (sql.includes("count(*)")) return { total: 1 };
        if (sql.includes("SELECT id FROM code_drops")) {
          return params[1] === STALE_CURSOR ? null : { id: params[1] };
        }
        return null;
      },
      query: async (sql, params) => {
        calls.query.push({ sql, params });
        if (sql.includes("activity_templates") || sql.includes("activity_schedules")) return [];
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
    expect(body.automation).toMatchObject({
      entitlement: { plan: "pro", canAutomate: true },
      kinds: ["safe_code_drop"],
      templateSemantics: "snapshot_on_schedule",
      timezone: "UTC",
      templates: [],
      schedules: [],
      announcements: "deferred_communication_not_ready",
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
      actions: { canEnd: true },
    }]);

    expect(mock.calls.capability).toEqual([{ user: USER, site: SITE, capability: "canRoleManageActivities" }]);
    expect(mock.calls.rateLimit).toEqual([{ key: "activities:operator-1:site-1", max: 60, windowSeconds: 60 }]);
    expect(body.page).toEqual({ limit: 50, hasMore: false, nextCursor: null });
    expect(body.total).toBe(1);
    expect(mock.calls.query).toHaveLength(3);
    expect(mock.calls.query[0].params).toEqual(["site-1", null, 51]);
    expect(mock.calls.query[0].sql).toContain("FROM code_drops");
    expect(mock.calls.query[0].sql).toContain("ORDER BY d.created_at DESC, d.id DESC");
    expect(mock.calls.query.map(({ sql }) => sql).join("\n")).not.toMatch(/raffle|prediction|tournament|wager|ticket|payout|settlement/i);
  });

  it("pages server-side with a bounded limit and a site-bound keyset cursor", async () => {
    const mock = deps({
      query: async (sql, params) => {
        mock.calls.query.push({ sql, params });
        return Array.from({ length: 6 }, (_, index) => ({
          id: `drop-${index}`, code: `C${index}`, points_reward: 1, max_claims: 1, claimed_count: 0,
          status: "active", expires_at: null, created_at: "2026-08-29T10:00:00.000Z",
        }));
      },
    });
    const response = await handleGetActivities(
      new Request(`https://yourrank.test/api/activities?siteId=site-1&limit=5&cursor=${CURSOR}`),
      {},
      mock.value,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.activities).toHaveLength(5);
    expect(body.page).toEqual({ limit: 5, hasMore: true, nextCursor: "drop-4" });
    // The cursor is verified against the requested site before it is used.
    expect(mock.calls.one[0]).toEqual({ sql: expect.stringContaining("WHERE site_id=$1 AND id=$2"), params: ["site-1", CURSOR] });
    expect(mock.calls.query[0].params).toEqual(["site-1", CURSOR, 6]);
    // Follow-up pages do not recompute automation (the first page carries it).
    expect(mock.calls.query).toHaveLength(1);
    expect(body.automation).toBeUndefined();
  });

  it("caps the page size and rejects malformed or stale cursors", async () => {
    const capped = deps();
    await handleGetActivities(new Request("https://yourrank.test/api/activities?siteId=site-1&limit=5000"), {}, capped.value);
    expect(capped.calls.query[0].params).toEqual(["site-1", null, 101]);

    const malformed = deps();
    const malformedResponse = await handleGetActivities(
      new Request("https://yourrank.test/api/activities?siteId=site-1&cursor=not-a-uuid"),
      {},
      malformed.value,
    );
    expect(malformedResponse.status).toBe(400);
    expect(malformed.calls.query).toHaveLength(0);

    const stale = deps();
    const staleResponse = await handleGetActivities(
      new Request(`https://yourrank.test/api/activities?siteId=site-1&cursor=${STALE_CURSOR}`),
      {},
      stale.value,
    );
    expect(staleResponse.status).toBe(410);
    expect(stale.calls.query).toHaveLength(0);
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
    expect(activitiesContentHtml).toContain("No purchase or stake is required.");
    expect(activitiesContentHtml.indexOf('class="act-list-panel"')).toBeLessThan(activitiesContentHtml.indexOf('class="act-automation"'));
    expect(activitiesContentHtml).toContain("Templates and schedules");
    expect(activitiesContentHtml).toContain('<details class="act-automation" id="act-automation"');
    expect(activitiesContentHtml).not.toMatch(/Raffles|Predictions|Games|wagering|stakes/i);
    expect(ROUTES.some((route) => route.path === "/api/activities" && route.method === "GET")).toBe(true);
    expect(ROUTES.some((route) => route.path === "/api/activities/close" && route.method === "POST")).toBe(true);

    const client = readFileSync(new URL("../assets/activities.js", import.meta.url), "utf8");
    expect(client).toContain('sitePath("/api/activities"');
    expect(client).toContain('sitePath("/api/events/drops"');
    expect(client).not.toMatch(/\/api\/(?:predictions|tournaments|games)|\/api\/events\/raffles/i);
  });

  it("maps a creator-closed drop to an ended state that offers no further action", () => {
    const closed = activityFromCodeDrop({
      id: "drop-3", code: "BYE", points_reward: 5, max_claims: 10, claimed_count: 2,
      status: "expired", closed_at: "2026-08-30T10:00:00.000Z", created_at: "2026-08-29T10:00:00.000Z", expires_at: null,
    });
    expect(closed).toMatchObject({ state: "completed", stateLabel: "Ended by creator", endsAt: "2026-08-30T10:00:00.000Z", actions: { canEnd: false } });
  });
});

describe("creator End now for an open Code Drop", () => {
  const DROP = "33333333-3333-4333-8333-333333333333";
  const row = (status) => ({
    id: DROP, code: "HELLO100", points_reward: 100, max_claims: 50, claimed_count: 7,
    status: status === "closed" ? "expired" : status,
    closed_at: status === "closed" ? "2026-08-30T10:00:00.000Z" : null,
    expires_at: null, created_at: "2026-08-29T10:00:00.000Z",
  });
  const close = (mock, body = { siteId: SITE.id, activityId: `drop:${DROP}` }) => handleCloseActivity(
    new Request("https://yourrank.test/api/activities/close", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }),
    {},
    mock.value,
  );

  it("closes an active drop once, audits it, and returns the ended activity", async () => {
    const audits = [];
    const mock = deps({
      logAudit: async (entry) => { audits.push(entry); },
      one: async (sql, params) => {
        mock.calls.one.push({ sql, params });
        if (sql.includes("UPDATE code_drops")) return row("closed");
        return null;
      },
    });
    const response = await close(mock);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.changed).toBe(true);
    expect(body.activity).toMatchObject({ id: `drop:${DROP}`, state: "completed", stateLabel: "Ended by creator", actions: { canEnd: false } });
    expect(body.activity.progress).toEqual({ claimed: 7, capacity: 50 });
    expect(mock.calls.capability).toEqual([{ user: USER, site: SITE, capability: "canRoleManageActivities" }]);
    expect(mock.calls.one).toHaveLength(1);
    expect(mock.calls.one[0].sql).toMatch(/SET status='expired', closed_at=now\(\)/);
    expect(mock.calls.one[0].sql).toMatch(/WHERE id=\$1 AND site_id=\$2 AND status='active' AND closed_at IS NULL/);
    expect(mock.calls.one[0].sql).toMatch(/AND \(expires_at IS NULL OR expires_at > now\(\)\)/);
    expect(mock.calls.one[0].params).toEqual([DROP, SITE.id]);
    expect(audits).toEqual([expect.objectContaining({ action: "code_drop_close", entityId: DROP, actorId: USER.id })]);
  });

  it("is idempotent for an already closed drop and reports exhausted or expired drops as conflicts", async () => {
    let current = "closed";
    const mock = deps({
      one: async (sql) => (sql.includes("UPDATE code_drops") ? null : row(current)),
    });
    const again = await close(mock);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ changed: false, activity: { stateLabel: "Ended by creator" } });

    current = "exhausted";
    const exhausted = await close(mock);
    expect(exhausted.status).toBe(409);
    expect(await exhausted.json()).toMatchObject({ ok: false, error: "This activity already ended (claimed out).", activity: { stateLabel: "Claimed out" } });

    current = "expired";
    const expired = await close(mock);
    expect(expired.status).toBe(409);
    expect(await expired.json()).toMatchObject({ activity: { stateLabel: "Ended", actions: { canEnd: false } } });
  });

  it("does not stamp closed_at or audit a creator close on a drop that already expired naturally", async () => {
    // status='active' in the row, but expires_at is in the past: the guarded
    // UPDATE matches nothing, so the handler falls through to the read path.
    const audits = [];
    const mock = deps({
      logAudit: async (entry) => { audits.push(entry); },
      one: async (sql, params) => {
        mock.calls.one.push({ sql, params });
        if (sql.includes("UPDATE code_drops")) return null;
        return { ...row("active"), expires_at: "2026-08-30T11:00:00.000Z" };
      },
    });
    const response = await close(mock);
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, error: "This activity already ended (expired)." });
    expect(body.activity).toMatchObject({ state: "completed", stateLabel: "Expired", actions: { canEnd: false } });
    expect(body.activity.stateLabel).not.toBe("Ended by creator");
    expect(audits).toEqual([]);
  });

  it("never touches a drop from another site or an unauthorized caller", async () => {
    const foreign = deps({ one: async () => null });
    const missing = await close(foreign);
    expect(missing.status).toBe(404);
    expect(foreign.calls.one.length).toBe(0);

    const substituted = deps({ getBoardById: async () => null });
    let touched = false;
    substituted.value.one = async () => { touched = true; return row("closed"); };
    expect((await close(substituted, { siteId: "another-site", activityId: DROP })).status).toBe(404);
    expect(touched).toBe(false);

    const unauthorized = deps({
      requireSiteCapability: async () => ({ res: new Response(JSON.stringify({ error: "Forbidden." }), { status: 403 }) }),
    });
    unauthorized.value.one = async () => { touched = true; return row("closed"); };
    expect((await close(unauthorized)).status).toBe(403);
    expect(touched).toBe(false);

    const malformed = deps();
    malformed.value.one = async () => { touched = true; return row("closed"); };
    expect((await close(malformed, { siteId: SITE.id, activityId: "drop:not-a-uuid" })).status).toBe(400);
    expect(touched).toBe(false);
  });
});
