import { describe, it, expect, mock, beforeEach } from "bun:test";
import {
  handleGetDailyQuests,
  handleClaimQuestReward,
  handleTrackQuestProgress,
} from "../handlers/quests.js";
import {
  handleGetDuels,
  handleCreateDuel,
  handleAcceptDuel,
  handleDeclineDuel,
} from "../handlers/duels.js";
import {
  handleGetTournaments,
  handleCreateTournament,
  handleUpdateMatchScore,
  handleGetBracket,
} from "../handlers/tournaments.js";

function mockEnv() {
  return {
    DB: {},
    JWT_SECRET: "test-secret-at-least-32-chars-long!",
  };
}

const USER = { id: "user-123", email: "streamer@test.com", plan: "pro" };
const SITE = { id: "site-456", user_id: "user-123", slug: "streamer", name: "Streamer Hub" };

describe("Quests, Duels & Tournaments Suite", () => {
  let mockOne;
  let mockQuery;
  let mockExec;
  let mockLogAudit;
  let mockWithTransaction;
  let deps;

  beforeEach(() => {
    mockOne = mock();
    mockQuery = mock();
    mockExec = mock();
    mockLogAudit = mock();
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
      withTransaction: mockWithTransaction,
      requireViewer: mock().mockResolvedValue({ viewer: { id: "v-1" }, res: null }),
      rateLimit: mock().mockResolvedValue({ ok: true }),
      clientIp: mock().mockReturnValue("127.0.0.1"),
      requireSiteCapabilityImpl: mock().mockResolvedValue({ res: null }),
    };
  });

  // Records which statements would be committed by a transaction wrapper. Used
  // to verify that a thrown conflict does not commit partial state.
  function recordingTransaction() {
    const committed = [];
    const tx = async (fn) => {
      const pending = [];
      const txProxy = {
        one: async (...args) => {
          const res = await mockOne(...args);
          pending.push({ sql: args[0], params: args[1], res });
          return res;
        },
        unsafe: async (...args) => {
          const res = await mockExec(...args);
          pending.push({ sql: args[0], params: args[1], res });
          return res;
        },
      };
      const result = await fn(txProxy);
      committed.push(...pending);
      return result;
    };
    return { tx, committed };
  }

  // --- DAILY QUESTS & STREAKS ---
  describe("Daily Quests & Streaks", () => {
    it("returns daily quests and calculates streak multiplier for viewer", async () => {
      mockOne.mockResolvedValueOnce(SITE); // site
      mockQuery.mockResolvedValueOnce([
        { id: "q-1", quest_key: "watch_30m", title: "Watch stream", target_count: 30, reward_xp: 50, reward_points: 20 },
      ]); // quests
      mockQuery.mockResolvedValueOnce([
        { quest_id: "q-1", current_progress: 15, completed: false, claimed: false },
      ]); // viewer progress
      mockOne.mockResolvedValueOnce({ current_streak: 5, longest_streak: 7 }); // streak

      const req = new Request("http://localhost/api/quests/daily?site=streamer&viewerId=v-1");
      const res = await handleGetDailyQuests(req, mockEnv(), deps);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.quests.length).toBe(1);
      expect(body.quests[0].progress).toBe(15);
      expect(body.streak.currentStreak).toBe(5);
      expect(body.streak.multiplier).toBe(1.2); // 1 + (5-1)*0.05 = 1.20
    });

    it("claims completed quest reward and awards XP & points", async () => {
      mockOne.mockResolvedValueOnce({ id: "q-1", site_id: "site-456", title: "Watch stream", reward_xp: 50, reward_points: 20 }); // quest
      mockOne.mockResolvedValueOnce({ id: "sv-1", balance: 100 }); // site_viewer
      mockOne.mockResolvedValueOnce({ id: "vq-1", current_progress: 30, completed: true, claimed: false }); // vq
      mockOne.mockResolvedValueOnce({ id: "vq-1" }); // guarded claim update
      mockOne.mockResolvedValueOnce({ id: "sv-1", balance: 120 }); // credit update

      const req = new Request("http://localhost/api/quests/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questId: "q-1", viewerId: "v-1" }),
      });

      const res = await handleClaimQuestReward(req, mockEnv(), deps);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.rewardXp).toBe(50);
      expect(body.newBalance).toBe(120);
    });

    it("tracks quest progress and marks completed when target reached", async () => {
      mockOne.mockResolvedValueOnce({ id: "q-1", target_count: 5 }); // quest
      mockOne.mockResolvedValueOnce({ id: "sv-1" }); // site_viewer
      mockOne.mockResolvedValueOnce({ id: "vq-1", current_progress: 3, completed: false }); // vq in tx

      const req = new Request("http://localhost/api/quests/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId: "site-456", viewerId: "v-1", questKey: "chat_5_msgs", amount: 2 }),
      });

      const res = await handleTrackQuestProgress(req, mockEnv(), deps);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.progress).toBe(5);
      expect(body.completed).toBe(true);
    });

    it("rejects quest claims without a viewer session", async () => {
      deps.requireViewer.mockResolvedValue({ viewer: null, res: new Response(null, { status: 401 }) });
      const res = await handleClaimQuestReward(new Request("http://localhost/api/quests/claim", {
        method: "POST",
        body: JSON.stringify({ questId: "q-1", viewerId: "attacker" }),
      }), mockEnv(), deps);
      expect(res.status).toBe(401);
    });

    it("uses the session viewer instead of the claim body viewerId", async () => {
      deps.requireViewer.mockResolvedValue({ viewer: { id: "session-viewer" }, res: null });
      mockOne.mockResolvedValueOnce({ id: "q-1", site_id: "site-456", title: "Watch stream", reward_xp: 50, reward_points: 20 });
      mockOne.mockResolvedValueOnce({ id: "sv-1", balance: 100 });
      mockOne.mockResolvedValueOnce({ id: "vq-1", current_progress: 30, completed: true, claimed: false });

      await handleClaimQuestReward(new Request("http://localhost/api/quests/claim", {
        method: "POST",
        body: JSON.stringify({ questId: "q-1", viewerId: "attacker" }),
      }), mockEnv(), deps);

      expect(mockOne.mock.calls[1][1]).toEqual(["site-456", "session-viewer"]);
      expect(mockOne.mock.calls[2][1]).toEqual(["q-1", "session-viewer"]);
    });

    it("rejects quest progress without a viewer session", async () => {
      deps.requireViewer.mockResolvedValue({ viewer: null, res: new Response(null, { status: 401 }) });
      const res = await handleTrackQuestProgress(new Request("http://localhost/api/quests/progress", {
        method: "POST",
        body: JSON.stringify({ siteId: "site-456", viewerId: "attacker", questKey: "chat_5_msgs" }),
      }), mockEnv(), deps);
      expect(res.status).toBe(401);
    });
  });

  // --- VIEWER 1v1 DUELS ---
  describe("Viewer 1v1 Duels", () => {
    it("lists active duels for a site", async () => {
      mockOne.mockResolvedValueOnce(SITE);
      mockQuery.mockResolvedValueOnce([
        { id: "duel-1", wager_amount: 50, status: "pending", challenger_name: "alice", target_name: "bob" },
      ]);

      const req = new Request("http://localhost/api/duels/active?site=streamer");
      const res = await handleGetDuels(req, mockEnv(), deps);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.duels.length).toBe(1);
      const duelsSql = mockQuery.mock.calls[0][0];
      expect(duelsSql).toContain("vc.kick_username AS challenger_name");
      expect(duelsSql).toContain("vt.kick_username AS target_name");
      expect(duelsSql).toContain("vw.kick_username AS winner_name");
      expect(duelsSql).not.toContain("vc.username");
      expect(duelsSql).not.toContain("vt.username");
      expect(duelsSql).not.toContain("vw.username");
    });

    it("creates a duel challenge and locks challenger wager", async () => {
      mockOne.mockResolvedValueOnce(SITE); // site
      mockOne.mockResolvedValueOnce({ id: "sv-1", balance: 100 }); // challenger sv
      mockOne.mockResolvedValueOnce({ id: "v-2", username: "rival" }); // target viewer
      mockOne.mockResolvedValueOnce({ id: "sv-2", balance: 100 }); // target sv
      mockOne.mockResolvedValueOnce({ id: "sv-1", balance: 50 }); // guarded debit update
      mockOne.mockResolvedValueOnce({ id: "duel-1", wager_amount: 50, status: "pending" }); // insert duel in tx

      const req = new Request("http://localhost/api/duels/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site: "streamer",
          challengerViewerId: "v-1",
          targetUsername: "rival",
          wagerAmount: 50,
        }),
      });

      const res = await handleCreateDuel(req, mockEnv(), deps);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.duel.wager_amount).toBe(50);
    });

    it("accepts a duel, executes provably fair roll and awards 2x pot to winner", async () => {
      deps.requireViewer.mockResolvedValue({ viewer: { id: "v-2" }, res: null });
      mockOne.mockResolvedValueOnce({
        id: "duel-1",
        site_id: "site-456",
        challenger_viewer_id: "v-1",
        challenger_site_viewer_id: "sv-1",
        target_viewer_id: "v-2",
        target_site_viewer_id: "sv-2",
        wager_amount: 50,
        status: "pending",
        challenger_name: "alice",
        target_name: "bob",
      }); // find duel
      mockOne.mockResolvedValueOnce({ id: "sv-2", balance: 100 }); // target sv balance
      mockOne.mockResolvedValueOnce({ id: "sv-2", balance: 50 }); // guarded debit update

      const req = new Request("http://localhost/api/duels/duel-1/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duelId: "duel-1", viewerId: "v-2" }),
      });

      const res = await handleAcceptDuel(req, mockEnv(), deps);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.totalPot).toBe(100);
      expect(body.winnerName).toBeTruthy();
      expect(body.rollDetails.challenger_name).toBe("alice");
      expect(body.rollDetails.target_name).toBe("bob");
      const acceptSql = mockOne.mock.calls[0][0];
      expect(acceptSql).toContain("vc.kick_username AS challenger_name");
      expect(acceptSql).toContain("vt.kick_username AS target_name");
      expect(acceptSql).not.toContain("vc.username");
      expect(acceptSql).not.toContain("vt.username");
    });

    it("declines a duel and refunds challenger wager", async () => {
      deps.requireViewer.mockResolvedValue({ viewer: { id: "v-2" }, res: null });
      mockOne.mockResolvedValueOnce({
        id: "duel-1",
        challenger_site_viewer_id: "sv-1",
        challenger_viewer_id: "v-1",
        target_viewer_id: "v-2",
        wager_amount: 50,
        status: "pending",
      });

      const req = new Request("http://localhost/api/duels/duel-1/decline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duelId: "duel-1", viewerId: "v-2" }),
      });

      const res = await handleDeclineDuel(req, mockEnv(), deps);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.status).toBe("declined");
    });

    it("rejects duel actions without a viewer session", async () => {
      deps.requireViewer.mockResolvedValue({ viewer: null, res: new Response(null, { status: 401 }) });
      for (const handler of [handleCreateDuel, handleAcceptDuel, handleDeclineDuel]) {
        const res = await handler(new Request("http://localhost/api/duels/action", {
          method: "POST",
          body: JSON.stringify({ site: "streamer", duelId: "duel-1", viewerId: "attacker", challengerViewerId: "attacker", targetUsername: "rival", wagerAmount: 10 }),
        }), mockEnv(), deps);
        expect(res.status).toBe(401);
      }
    });

    it("returns insufficient credits and writes no duel ledger when the guarded debit updates zero rows", async () => {
      mockOne.mockResolvedValueOnce(SITE);
      mockOne.mockResolvedValueOnce({ id: "sv-1", balance: 100 });
      mockOne.mockResolvedValueOnce({ id: "v-2", username: "rival" });
      mockOne.mockResolvedValueOnce({ id: "sv-2", balance: 100 });
      mockOne.mockResolvedValueOnce(null); // guarded debit update

      const res = await handleCreateDuel(new Request("http://localhost/api/duels/create", {
        method: "POST",
        body: JSON.stringify({ site: "streamer", challengerViewerId: "attacker", targetUsername: "rival", wagerAmount: 50 }),
      }), mockEnv(), deps);

      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("Insufficient credits");
      expect(mockExec).toHaveBeenCalledTimes(0);
    });

    it("returns insufficient credits and writes no accept ledger when the guarded debit updates zero rows", async () => {
      deps.requireViewer.mockResolvedValue({ viewer: { id: "v-2" }, res: null });
      mockOne.mockResolvedValueOnce({
        id: "duel-1",
        site_id: "site-456",
        challenger_viewer_id: "v-1",
        challenger_site_viewer_id: "sv-1",
        target_viewer_id: "v-2",
        target_site_viewer_id: "sv-2",
        wager_amount: 50,
        status: "pending",
        challenger_name: "alice",
        target_name: "bob",
      });
      mockOne.mockResolvedValueOnce({ id: "sv-2", balance: 100 });
      mockOne.mockResolvedValueOnce(null); // guarded debit update

      const res = await handleAcceptDuel(new Request("http://localhost/api/duels/duel-1/accept", {
        method: "POST",
        body: JSON.stringify({ duelId: "duel-1", viewerId: "attacker" }),
      }), mockEnv(), deps);

      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("Insufficient credits");
      expect(mockExec).toHaveBeenCalledTimes(0);
    });
  });

  // --- TOURNAMENT BRACKETS ---
  describe("Tournament Brackets", () => {
    it("lists tournaments for a site", async () => {
      mockOne.mockResolvedValueOnce(SITE);
      mockQuery.mockResolvedValueOnce([
        { id: "tourn-1", title: "Valorant 1v1", game_name: "Valorant", bracket_size: 8, status: "active" },
      ]);

      const req = new Request("http://localhost/api/tournaments?site=streamer");
      const res = await handleGetTournaments(req, mockEnv(), deps);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.tournaments.length).toBe(1);
    });

    it("creates an 8-player single-elimination tournament bracket", async () => {
      mockOne.mockResolvedValueOnce({
        id: "tourn-1",
        title: "Valorant 1v1",
        game_name: "Valorant",
        bracket_size: 8,
        status: "active",
      }); // insert tourn in tx

      const req = new Request("http://localhost/api/tournaments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Valorant 1v1",
          gameName: "Valorant",
          bracketSize: 8,
          participants: ["Alice", "Bob", "Charlie", "David", "Eve", "Frank", "Grace", "Heidi"],
        }),
      });

      const res = await handleCreateTournament(req, mockEnv(), deps);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.tournament.bracket_size).toBe(8);
    });

    it("updates match score and advances winner to next round", async () => {
      mockOne.mockResolvedValueOnce({
        id: "match-1",
        tournament_id: "tourn-1",
        round_number: 1,
        match_index: 0,
        player1_name: "Alice",
        player2_name: "Bob",
        bracket_size: 8,
        site_id: "site-456",
        site_user_id: "owner-1",
      }); // find match
      mockOne.mockResolvedValueOnce({ player1_name: "TBD", status: "pending" }); // downstream slot

      const req = new Request("http://localhost/api/tournaments/tourn-1/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchId: "match-1",
          player1Score: 3,
          player2Score: 1,
        }),
      });

      const res = await handleUpdateMatchScore(req, mockEnv(), deps);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.winnerName).toBe("Alice");
      expect(body.isFinals).toBe(false);
    });

    it("lets a board-managing team member update a match score", async () => {
      deps.requireUser = mock().mockResolvedValue({
        user: { id: "moderator-1", email: "moderator@test.com" },
        res: null,
      });
      deps.requireSiteCapabilityImpl = mock().mockResolvedValue({ res: null, role: "moderator" });
      mockOne.mockResolvedValueOnce({
        id: "match-1",
        tournament_id: "tourn-1",
        round_number: 1,
        match_index: 0,
        player1_name: "Alice",
        player2_name: "Bob",
        bracket_size: 8,
        site_id: "site-456",
        site_user_id: "owner-1",
      });
      mockOne.mockResolvedValueOnce({ player1_name: "TBD", status: "pending" }); // downstream slot

      const res = await handleUpdateMatchScore(
        new Request("http://localhost/api/tournaments/tourn-1/score", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matchId: "match-1", player1Score: 3, player2Score: 1 }),
        }),
        mockEnv(),
        deps
      );

      expect(res.status).toBe(200);
      expect(deps.requireSiteCapabilityImpl).toHaveBeenCalledWith(
        { id: "moderator-1", email: "moderator@test.com" },
        { id: "site-456", user_id: "owner-1" },
        "canRoleManageBoard"
      );
    });

    it("rejects a user without a site role from updating a match score", async () => {
      deps.requireSiteCapabilityImpl = mock().mockResolvedValue({
        res: new Response("Forbidden", { status: 403 }),
      });
      mockOne.mockResolvedValueOnce({
        id: "match-1",
        tournament_id: "tourn-1",
        round_number: 1,
        match_index: 0,
        player1_name: "Alice",
        player2_name: "Bob",
        bracket_size: 8,
        site_id: "site-456",
        site_user_id: "owner-1",
      });

      const res = await handleUpdateMatchScore(
        new Request("http://localhost/api/tournaments/tourn-1/score", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matchId: "match-1", player1Score: 3, player2Score: 1 }),
        }),
        mockEnv(),
        deps
      );

      expect(res.status).toBe(403);
      expect(mockExec).not.toHaveBeenCalled();
    });

    it("keeps nonexistent matches indistinguishable from unauthorized matches", async () => {
      mockOne.mockResolvedValueOnce(null);

      const res = await handleUpdateMatchScore(
        new Request("http://localhost/api/tournaments/tourn-1/score", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matchId: "missing", player1Score: 3, player2Score: 1 }),
        }),
        mockEnv(),
        deps
      );

      expect(res.status).toBe(404);
      expect(await res.text()).toContain("Match not found or unauthorized.");
      expect(deps.requireSiteCapabilityImpl).not.toHaveBeenCalled();
    });

    it("crowns the champion after a final match score update", async () => {
      mockOne.mockResolvedValueOnce({
        id: "match-final",
        tournament_id: "tourn-1",
        round_number: 3,
        match_index: 0,
        player1_name: "Alice",
        player2_name: "Bob",
        bracket_size: 8,
        site_id: "site-456",
        site_user_id: "owner-1",
      }); // find final match

      const req = new Request("http://localhost/api/tournaments/tourn-1/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: "match-final", player1Score: 2, player2Score: 1 }),
      });

      const res = await handleUpdateMatchScore(req, mockEnv(), deps);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.isFinals).toBe(true);
      expect(body.winnerName).toBe("Alice");
      expect(mockExec).toHaveBeenCalled();
      const tournUpdate = mockExec.mock.calls.find((call) => call[0].includes("UPDATE tournaments"));
      expect(tournUpdate).toBeTruthy();
      expect(tournUpdate[1]).toEqual(["Alice", "tourn-1"]);
    });

    it("returns 409 and does not update the current match when the downstream slot is already filled", async () => {
      mockOne.mockResolvedValueOnce({
        id: "match-1",
        tournament_id: "tourn-1",
        round_number: 1,
        match_index: 0,
        player1_name: "Alice",
        player2_name: "Bob",
        bracket_size: 8,
        site_id: "site-456",
        site_user_id: "owner-1",
      }); // find match
      mockOne.mockResolvedValueOnce({ player1_name: "Charlie", status: "pending" }); // downstream already filled

      const req = new Request("http://localhost/api/tournaments/tourn-1/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: "match-1", player1Score: 3, player2Score: 1 }),
      });

      const res = await handleUpdateMatchScore(req, mockEnv(), deps);
      expect(res.status).toBe(409);
      expect(await res.text()).toContain("Downstream match has already progressed.");
      expect(mockExec).not.toHaveBeenCalled();
    });

    it("rolls back the current match update when the final champion update conflicts", async () => {
      const { tx, committed } = recordingTransaction();
      deps.withTransaction = tx;
      mockExec.mockReset();
      mockExec.mockResolvedValueOnce([{}]); // matchUpdate succeeds
      mockExec.mockResolvedValueOnce([]); // tournUpdate conflict

      mockOne.mockResolvedValueOnce({
        id: "match-final",
        tournament_id: "tourn-1",
        round_number: 3,
        match_index: 0,
        player1_name: "Alice",
        player2_name: "Bob",
        bracket_size: 8,
        site_id: "site-456",
        site_user_id: "owner-1",
      });

      const req = new Request("http://localhost/api/tournaments/tourn-1/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: "match-final", player1Score: 2, player2Score: 1 }),
      });

      const res = await handleUpdateMatchScore(req, mockEnv(), deps);
      expect(res.status).toBe(409);
      expect(await res.text()).toContain("Tournament already has a champion.");
      const matchUpdates = committed.filter((stmt) =>
        stmt.sql.includes("UPDATE tournament_matches") && stmt.sql.includes("player1_score")
      );
      expect(matchUpdates.length).toBe(0);
    });

    it("rolls back the current match update when downstream advancement conflicts after the pre-check", async () => {
      const { tx, committed } = recordingTransaction();
      deps.withTransaction = tx;
      mockExec.mockReset();
      mockExec.mockResolvedValueOnce([{}]); // matchUpdate succeeds
      mockExec.mockResolvedValueOnce([]); // nextUpdate conflict

      mockOne.mockResolvedValueOnce({
        id: "match-1",
        tournament_id: "tourn-1",
        round_number: 1,
        match_index: 0,
        player1_name: "Alice",
        player2_name: "Bob",
        bracket_size: 8,
        site_id: "site-456",
        site_user_id: "owner-1",
      }); // find match
      mockOne.mockResolvedValueOnce({ player1_name: "TBD", status: "pending" }); // downstream pre-check passes

      const req = new Request("http://localhost/api/tournaments/tourn-1/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: "match-1", player1Score: 3, player2Score: 1 }),
      });

      const res = await handleUpdateMatchScore(req, mockEnv(), deps);
      expect(res.status).toBe(409);
      const matchUpdates = committed.filter((stmt) =>
        stmt.sql.includes("UPDATE tournament_matches") && stmt.sql.includes("player1_score")
      );
      expect(matchUpdates.length).toBe(0);
    });

    it("returns bracket tree for spectator viewing", async () => {
      mockOne.mockResolvedValueOnce({ id: "tourn-1", title: "Valorant 1v1", bracket_size: 8 });
      mockQuery.mockResolvedValueOnce([
        { id: "m-1", round_number: 1, match_index: 0, player1_name: "Alice", player2_name: "Bob" },
      ]);

      const req = new Request("http://localhost/api/tournaments/tourn-1/bracket");
      const res = await handleGetBracket(req, mockEnv(), deps);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.matches.length).toBe(1);
    });
  });
});
