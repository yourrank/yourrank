import { describe, it, expect, mock, beforeEach } from "bun:test";
import {
  handleGetPredictions,
  handleCreatePrediction,
  handleLockPrediction,
  handleSettlePrediction,
  handleCancelPrediction,
} from "../handlers/predictions.js";
import {
  handleGetWheelConfig,
  handleUpdateWheelConfig,
  handleSpinWheel,
} from "../handlers/wheel.js";
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

describe("Predictions, Lucky Wheel & Seasonal Battle Pass", () => {
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
      requireViewer: mock().mockResolvedValue({ viewer: { id: "v-1" }, res: null }),
    };
  });

  // --- PREDICTIONS TESTS ---
  describe("Predictions Handlers", () => {
    it("lists predictions for a site", async () => {
      mockQuery.mockResolvedValueOnce([
        { id: "pred-1", title: "Win match?", status: "open", total_pool: 500, participant_count: 3 },
      ]);

      const req = new Request("http://localhost/api/predictions?siteId=site-456");
      const res = await handleGetPredictions(req, mockEnv(), deps);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.predictions.length).toBe(1);
    });

    it("locks an open prediction", async () => {
      mockOne.mockResolvedValueOnce({ id: "pred-1", status: "open" });

      const req = new Request("http://localhost/api/predictions/pred-1/lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ predictionId: "pred-1" }),
      });

      const res = await handleLockPrediction(req, mockEnv(), deps);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.status).toBe("locked");
    });

    it("creates a live prediction with custom options and bet limits", async () => {
      mockOne.mockResolvedValueOnce({
        id: "pred-1",
        title: "Clutch this 1v3 round?",
        options: [{ id: "yes", label: "Yes / نعم" }, { id: "no", label: "No / لا" }],
        min_bet: 20,
        max_bet: 500,
        status: "open",
        created_at: new Date().toISOString(),
      });

      const req = new Request("http://localhost/api/predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Clutch this 1v3 round?",
          minBet: 20,
          maxBet: 500,
          lockMinutes: 3,
        }),
      });

      const res = await handleCreatePrediction(req, mockEnv(), deps);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.prediction.title).toBe("Clutch this 1v3 round?");
      expect(body.prediction.min_bet).toBe(20);
    });

    it("settles a prediction and computes proportional payouts for winners", async () => {
      mockOne.mockResolvedValueOnce({
        id: "pred-1",
        site_id: "site-456",
        title: "Win match?",
        options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
        status: "open",
        total_pool: 1000,
      }); // find pred
      mockOne.mockResolvedValueOnce({ id: "pred-1" }); // in-tx atomic lock

      mockExec.mockResolvedValueOnce([
        { id: "bet-1", site_viewer_id: "sv-1", viewer_id: "v-1", option_id: "yes", amount: 100 },
        { id: "bet-2", site_viewer_id: "sv-2", viewer_id: "v-2", option_id: "yes", amount: 300 },
        { id: "bet-3", site_viewer_id: "sv-3", viewer_id: "v-3", option_id: "no", amount: 600 },
      ]); // find bets (Yes total = 400, Pool = 1000)

      const req = new Request("http://localhost/api/predictions/pred-1/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          predictionId: "pred-1",
          winningOptionId: "yes",
        }),
      });

      const res = await handleSettlePrediction(req, mockEnv(), deps);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.totalWinners).toBe(2);
      expect(body.totalPayout).toBe(1000); // 100/400*1000 = 250, 300/400*1000 = 750
    });

    it("rejects duplicate option labels on create", async () => {
      const req = new Request("http://localhost/api/predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Dup test",
          options: [{ id: "yes", label: "Yes" }, { id: "no", label: "yes" }],
          minBet: 10,
          maxBet: 500,
        }),
      });

      const res = await handleCreatePrediction(req, mockEnv(), deps);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("different");
      expect(mockOne).toHaveBeenCalledTimes(0);
    });

    it("rejects blank option labels on create", async () => {
      const req = new Request("http://localhost/api/predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Blank test",
          options: [{ id: "yes", label: "   " }, { id: "no", label: "No" }],
          minBet: 10,
          maxBet: 500,
        }),
      });

      const res = await handleCreatePrediction(req, mockEnv(), deps);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("label");
      expect(mockOne).toHaveBeenCalledTimes(0);
    });

    it("rejects a max bet below the min bet instead of silently coercing it", async () => {
      const req = new Request("http://localhost/api/predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Limits test", minBet: 5000, maxBet: 100 }),
      });

      const res = await handleCreatePrediction(req, mockEnv(), deps);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("Maximum bet");
      expect(mockOne).toHaveBeenCalledTimes(0);
    });

    it("rejects a winning option that does not belong to the prediction", async () => {
      mockOne.mockResolvedValueOnce({
        id: "pred-1",
        site_id: "site-456",
        title: "Win match?",
        options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
        status: "open",
        total_pool: 100,
      });

      const res = await handleSettlePrediction(new Request("http://localhost/api/predictions/pred-1/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ predictionId: "pred-1", winningOptionId: "maybe" }),
      }), mockEnv(), deps);

      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("does not belong");
    });

    it("aborts settlement when a concurrent request already resolved the prediction", async () => {
      mockOne.mockResolvedValueOnce({
        id: "pred-1",
        site_id: "site-456",
        title: "Win match?",
        options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
        status: "open",
        total_pool: 100,
      }); // find pred
      mockOne.mockResolvedValueOnce(null); // in-tx atomic lock loses the race

      const res = await handleSettlePrediction(new Request("http://localhost/api/predictions/pred-1/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ predictionId: "pred-1", winningOptionId: "yes" }),
      }), mockEnv(), deps);

      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("already been resolved");
    });

    it("cancels a prediction and refunds all bettors", async () => {
      mockOne.mockResolvedValueOnce({
        id: "pred-1",
        site_id: "site-456",
        title: "Match postponed",
        status: "open",
      });

      mockQuery.mockResolvedValueOnce([
        { id: "bet-1", site_viewer_id: "sv-1", amount: 100 },
        { id: "bet-2", site_viewer_id: "sv-2", amount: 200 },
      ]);

      const req = new Request("http://localhost/api/predictions/pred-1/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ predictionId: "pred-1" }),
      });

      const res = await handleCancelPrediction(req, mockEnv(), deps);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.status).toBe("cancelled");
    });
  });

  // --- LUCKY WHEEL TESTS ---
  describe("Lucky Wheel Handlers", () => {
    it("returns default wheel config when none exists", async () => {
      mockOne.mockResolvedValueOnce(SITE); // site
      mockOne.mockResolvedValueOnce(null); // no config row

      const req = new Request("http://localhost/api/games/wheel/config?site=streamer");
      const res = await handleGetWheelConfig(req, mockEnv(), deps);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.spinCost).toBe(50);
      expect(body.segments.length).toBe(8);
    });

    it("spins the wheel, deducts spin cost and awards prize", async () => {
      mockOne.mockResolvedValueOnce(SITE); // site
      mockOne.mockResolvedValueOnce({
        spin_cost: 30, // custom spin cost
        enabled: true,
        segments_json: [
          { id: "s1", label: "+100 Pts", type: "points", value: 100, color: "#2f6bff", weight: 100 },
        ],
      }); // wheel config
      mockOne.mockResolvedValueOnce({ id: "sv-1", balance: 100 }); // site_viewer
      mockOne.mockResolvedValueOnce({ id: "sv-1", balance: 170 }); // guarded debit/reward update

      const req = new Request("http://localhost/api/games/wheel/spin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site: "streamer",
          viewerId: "viewer-123",
        }),
      });

      const res = await handleSpinWheel(req, mockEnv(), deps);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.winningIndex).toBe(0);
      expect(body.segment.label).toBe("+100 Pts");
      expect(body.newBalance).toBe(170); // 100 - 30 + 100 = 170
    });

    it("rejects wheel spins without a viewer session", async () => {
      deps.requireViewer.mockResolvedValue({ viewer: null, res: new Response(null, { status: 401 }) });
      const res = await handleSpinWheel(new Request("http://localhost/api/games/wheel/spin", {
        method: "POST",
        body: JSON.stringify({ site: "streamer", viewerId: "attacker" }),
      }), mockEnv(), deps);
      expect(res.status).toBe(401);
    });

    it("returns insufficient credits and writes no spin rows when the guarded debit updates zero rows", async () => {
      mockOne.mockResolvedValueOnce(SITE);
      mockOne.mockResolvedValueOnce({ spin_cost: 30, enabled: true, segments_json: [{ id: "s1", label: "+100", type: "points", value: 100, weight: 100 }] });
      mockOne.mockResolvedValueOnce({ id: "sv-1", balance: 100 });
      mockOne.mockResolvedValueOnce(null); // guarded debit/reward update

      const res = await handleSpinWheel(new Request("http://localhost/api/games/wheel/spin", {
        method: "POST",
        body: JSON.stringify({ site: "streamer", viewerId: "attacker" }),
      }), mockEnv(), deps);

      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("Insufficient credits");
      expect(mockExec).toHaveBeenCalledTimes(0);
    });

    it("updates wheel config with custom spin cost and segments", async () => {
      mockOne.mockResolvedValueOnce({
        spin_cost: 75,
        enabled: true,
        segments_json: [{ id: "s1", label: "Prize A" }, { id: "s2", label: "Prize B" }],
      });

      const req = new Request("http://localhost/api/games/wheel/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId: "site-456",
          spinCost: 75,
          enabled: true,
          segments: [{ id: "s1", label: "Prize A", type: "points", value: 50, weight: 10 }, { id: "s2", label: "Prize B", type: "points", value: 100, weight: 10 }],
        }),
      });

      const res = await handleUpdateWheelConfig(req, mockEnv(), deps);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.config.spin_cost).toBe(75);
    });
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
