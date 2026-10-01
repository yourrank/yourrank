import { describe, it, expect, mock, beforeEach } from "bun:test";
import {
  handleGetCodeDrops,
  handleCreateCodeDrop,
  handleClaimCodeDrop,
} from "../handlers/events.js";
import { boardPasswordSetCookieHeader } from "../board-password.js";

function mockEnv() {
  return {
    DB: {},
    JWT_SECRET: "test-secret-at-least-32-chars-long!",
  };
}

const USER = { id: "user-123", email: "streamer@test.com", plan: "pro" };
const SITE = { id: "site-456", user_id: "user-123", slug: "streamer" };

describe("Flash Code Drops", () => {
  let mockOne;
  let mockQuery;
  let mockExec;
  let mockLogAudit;
  let mockRateLimit;
  let mockWithTransaction;
  let deps;

  beforeEach(() => {
    mockOne = mock();
    mockQuery = mock();
    mockExec = mock();
    mockLogAudit = mock();
    mockRateLimit = mock().mockResolvedValue({ ok: true });
    mockWithTransaction = mock((fn) => fn({
      one: mockOne,
      unsafe: mockExec,
    }));
    mockExec.mockResolvedValue([{}]);
    mockQuery.mockResolvedValue([]);

    deps = {
      requireUser: mock().mockResolvedValue({ user: USER, res: null }),
      getByUser: mock().mockResolvedValue(SITE),
      getBoardById: mock().mockResolvedValue(SITE),
      one: mockOne,
      query: mockQuery,
      exec: mockExec,
      logAudit: mockLogAudit,
      rateLimit: mockRateLimit,
      withTransaction: mockWithTransaction,
      requireViewer: mock().mockResolvedValue({ viewer: { id: "viewer-123" }, res: null }),
      resolveJoinableCommunity: mock().mockResolvedValue(SITE),
      expansionRestriction: mock().mockResolvedValue({ restricted: false, usage: null }),
      markActive: mock().mockResolvedValue(null),
    };
  });

  it("handleGetCodeDrops lists active drops for the streamer site", async () => {
    mockQuery.mockResolvedValueOnce([
      { id: "drop-1", code: "KICK30", points_reward: 30, max_claims: 20, claimed_count: 3, status: "active" },
    ]);

    const req = new Request("http://localhost/api/events/drops?siteId=site-456");
    const res = await handleGetCodeDrops(req, mockEnv(), deps);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.drops.length).toBe(1);
    expect(body.drops[0].code).toBe("KICK30");
  });

  it("preserves Moderator access to safe code-drop Activities", async () => {
    const moderator = { id: "moderator-1", email: "moderator@test.com" };
    deps.requireUser.mockResolvedValueOnce({ user: moderator, res: null });
    const capability = mock(async (_user, _site, requested) => (
      requested === "canRoleManageActivities"
        ? { role: "moderator", res: null }
        : { role: "moderator", res: new Response("Forbidden", { status: 403 }) }
    ));
    deps.requireSiteCapabilityImpl = capability;
    mockQuery.mockResolvedValueOnce([]);

    const response = await handleGetCodeDrops(
      new Request("http://localhost/api/events/drops?siteId=site-456"),
      mockEnv(),
      deps,
    );

    expect(response.status).toBe(200);
    expect(capability).toHaveBeenCalledWith(moderator, SITE, "canRoleManageActivities");
  });

  it("handleCreateCodeDrop creates a drop code with custom reward and claims limit", async () => {
    mockExec.mockResolvedValueOnce([{
      id: "drop-1",
      code: "KICK30",
      points_reward: 30, // custom points
      max_claims: 20,
      claimed_count: 0,
      status: "active",
      created_at: new Date().toISOString(),
    }]);

    const req = new Request("http://localhost/api/events/drops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: "kick30",
        pointsReward: 30,
        maxClaims: 20,
      }),
    });

    const res = await handleCreateCodeDrop(req, mockEnv(), deps);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.drop.code).toBe("KICK30");
    expect(body.drop.points_reward).toBe(30);
  });

  it("pauses new creator-authored code drops after Free grace", async () => {
    deps.expansionRestriction.mockResolvedValueOnce({ restricted: true, usage: { activeViewers: 101 } });
    const res = await handleCreateCodeDrop(new Request("http://localhost/api/events/drops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "PAUSED", pointsReward: 10, maxClaims: 5 }),
    }), mockEnv(), deps);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("plan_limit_reached");
    expect(body.limit).toBe("active_viewers_30d");
    expect(mockOne).not.toHaveBeenCalled();
  });

  it("rejects a claim on a drop the creator ended, before and inside the locked transaction", async () => {
    const claim = () => handleClaimCodeDrop(new Request("http://localhost/api/events/drops/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site: "streamer", code: "KICK30" }),
    }), mockEnv(), deps);

    mockOne.mockResolvedValueOnce({
      id: "drop-1", code: "KICK30", points_reward: 30, max_claims: 20, claimed_count: 5,
      status: "expired", closed_at: "2026-08-30T10:00:00.000Z",
    }); // find drop: creator ended it
    const ended = await claim();
    expect(ended.status).toBe(400);
    expect((await ended.json()).error).toBe("This drop has ended.");
    expect(mockOne).toHaveBeenCalledTimes(1);
    expect(mockExec).not.toHaveBeenCalled();

    mockOne.mockClear();
    mockOne.mockResolvedValueOnce({
      id: "drop-1", code: "KICK30", points_reward: 30, max_claims: 20, claimed_count: 5,
      status: "active", closed_at: null,
    }); // find drop: still open when read
    mockOne.mockResolvedValueOnce(null); // not yet claimed
    mockOne.mockResolvedValueOnce({ claimed_count: 5, max_claims: 20, status: "expired" }); // closed before the row lock
    const raced = await claim();
    expect(raced.status).toBe(400);
    expect((await raced.json()).error).toBe("This drop has ended.");
    expect(mockOne.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO code_drop_claims"))).toBe(false);
    expect(mockExec).not.toHaveBeenCalled();
    expect(deps.markActive).not.toHaveBeenCalled();
  });

  it("handleClaimCodeDrop rejects already claimed code for same viewer", async () => {
    mockOne.mockResolvedValueOnce({
      id: "drop-1",
      code: "KICK30",
      points_reward: 30,
      max_claims: 20,
      claimed_count: 5,
      status: "active",
    }); // find drop
    mockOne.mockResolvedValueOnce({ id: "claim-1" }); // already claimed check

    const req = new Request("http://localhost/api/events/drops/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        site: "streamer",
        code: "KICK30",
        viewerId: "viewer-123",
      }),
    });

    const res = await handleClaimCodeDrop(req, mockEnv(), deps);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("already claimed");
    expect(deps.markActive).not.toHaveBeenCalled();
  });

  it("does not increment a drop or award credits when the atomic claim conflicts", async () => {
    mockOne.mockResolvedValueOnce({
      id: "drop-1",
      code: "KICK30",
      points_reward: 30,
      max_claims: 20,
      claimed_count: 5,
      status: "active",
    }); // find drop
    mockOne.mockResolvedValueOnce(null); // not yet claimed in pre-check
    mockOne.mockResolvedValueOnce({ claimed_count: 5, max_claims: 20, status: "active" }); // inside tx lock
    mockOne.mockResolvedValueOnce({ id: "sv-1", balance: 100 }); // membership inside transaction
    mockOne.mockResolvedValueOnce(null); // ON CONFLICT DO NOTHING

    const res = await handleClaimCodeDrop(new Request("http://localhost/api/events/drops/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site: "streamer", code: "KICK30" }),
    }), mockEnv(), deps);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("already claimed");
    expect(mockExec).not.toHaveBeenCalled();
    expect(deps.markActive).not.toHaveBeenCalled();
    expect(mockOne.mock.calls.some(([sql]) => String(sql).includes("ON CONFLICT (code_drop_id, viewer_id) DO NOTHING"))).toBe(true);
  });

  it("binds a code-drop claim to the accessible community represented by the request host", async () => {
    deps.resolveJoinableCommunity.mockResolvedValueOnce(null);

    const res = await handleClaimCodeDrop(new Request("https://community-a.example/api/events/drops/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site: "community-b", code: "KICK30" }),
    }), mockEnv(), deps);

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Community is not available.");
    expect(deps.resolveJoinableCommunity).toHaveBeenCalledWith(
      expect.any(Request),
      expect.any(Object),
      "community-b",
    );
    expect(mockOne).not.toHaveBeenCalled();
    expect(mockWithTransaction).not.toHaveBeenCalled();
    expect(deps.markActive).not.toHaveBeenCalled();
  });

  it("rejects raw Site identifiers instead of treating them as public community authority", async () => {
    deps.resolveJoinableCommunity.mockResolvedValueOnce(null);

    const res = await handleClaimCodeDrop(new Request("https://yourrank.site/api/events/drops/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId: "site-456", code: "KICK30" }),
    }), mockEnv(), deps);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Code and community are required.");
    expect(deps.resolveJoinableCommunity).not.toHaveBeenCalled();
    expect(mockOne).not.toHaveBeenCalled();
  });

  it("scopes unlocked board cookies so apex claim requests can present the Site-bound proof", () => {
    const cookie = boardPasswordSetCookieHeader(
      { slug: "streamer", password_hash: "hash" },
      "streamer:123:signature",
      { isCustomDomain: false },
    );
    expect(cookie).toContain("Path=/;");
    expect(cookie).toContain("yr_boardpass_streamer=");
  });

  it("handleClaimCodeDrop rejects anonymous callers", async () => {
    deps.requireViewer.mockResolvedValue({ viewer: null, res: new Response(null, { status: 401 }) });
    const res = await handleClaimCodeDrop(new Request("http://localhost/api/events/drops/claim", {
      method: "POST",
      body: JSON.stringify({ site: "streamer", code: "KICK30", viewerId: "attacker" }),
    }), mockEnv(), deps);
    expect(res.status).toBe(401);
  });

  it("handleClaimCodeDrop successfully awards points and increments claims", async () => {
    mockOne.mockResolvedValueOnce({
      id: "drop-1",
      code: "KICK30",
      points_reward: 30,
      max_claims: 20,
      claimed_count: 5,
      status: "active",
    }); // find drop
    mockOne.mockResolvedValueOnce(null); // not yet claimed
    mockOne.mockResolvedValueOnce({ claimed_count: 5, max_claims: 20, status: "active" }); // inside tx lock
    mockOne.mockResolvedValueOnce({ id: "sv-1", balance: 100 }); // membership inside transaction
    mockOne.mockResolvedValueOnce({ id: "claim-2" }); // atomic claim insert
    mockOne.mockResolvedValueOnce({ id: "sv-1", balance: 130 }); // credit update

    const req = new Request("http://localhost/api/events/drops/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        site: "streamer",
        code: "KICK30",
        viewerId: "viewer-123",
      }),
    });

    const res = await handleClaimCodeDrop(req, mockEnv(), deps);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.pointsAwarded).toBe(30);
    expect(body.newBalance).toBe(130);
    expect(deps.expansionRestriction).not.toHaveBeenCalled();
    expect(deps.markActive).toHaveBeenCalledTimes(1);
    expect(deps.markActive).toHaveBeenCalledWith("site-456", "viewer-123", expect.any(Object));
    const membershipSql = mockOne.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO site_viewers"))[0];
    const creditSql = mockOne.mock.calls.find(([sql]) => String(sql).includes("UPDATE site_viewers SET balance"))[0];
    expect(membershipSql).not.toContain("last_active_at");
    expect(creditSql).not.toContain("last_active_at");
  });

  it("handleClaimCodeDrop creates a site_viewer row on first claim", async () => {
    mockOne.mockResolvedValueOnce({
      id: "drop-1",
      code: "KICK30",
      points_reward: 30,
      max_claims: 20,
      claimed_count: 5,
      status: "active",
    }); // find drop
    mockOne.mockResolvedValueOnce(null); // not yet claimed
    mockOne.mockResolvedValueOnce({ claimed_count: 5, max_claims: 20, status: "active" }); // inside tx lock
    mockOne.mockResolvedValueOnce({ id: "sv-new", balance: 0 }); // membership inside transaction
    mockOne.mockResolvedValueOnce({ id: "claim-2" }); // atomic claim insert
    mockOne.mockResolvedValueOnce({ id: "sv-new", balance: 30 }); // credit update

    const req = new Request("http://localhost/api/events/drops/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site: "streamer", code: "KICK30" }),
    });

    const res = await handleClaimCodeDrop(req, mockEnv(), deps);
    expect(res.status).toBe(200);
    expect((await res.json()).newBalance).toBe(30);
    const siteViewerSql = mockOne.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO site_viewers"));
    expect(siteViewerSql).toBeTruthy();
    expect(siteViewerSql[0]).not.toContain("last_active_at");
    expect(deps.markActive).toHaveBeenCalledTimes(1);
  });

  it("does not let a blocked Membership claim a free code drop", async () => {
    mockOne.mockResolvedValueOnce({
      id: "drop-1",
      code: "KICK30",
      points_reward: 30,
      max_claims: 20,
      claimed_count: 5,
      status: "active",
    });
    mockOne.mockResolvedValueOnce(null); // not yet claimed
    mockOne.mockResolvedValueOnce({ claimed_count: 5, max_claims: 20, status: "active" }); // locked drop
    mockOne.mockResolvedValueOnce({ id: "sv-blocked", balance: 10, blocked: true });

    const res = await handleClaimCodeDrop(new Request("http://localhost/api/events/drops/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site: "streamer", code: "KICK30" }),
    }), mockEnv(), deps);

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Claiming is unavailable for this membership.");
    expect(mockOne.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO code_drop_claims"))).toBe(false);
    expect(mockExec).not.toHaveBeenCalled();
    expect(deps.markActive).not.toHaveBeenCalled();
  });

  it("records abuse signals after a successful claim, never on failures", async () => {
    const successDeps = () => {
      const recordSignals = mock().mockResolvedValue(undefined);
      return { ...deps, recordSignals };
    };
    const claimRequest = () => new Request("http://localhost/api/events/drops/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site: "streamer", code: "KICK30" }),
    });
    // Success: the recorder runs once, after the commit, with the claim action.
    let d = successDeps();
    mockOne.mockResolvedValueOnce({ id: "drop-1", code: "KICK30", points_reward: 30, max_claims: 20, claimed_count: 5, status: "active" });
    mockOne.mockResolvedValueOnce(null);
    mockOne.mockResolvedValueOnce({ claimed_count: 5, max_claims: 20, status: "active" });
    mockOne.mockResolvedValueOnce({ id: "sv-1", balance: 100 });
    mockOne.mockResolvedValueOnce({ id: "claim-2" });
    mockOne.mockResolvedValueOnce({ id: "sv-1", balance: 130 });
    const res = await handleClaimCodeDrop(claimRequest(), mockEnv(), d);
    expect(res.status).toBe(200);
    expect(d.recordSignals).toHaveBeenCalledTimes(1);
    expect(d.recordSignals.mock.calls[0][0]).toMatchObject({ action: "drop_claim", siteId: "site-456", viewerId: "viewer-123" });
    // An invalid code never reaches recording.
    d = successDeps();
    mockOne.mockResolvedValueOnce(null); // no drop found
    const failed = await handleClaimCodeDrop(claimRequest(), mockEnv(), d);
    expect(failed.status).toBe(404);
    expect(d.recordSignals).not.toHaveBeenCalled();
    // A rejecting recorder still leaves the viewer with the success response.
    d = successDeps();
    d.recordSignals = mock().mockRejectedValue(new Error("recorder blew up"));
    const origError = console.error;
    console.error = () => {};
    try {
      mockOne.mockResolvedValueOnce({ id: "drop-1", code: "KICK30", points_reward: 30, max_claims: 20, claimed_count: 5, status: "active" });
      mockOne.mockResolvedValueOnce(null);
      mockOne.mockResolvedValueOnce({ claimed_count: 5, max_claims: 20, status: "active" });
      mockOne.mockResolvedValueOnce({ id: "sv-1", balance: 100 });
      mockOne.mockResolvedValueOnce({ id: "claim-2" });
      mockOne.mockResolvedValueOnce({ id: "sv-1", balance: 130 });
      const res2 = await handleClaimCodeDrop(claimRequest(), mockEnv(), d);
      expect(res2.status).toBe(200);
      expect((await res2.json()).ok).toBe(true);
    } finally { console.error = origError; }
  });

});
