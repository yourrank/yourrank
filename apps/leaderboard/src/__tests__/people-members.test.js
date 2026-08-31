import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  handlePeopleMemberDetail,
  handlePeopleMembers,
} from "../handlers/people.js";

const request = (path) => new Request(`https://yourrank.site${path}`);

function dependencies(overrides = {}) {
  const calls = { one: [], query: [] };
  const deps = {
    requireUser: async () => ({ user: { id: "creator-1" }, res: null }),
    getByUser: async () => ({ id: "site-1", user_id: "creator-1", name: "Site One", slug: "one" }),
    getBoardById: async (_env, _userId, siteId) => siteId === "site-1"
      ? { id: "site-1", user_id: "creator-1", name: "Site One", slug: "one" }
      : null,
    requireSiteCapability: async () => ({ role: "owner", res: null }),
    rateLimit: async () => ({ ok: true }),
    query: async (sql, params) => {
      calls.query.push({ sql: String(sql), params });
      return [];
    },
    one: async (sql, params) => {
      calls.one.push({ sql: String(sql), params });
      return null;
    },
    ...overrides,
  };
  return { calls, deps };
}

describe("People member list", () => {
  it("returns site-scoped membership context without raw identity or risk identifiers", async () => {
    const { calls, deps } = dependencies({
      query: async (sql, params) => {
        calls.query.push({ sql: String(sql), params });
        return [{
          id: "membership-1",
          kick_username: "alice",
          discord_username: "Alice D",
          avatar_url: "https://cdn.example/avatar.png",
          kick_linked_at: "2026-08-01T00:00:00Z",
          discord_linked_at: null,
          balance: 80,
          total_earned: 100,
          total_spent: 20,
          blocked: false,
          last_earned_at: "2026-08-20T00:00:00Z",
          last_seen_at: "2026-08-21T00:00:00Z",
          created_at: "2026-08-01T00:00:00Z",
        }];
      },
    });

    const response = await handlePeopleMembers(request("/api/people/members?siteId=site-1"), {}, deps);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body.site).toEqual({ id: "site-1", name: "Site One", slug: "one" });
    expect(body.members).toEqual([{
      id: "membership-1",
      displayName: "alice",
      avatarUrl: "https://cdn.example/avatar.png",
      lastSeenAt: "2026-08-21T00:00:00Z",
      lastCreditAt: "2026-08-20T00:00:00Z",
      balance: 80,
      totalEarned: 100,
      totalSpent: 20,
      blocked: false,
      linkedIdentities: [{ provider: "Kick", displayName: "alice" }],
    }]);
    expect(calls.query[0].params).toEqual(["site-1"]);
    expect(calls.query[0].sql).toContain("WHERE sv.site_id=$1");
    expect(calls.query[0].sql).not.toContain("fraud_score");
    expect(calls.query[0].sql).not.toMatch(/kick_user_id|discord_user_id/);
    expect(JSON.stringify(body)).not.toMatch(/fraud|blockReason|kickUserId|discordUserId/);
  });

  it("rejects a site-id substitution before querying memberships", async () => {
    const { calls, deps } = dependencies();
    const response = await handlePeopleMembers(request("/api/people/members?siteId=site-2"), {}, deps);

    expect(response.status).toBe(404);
    expect(calls.query).toHaveLength(0);
  });

  it("requires a creator session", async () => {
    const unauthorized = new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    const { calls, deps } = dependencies({
      requireUser: async () => ({ user: null, res: unauthorized }),
    });
    const response = await handlePeopleMembers(request("/api/people/members?siteId=site-1"), {}, deps);

    expect(response.status).toBe(401);
    expect(calls.query).toHaveLength(0);
  });

  it("allows an authorized team member through the existing site capability boundary", async () => {
    const capabilityCalls = [];
    const { calls, deps } = dependencies({
      requireUser: async () => ({ user: { id: "operator-1" }, res: null }),
      getBoardById: async () => ({ id: "site-1", user_id: "creator-1", name: "Site One", slug: "one" }),
      requireSiteCapability: async (user, site, capability) => {
        capabilityCalls.push({ user, site, capability });
        return { role: "moderator", res: null };
      },
    });

    const response = await handlePeopleMembers(request("/api/people/members?siteId=site-1"), {}, deps);

    expect(response.status).toBe(200);
    expect(capabilityCalls).toEqual([{
      user: { id: "operator-1" },
      site: { id: "site-1", user_id: "creator-1", name: "Site One", slug: "one" },
      capability: "canRoleViewMembers",
    }]);
    expect(calls.query[0].params).toEqual(["site-1"]);
  });
});

describe("People member detail", () => {
  it("binds a member lookup and activity to the selected site", async () => {
    const { calls, deps } = dependencies({
      one: async (sql, params) => {
        calls.one.push({ sql: String(sql), params });
        return {
          id: "membership-1",
          kick_username: "alice",
          discord_username: null,
          avatar_url: null,
          kick_linked_at: "2026-08-01T00:00:00Z",
          discord_linked_at: null,
          balance: 80,
          total_earned: 100,
          total_spent: 20,
          blocked: true,
          block_reason: "Repeated abusive messages",
          last_earned_at: "2026-08-20T00:00:00Z",
          last_seen_at: "2026-08-21T00:00:00Z",
          created_at: "2026-08-01T00:00:00Z",
        };
      },
      query: async (sql, params) => {
        calls.query.push({ sql: String(sql), params });
        return [{
          id: "event-1",
          type: "earn",
          amount: 25,
          description: "Channel reward",
          created_at: "2026-08-20T00:00:00Z",
        }];
      },
    });

    const response = await handlePeopleMemberDetail(request("/api/people/members/membership-1?siteId=site-1"), {}, deps);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(calls.one[0].params).toEqual(["site-1", "membership-1"]);
    expect(calls.one[0].sql).toContain("sv.site_id=$1 AND sv.id=$2");
    expect(calls.query[0].params).toEqual(["membership-1"]);
    expect(body.member.moderation).toEqual({ status: "blocked", reason: "Repeated abusive messages" });
    expect(body.member.recentCreditActivity).toEqual([{
      id: "event-1",
      type: "earn",
      amount: 25,
      direction: "credit",
      description: "Channel reward",
      createdAt: "2026-08-20T00:00:00Z",
    }]);
  });

  it("does not enumerate a member from another site", async () => {
    const { calls, deps } = dependencies();
    const response = await handlePeopleMemberDetail(request("/api/people/members/membership-other?siteId=site-1"), {}, deps);

    expect(response.status).toBe(404);
    expect(calls.one[0].params).toEqual(["site-1", "membership-other"]);
    expect(calls.query).toHaveLength(0);
  });

  it("honors the existing site-role capability boundary", async () => {
    const forbidden = new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
    const { calls, deps } = dependencies({
      requireSiteCapability: async () => ({ role: null, res: forbidden }),
    });
    const response = await handlePeopleMemberDetail(request("/api/people/members/membership-1?siteId=site-1"), {}, deps);

    expect(response.status).toBe(403);
    expect(calls.one).toHaveLength(0);
  });

  it("does not accept a viewer-only session for creator member detail", async () => {
    const unauthorized = new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    const { calls, deps } = dependencies({
      requireUser: async () => ({ user: null, res: unauthorized }),
    });

    const response = await handlePeopleMemberDetail(request("/api/people/members/membership-1?siteId=site-1"), {}, deps);

    expect(response.status).toBe(401);
    expect(calls.one).toHaveLength(0);
    expect(calls.query).toHaveLength(0);
  });
});

describe("People membership persistence", () => {
  it("keeps one site membership per viewer at the database boundary", () => {
    const migration = readFileSync(
      new URL("../../../../supabase/migrations/20260808000008_credits_phase0.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain("UNIQUE (site_id, viewer_id)");
  });
});
