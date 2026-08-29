import { describe, it, expect, mock, beforeEach } from "bun:test";
import {
  handleGetRaffles,
  handleCreateRaffle,
  handleDrawRaffle,
  handleGetCodeDrops,
  handleCreateCodeDrop,
  handleClaimCodeDrop,
} from "../handlers/events.js";

function mockEnv() {
  return {
    DB: {},
    JWT_SECRET: "test-secret-at-least-32-chars-long!",
  };
}

const USER = { id: "user-123", email: "streamer@test.com", plan: "pro" };
const SITE = { id: "site-456", user_id: "user-123", slug: "streamer" };

describe("Community Events: Raffles & Flash Code Drops", () => {
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
      expansionRestriction: mock().mockResolvedValue({ restricted: false, usage: null }),
      markActive: mock().mockResolvedValue(null),
    };
  });

  it("handleGetRaffles lists raffles for the streamer site", async () => {
    mockQuery.mockResolvedValueOnce([
      { id: "raffle-1", title: "VIP Role", ticket_cost: 30, status: "active", total_tickets: 10, participant_count: 4 },
    ]);

    const req = new Request("http://localhost/api/events/raffles?siteId=site-456");
    const res = await handleGetRaffles(req, mockEnv(), deps);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.raffles.length).toBe(1);
    expect(body.raffles[0].title).toBe("VIP Role");
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

  it("handleCreateRaffle creates a custom-priced raffle successfully", async () => {
    mockOne.mockResolvedValueOnce({
      id: "raffle-1",
      title: "VIP Role + $50",
      ticket_cost: 30, // custom price
      max_tickets_per_viewer: 5,
      status: "active",
      created_at: new Date().toISOString(),
    });

    const req = new Request("http://localhost/api/events/raffles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "VIP Role + $50",
        ticketCost: 30,
        maxTickets: 5,
        description: "Must be active in Discord",
      }),
    });

    const res = await handleCreateRaffle(req, mockEnv(), deps);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.raffle.title).toBe("VIP Role + $50");
    expect(body.raffle.ticket_cost).toBe(30);
  });

  it("handleDrawRaffle draws provably fair winner from tickets", async () => {
    mockOne.mockResolvedValueOnce({
      id: "raffle-1",
      site_id: "site-456",
      title: "VIP Role",
      status: "active",
      total_tickets: 3,
    }); // find raffle

    mockQuery.mockResolvedValueOnce([
      { id: "t-1", ticket_number: 1, viewer_id: "v-1", site_viewer_id: "sv-1", viewer_name: "Alice" },
      { id: "t-2", ticket_number: 2, viewer_id: "v-2", site_viewer_id: "sv-2", viewer_name: "Bob" },
      { id: "t-3", ticket_number: 3, viewer_id: "v-3", site_viewer_id: "sv-3", viewer_name: "Charlie" },
    ]); // find tickets

    mockExec.mockResolvedValueOnce({}); // update raffle

    const req = new Request("http://localhost/api/events/raffles/draw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raffleId: "raffle-1" }),
    });

    const res = await handleDrawRaffle(req, mockEnv(), deps);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("drawn");
    expect(["Alice", "Bob", "Charlie"]).toContain(body.winnerName);
    expect([1, 2, 3]).toContain(body.winnerTicketNumber);
    const ticketSql = mockQuery.mock.calls[0][0];
    expect(ticketSql).toContain("COALESCE(v.kick_username, 'Viewer') AS viewer_name");
    expect(ticketSql).not.toContain("v.username");
    expect(ticketSql).not.toContain("v.display_name");
  });

  it("handleDrawRaffle refuses to draw when no tickets were sold", async () => {
    mockOne.mockResolvedValueOnce({
      id: "raffle-1",
      site_id: "site-456",
      title: "VIP Role",
      status: "active",
      total_tickets: 0,
    });
    mockQuery.mockResolvedValueOnce([]); // no tickets

    const req = new Request("http://localhost/api/events/raffles/draw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raffleId: "raffle-1" }),
    });

    const res = await handleDrawRaffle(req, mockEnv(), deps);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("nothing to draw");
    // The raffle must stay active: no state transition, no fabricated winner.
    expect(mockExec).not.toHaveBeenCalled();
    expect(body.status).toBeUndefined();
    expect(body.winnerName).toBeUndefined();
  });

  it("handleCreateCodeDrop creates a drop code with custom reward and claims limit", async () => {
    mockOne.mockResolvedValueOnce({
      id: "drop-1",
      code: "KICK30",
      points_reward: 30, // custom points
      max_claims: 20,
      claimed_count: 0,
      status: "active",
      created_at: new Date().toISOString(),
    });

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
    deps.expansionRestriction.mockResolvedValueOnce({ restricted: true, usage: { activeViewers: 201 } });
    const res = await handleCreateCodeDrop(new Request("http://localhost/api/events/drops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "PAUSED", pointsReward: 10, maxClaims: 5 }),
    }), mockEnv(), deps);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/New Activities are paused/);
    expect(mockOne).not.toHaveBeenCalled();
  });

  it("handleClaimCodeDrop rejects already claimed code for same viewer", async () => {
    mockOne.mockResolvedValueOnce(SITE); // find site
    mockOne.mockResolvedValueOnce({
      id: "drop-1",
      code: "KICK30",
      points_reward: 30,
      max_claims: 20,
      claimed_count: 5,
      status: "active",
    }); // find drop
    mockOne.mockResolvedValueOnce({ id: "sv-1", balance: 100 }); // site_viewer
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
  });

  it("does not increment a drop or award credits when the atomic claim conflicts", async () => {
    mockOne.mockResolvedValueOnce(SITE); // find site
    mockOne.mockResolvedValueOnce({
      id: "drop-1",
      code: "KICK30",
      points_reward: 30,
      max_claims: 20,
      claimed_count: 5,
      status: "active",
    }); // find drop
    mockOne.mockResolvedValueOnce({ id: "sv-1", balance: 100 }); // site_viewer
    mockOne.mockResolvedValueOnce(null); // not yet claimed in pre-check
    mockOne.mockResolvedValueOnce({ claimed_count: 5, max_claims: 20 }); // inside tx lock
    mockOne.mockResolvedValueOnce(null); // ON CONFLICT DO NOTHING

    const res = await handleClaimCodeDrop(new Request("http://localhost/api/events/drops/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site: "streamer", code: "KICK30" }),
    }), mockEnv(), deps);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("already claimed");
    expect(mockExec).not.toHaveBeenCalled();
    expect(mockOne.mock.calls.some(([sql]) => String(sql).includes("ON CONFLICT (code_drop_id, viewer_id) DO NOTHING"))).toBe(true);
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
    mockOne.mockResolvedValueOnce(SITE); // find site
    mockOne.mockResolvedValueOnce({
      id: "drop-1",
      code: "KICK30",
      points_reward: 30,
      max_claims: 20,
      claimed_count: 5,
      status: "active",
    }); // find drop
    mockOne.mockResolvedValueOnce({ id: "sv-1", balance: 100 }); // site_viewer
    mockOne.mockResolvedValueOnce(null); // not yet claimed
    mockOne.mockResolvedValueOnce({ claimed_count: 5, max_claims: 20 }); // inside tx lock
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
  });

  it("handleClaimCodeDrop creates a site_viewer row on first claim", async () => {
    mockOne.mockResolvedValueOnce(SITE); // find site
    mockOne.mockResolvedValueOnce({
      id: "drop-1",
      code: "KICK30",
      points_reward: 30,
      max_claims: 20,
      claimed_count: 5,
      status: "active",
    }); // find drop
    mockOne.mockResolvedValueOnce({ id: "sv-new", balance: 0 }); // upsert site_viewer
    mockOne.mockResolvedValueOnce(null); // not yet claimed
    mockOne.mockResolvedValueOnce({ claimed_count: 5, max_claims: 20 }); // inside tx lock
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
  });

});
