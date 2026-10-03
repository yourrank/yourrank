import { describe, it, expect, beforeEach } from "bun:test";

// Regression coverage for the Kick "connection needs attention" path:
// a revoked/expired OAuth grant used to escape handleCreditsCreateReward as an
// unhandled throw and reach the streamer as a bare 500. It must now come back
// as 409 + code "kick_reconnect_required" so the dashboard can flip the channel
// card to "Needs attention" and reveal the Reconnect link.
//
// Global module mocks are disallowed in leaderboard tests, so collaborators
// are injected through the handler's deps parameter (same convention as
// handlers/auth.js defaultDependencies).

import { handleCreditsCreateReward } from "../handlers/credits.js";

const siteFixture = {
  id: "site-1",
  slug: "test",
  name: "Test Community",
  user_id: "user-1",
  plan: "pro",
};
const userFixture = { id: "user-1", plan: "pro", status: "active", email_verified: true };

// Behavior under test: these throw or succeed per test.
const kickBehavior = {
  refreshError: null,
  createError: null,
  channelError: null,
};
let expansionRestricted = false;
let executed = [];

const deps = {
  requireUser: async () => ({ user: userFixture, res: null }),
  getByUser: async () => siteFixture,
  getBoardById: async () => siteFixture,
  requireSiteCapability: async () => ({ role: "owner", res: null }),
  rateLimit: async () => ({ ok: true }),
  oneResponses: [],
  one: async () => deps.oneResponses.shift(),
  kickAuthorization: null,
  loadKickAuthorization: async (siteId) => {
    expect(siteId).toBe(siteFixture.id);
    return deps.kickAuthorization;
  },
  bindCandidates: [],
  exec: async (sql, params) => { executed.push({ sql, params }); return []; },
  withTransaction: async (fn) => fn({
    one: async () => deps.oneResponses.shift(),
    unsafe: async (sql, params) => {
      executed.push({ sql, params });
      if (sql.includes("INSERT INTO credit_reward_mappings")) return [{ id: "mapping-1" }];
      if (sql.includes("UNION ALL")) return deps.bindCandidates;
      if (sql.includes("FROM creator_connections cc")) return [{ id: "conn-1" }];
      if (sql.includes("FROM site_creator_connections sc")) return [{ id: "sc-1" }];
      return [];
    },
    query: async () => [],
    exec: async () => [],
  }),
  getValidKickAccessToken: async () => {
    if (kickBehavior.refreshError) throw kickBehavior.refreshError;
    return { accessToken: "acc", accessEnc: "acc-enc", refreshEnc: "ref-enc", expiresAt: null };
  },
  createKickChannelReward: async () => {
    if (kickBehavior.createError) throw kickBehavior.createError;
    return { id: "reward-1", title: "t", cost: 1 };
  },
  fetchKickCurrentChannel: async () => {
    if (kickBehavior.channelError) throw kickBehavior.channelError;
    return { broadcaster_user_id: "chan-1", slug: "testchannel" };
  },
  creatorExpansionRestriction: async () => ({ restricted: expansionRestricted, usage: null }),
};

function req(body) {
  return new Request("https://test.com/api/credits/rewards/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const accountAuthorization = {
  scope: "account",
  connectionId: "conn-1",
  siteId: "site-1",
  userId: "user-1",
  provider: "kick",
  externalUserId: "chan-1",
  username: "testchannel",
  externalChannelId: "chan-1",
  externalChannelName: "testchannel",
  linkedAt: "2026-09-15T00:00:00.000Z",
  accessTokenEnc: "enc",
  refreshTokenEnc: "ref",
  tokenExpiresAt: null,
};
const siteAuthorization = { ...accountAuthorization, scope: "site", connectionId: "sc-1" };

function seedTokenRows(authorization = accountAuthorization) {
  deps.oneResponses.push({ count: 0 }); // plan-limit pre-count
  deps.kickAuthorization = authorization;
}

beforeEach(() => {
  deps.oneResponses.length = 0;
  deps.kickAuthorization = null;
  deps.bindCandidates = [];
  kickBehavior.refreshError = null;
  kickBehavior.createError = null;
  kickBehavior.channelError = null;
  expansionRestricted = false;
  executed = [];
});

describe("handleCreditsCreateReward Kick connection failures", () => {
  it("pauses creator-side reward expansion after Free grace without calling Kick", async () => {
    expansionRestricted = true;
    const res = await handleCreditsCreateReward(req({ title: "VIP", cost: 100, credits: 10 }), {}, deps);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("plan_limit_reached");
    expect(body.limit).toBe("active_viewers_30d");
    expect(body.required_plan).toBe("starter");
    expect(deps.oneResponses).toHaveLength(0);
  });

  it("marks the provider-derived channel binding verified before saving the reward mapping", async () => {
    seedTokenRows();
    deps.bindCandidates = [{ creator_connection_id: "conn-1", site_creator_connection_id: null, external_user_id: "chan-1" }];
    deps.oneResponses.push({ count: 0 }, null);

    const res = await handleCreditsCreateReward(req({ title: "VIP", cost: 100, credits: 10 }), {}, deps);

    expect(res.status).toBe(200);
    const channelIdx = executed.findIndex((call) => call.sql.includes("INSERT INTO community_channels"));
    const mirrorIdx = executed.findIndex((call) => call.sql.includes("UPDATE sites"));
    const mappingIdx = executed.findIndex((call) => call.sql.includes("INSERT INTO credit_reward_mappings"));
    expect(channelIdx).toBeGreaterThanOrEqual(0);
    expect(mirrorIdx).toBeGreaterThan(channelIdx);
    expect(mappingIdx).toBeGreaterThan(mirrorIdx);
    // generic binding: [siteId, provider, channelId, name, verified, creatorConnectionId, siteCreatorConnectionId]
    expect(executed[channelIdx].params).toEqual(["site-1", "kick", "chan-1", "testchannel", true, "conn-1", null]);
    expect(executed[mirrorIdx].sql).toContain("kick_channel_linked_at = now()");
    expect(executed[mirrorIdx].sql).toContain("kick_channel_verified_at = CASE WHEN $3 THEN now() END");
    expect(executed[mirrorIdx].params).toEqual(["chan-1", "testchannel", true, "site-1"]);
  });

  it("refuses to bind when the site owner has no matching active Kick creator connection", async () => {
    seedTokenRows();

    await expect(
      handleCreditsCreateReward(req({ title: "VIP", cost: 100, credits: 10 }), {}, deps),
    ).rejects.toThrow("Kick identity changed before binding");

    expect(executed.some((call) => call.sql.includes("INSERT INTO community_channels"))).toBe(false);
    expect(executed.some((call) => call.sql.includes("INSERT INTO credit_reward_mappings"))).toBe(false);
  });

  it("returns 409 kick_reconnect_required when the token refresh hits invalid_grant", async () => {
    seedTokenRows();
    kickBehavior.refreshError = new Error("Kick token refresh failed 400: {\"error\":\"invalid_grant\"}");
    const res = await handleCreditsCreateReward(req({ title: "VIP", cost: 100, credits: 10 }), {}, deps);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("kick_reconnect_required");
    expect(body.error).toMatch(/needs attention/i);
    expect(body.error).not.toMatch(/invalid_grant|401|OAuth/);
    expect(executed).toHaveLength(2);
    expect(executed[0].sql).toContain("UPDATE creator_connections");
    expect(executed[0].sql).toContain("access_token_enc = NULL");
    expect(executed[0].params).toEqual([userFixture.id, "kick"]);
    expect(executed[1].sql).toContain("kick_access_token_enc = null");
    expect(executed[1].params).toEqual([userFixture.id]);
  });

  it("clears only the site's own authorization when this site uses its own Kick account", async () => {
    seedTokenRows(siteAuthorization);
    kickBehavior.refreshError = new Error("Kick token refresh failed 400: {\"error\":\"invalid_grant\"}");
    const res = await handleCreditsCreateReward(req({ title: "VIP", cost: 100, credits: 10 }), {}, deps);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("kick_reconnect_required");
    expect(executed).toHaveLength(1);
    expect(executed[0].sql).toContain("UPDATE site_creator_connections");
    expect(executed[0].params).toEqual(["sc-1"]);
  });

  it("creates the reward with the site's own Kick account and binds the channel to it", async () => {
    seedTokenRows(siteAuthorization);
    deps.bindCandidates = [{ creator_connection_id: null, site_creator_connection_id: "sc-1", external_user_id: "chan-1" }];
    deps.oneResponses.push({ count: 0 }, null);
    const res = await handleCreditsCreateReward(req({ title: "VIP", cost: 100, credits: 10 }), {}, deps);
    expect(res.status).toBe(200);
    const tokenWrite = executed.find((call) => call.sql.includes("access_token_enc"));
    expect(tokenWrite.sql).toContain("UPDATE site_creator_connections");
    expect(tokenWrite.params).toEqual(["sc-1", "acc-enc", "ref-enc", null]);
    expect(executed.some((call) => /UPDATE (creator_connections|users)\b/.test(call.sql))).toBe(false);
    const channel = executed.find((call) => call.sql.includes("INSERT INTO community_channels"));
    expect(channel.params).toEqual(["site-1", "kick", "chan-1", "testchannel", true, null, "sc-1"]);
  });

  it("returns 409 kick_reconnect_required when no refresh token is stored", async () => {
    seedTokenRows();
    kickBehavior.refreshError = new Error("Kick refresh token not available");
    const res = await handleCreditsCreateReward(req({ title: "VIP", cost: 100, credits: 10 }), {}, deps);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("kick_reconnect_required");
    expect(executed[0].sql).toContain("refresh_token_enc = NULL");
  });

  it("returns 409 kick_reconnect_required when Kick rejects the access token with 401", async () => {
    seedTokenRows();
    kickBehavior.createError = new Error("Kick create reward failed 401: unauthorized");
    const res = await handleCreditsCreateReward(req({ title: "VIP", cost: 100, credits: 10 }), {}, deps);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("kick_reconnect_required");
    expect(executed[0].sql).toContain("access_token_enc = NULL");
  });

  it("keeps a refresh credential after a transient refresh failure", async () => {
    seedTokenRows();
    kickBehavior.refreshError = new Error("Kick token refresh failed 503: upstream unavailable");
    const res = await handleCreditsCreateReward(req({ title: "VIP", cost: 100, credits: 10 }), {}, deps);
    expect(res.status).toBe(502);
    expect(executed).toHaveLength(0);
  });

  it("clears invalid credentials when Kick rejects the current-channel lookup", async () => {
    seedTokenRows();
    kickBehavior.channelError = new Error("Kick current channel failed 401: unauthorized");
    const res = await handleCreditsCreateReward(req({ title: "VIP", cost: 100, credits: 10 }), {}, deps);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("kick_reconnect_required");
    expect(executed[0].sql).toContain("access_token_enc = NULL");
  });

  it("returns a friendly 502 when Kick fails for a non-auth reason", async () => {
    seedTokenRows();
    kickBehavior.createError = new Error("Kick create reward failed 503: upstream unavailable");
    const res = await handleCreditsCreateReward(req({ title: "VIP", cost: 100, credits: 10 }), {}, deps);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBeUndefined();
    expect(body.error).toMatch(/try again/i);
    expect(body.error).not.toMatch(/503|upstream/);
    expect(executed).toHaveLength(0);
  });
});
