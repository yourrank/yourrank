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
  name: "Test Casino",
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
  exec: async (sql, params) => { executed.push({ sql, params }); return []; },
  withTransaction: async (fn) => fn({
    one: async () => deps.oneResponses.shift(),
    unsafe: async () => [],
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

function seedTokenRows() {
  deps.oneResponses.push(
    { count: 0 }, // plan-limit pre-count
    { kick_access_token_enc: "enc", kick_refresh_token_enc: "ref", kick_token_expires_at: null },
  );
}

beforeEach(() => {
  deps.oneResponses.length = 0;
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
    expect((await res.json()).error).toMatch(/active-viewer allowance/i);
    expect(deps.oneResponses).toHaveLength(0);
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
    expect(executed).toHaveLength(1);
    expect(executed[0].sql).toContain("kick_access_token_enc = NULL");
    expect(executed[0].params).toEqual([userFixture.id]);
  });

  it("returns 409 kick_reconnect_required when no refresh token is stored", async () => {
    seedTokenRows();
    kickBehavior.refreshError = new Error("Kick refresh token not available");
    const res = await handleCreditsCreateReward(req({ title: "VIP", cost: 100, credits: 10 }), {}, deps);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("kick_reconnect_required");
    expect(executed[0].sql).toContain("kick_refresh_token_enc = NULL");
  });

  it("returns 409 kick_reconnect_required when Kick rejects the access token with 401", async () => {
    seedTokenRows();
    kickBehavior.createError = new Error("Kick create reward failed 401: unauthorized");
    const res = await handleCreditsCreateReward(req({ title: "VIP", cost: 100, credits: 10 }), {}, deps);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("kick_reconnect_required");
    expect(executed[0].sql).toContain("kick_access_token_enc = NULL");
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
    expect(executed[0].sql).toContain("kick_access_token_enc = NULL");
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
