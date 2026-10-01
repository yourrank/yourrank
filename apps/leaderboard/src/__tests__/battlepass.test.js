import { describe, it, expect, mock, beforeEach } from "bun:test";
import {
  handleGetSeason,
  handleCreateSeason,
  handleClaimTierReward,
  handleAwardXp,
} from "../handlers/battlepass.js";

function mockEnv() {
  return {
    DB: {},
    JWT_SECRET: "test-secret-at-least-32-chars-long!",
  };
}

const USER = { id: "user-123", email: "streamer@test.com", plan: "pro" };
const SITE = { id: "site-456", user_id: "user-123", slug: "streamer" };

describe("Seasonal Battle Pass", () => {
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
      one: (sql, ...a) => String(sql).includes("FROM users") ? Promise.resolve({ plan: "pro", plan_expires_at: null, status: "active" }) : String(sql).includes("SELECT user_id FROM sites") ? Promise.resolve({ user_id: "user-123" }) : mockOne(sql, ...a),
      unsafe: mockExec,
    }));
    mockExec.mockResolvedValue([{}]);

    deps = {
      requireUser: mock().mockResolvedValue({ user: USER, res: null }),
      getByUser: mock().mockResolvedValue(SITE),
      getBoardById: mock().mockResolvedValue(SITE),
      one: (sql, ...a) => String(sql).includes("FROM users") ? Promise.resolve({ plan: "pro", plan_expires_at: null, status: "active" }) : String(sql).includes("SELECT user_id FROM sites") ? Promise.resolve({ user_id: "user-123" }) : mockOne(sql, ...a),
      query: mockQuery,
      exec: mockExec,
      logAudit: mockLogAudit,
      rateLimit: mockRateLimit,
      withTransaction: mockWithTransaction,
      requireViewer: mock().mockResolvedValue({ viewer: { id: "v-1" }, res: null }),
    };
  });

  // --- BATTLE PASS TESTS ---
  describe("Battle Pass Handlers", () => {
    it("creates a new season with custom title", async () => {
      mockOne.mockResolvedValueOnce({ max_num: 1 }); // latest season
      mockOne.mockResolvedValueOnce({
        id: "season-2",
        season_number: 2,
        title: "Season 2: Summer Clash",
        status: "active",
        tiers_json: [],
        starts_at: new Date().toISOString(),
      }); // new season

      const req = new Request("http://localhost/api/battlepass/season", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId: "site-456",
          title: "Season 2: Summer Clash",
        }),
      });

      const res = await handleCreateSeason(req, mockEnv(), deps);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.season.season_number).toBe(2);
    });

    it("returns active season with 50 milestone tiers", async () => {
      mockOne.mockResolvedValueOnce(SITE); // site
      mockOne.mockResolvedValueOnce({
        id: "season-1",
        season_number: 1,
        title: "Season 1",
        status: "active",
        tiers_json: [{ level: 1, xp_required: 100 }, { level: 5, xp_required: 500, reward: { title: "Bronze Badge", points: 250 } }],
      });

      const req = new Request("http://localhost/api/battlepass/season?site=streamer");
      const res = await handleGetSeason(req, mockEnv(), deps);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.season.seasonNumber).toBe(1);
    });

    it("uses the session viewer instead of the season query viewerId", async () => {
      deps.requireViewer.mockResolvedValue({ viewer: { id: "session-viewer" }, res: null });
      mockOne.mockResolvedValueOnce(SITE);
      mockOne.mockResolvedValueOnce({
        id: "season-1",
        season_number: 1,
        title: "Season 1",
        status: "active",
        tiers_json: [],
      });
      mockOne.mockResolvedValueOnce({ current_level: 3, current_xp: 250, claimed_tiers: [] });

      await handleGetSeason(new Request("http://localhost/api/battlepass/season?site=streamer&viewerId=attacker"), mockEnv(), deps);

      expect(mockOne.mock.calls[2][1]).toEqual(["season-1", "session-viewer"]);
    });

    it("rejects milestone claims without a viewer session", async () => {
      deps.requireViewer.mockResolvedValue({ viewer: null, res: new Response(null, { status: 401 }) });
      const res = await handleClaimTierReward(new Request("http://localhost/api/battlepass/claim", {
        method: "POST",
        body: JSON.stringify({ seasonId: "season-1", tierLevel: 5, viewerId: "attacker" }),
      }), mockEnv(), deps);
      expect(res.status).toBe(401);
    });

    it("claims milestone tier reward when level requirement is met", async () => {
      mockOne.mockResolvedValueOnce({
        id: "season-1",
        site_id: "site-456",
        tiers_json: [
          { level: 5, xp_required: 500, reward: { type: "points_and_badge", title: "Bronze Badge", points: 250 } },
        ],
      }); // season
      mockOne.mockResolvedValueOnce({ id: "sv-1", balance: 500 }); // site_viewer
      mockOne.mockResolvedValueOnce({ id: "prog-1", current_level: 5, claimed_tiers: [] }); // progress
      mockOne.mockResolvedValueOnce({ id: "prog-1" }); // guarded claim update
      mockOne.mockResolvedValueOnce({ id: "sv-1", balance: 750 }); // credit update

      const req = new Request("http://localhost/api/battlepass/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seasonId: "season-1",
          tierLevel: 5,
          viewerId: "viewer-123",
        }),
      });

      const res = await handleClaimTierReward(req, mockEnv(), deps);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.tierLevel).toBe(5);
      expect(body.newBalance).toBe(750); // 500 + 250 = 750
      const rewardLedger = mockExec.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO credit_ledger"));
      expect(rewardLedger[0]).toContain("'earn'");
      expect(rewardLedger[1]).toEqual([
        "sv-1",
        250,
        "Battle Pass Level 5 Reward: Bronze Badge",
      ]);
    });

    it("awards XP and triggers level up when passing threshold", async () => {
      mockOne.mockResolvedValueOnce({
        id: "season-1",
        tiers_json: [
          { level: 1, xp_required: 100 },
          { level: 2, xp_required: 200 },
          { level: 3, xp_required: 300 },
        ],
      }); // season
      mockOne.mockResolvedValueOnce({ id: "sv-1" }); // site_viewer
      mockOne.mockResolvedValueOnce({ id: "prog-1", current_level: 1, current_xp: 50 }); // prog in tx

      const req = new Request("http://localhost/api/battlepass/award-xp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId: "site-456",
          viewerId: "viewer-123",
          xp: 200,
        }),
      });

      const res = await handleAwardXp(req, mockEnv(), deps);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.currentLevel).toBe(2); // 50 + 200 = 250 XP >= Level 2 (200 XP)
      expect(body.leveledUp).toBe(true);
    });
  });
});
