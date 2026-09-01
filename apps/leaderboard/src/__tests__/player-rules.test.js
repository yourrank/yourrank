import { describe, expect, it } from "bun:test";
import { normalizePlayerName, rankField, sortPlayersForRanking, truncatePlayerName, validateAndNormalizePlayers } from "../player-rules.js";

describe("player rules", () => {
  it("normalizes identity consistently", () => {
    expect(normalizePlayerName("  Alice   Smith ")).toBe("alice smith");
  });

  it("truncates names without splitting graphemes", () => {
    expect(truncatePlayerName("👩‍🚀Rocket", 1)).toBe("👩‍🚀");
  });

  it("rejects duplicate normalized names", () => {
    const result = validateAndNormalizePlayers([{ name: "Alice  Smith" }, { name: " alice smith " }]);
    expect(result.code).toBe("duplicate_player");
  });

  it("rejects negative, non-finite, oversized, and fractional integer values", () => {
    expect(validateAndNormalizePlayers([{ name: "A", wagered: -1 }]).code).toBe("invalid_player_number");
    expect(validateAndNormalizePlayers([{ name: "A", score: "nope" }]).code).toBe("invalid_player_number");
    expect(validateAndNormalizePlayers([{ name: "A", prize: 1e15 + 1 }]).code).toBe("invalid_player_number");
    expect(validateAndNormalizePlayers([{ name: "A", hands: 1.5 }]).code).toBe("invalid_player_number");
  });

  it("keeps score independent from legacy amount data", () => {
    const result = validateAndNormalizePlayers([{ name: "A", wagered: 12, prize: 5 }]);
    expect(result.players[0]).toMatchObject({ wagered: 12, score: 0, hands: 0, netProfit: -7, change: 0 });

    const scoreOnly = validateAndNormalizePlayers([{ name: "Score only", score: 44 }]);
    expect(scoreOnly.players[0]).toMatchObject({ wagered: 0, score: 44 });
  });

  it("fails missing, null, malformed, and unknown ranking configuration toward score", () => {
    expect(rankField()).toBe("score");
    expect(rankField(null)).toBe("score");
    expect(rankField("not-a-rank")).toBe("score");
    expect(rankField({})).toBe("score");
  });

  it("sorts by score by default while preserving explicit wagered compatibility", () => {
    const players = [
      { name: "Amount leader", score: 1, wagered: 100 },
      { name: "Score leader", score: 20, wagered: 2 },
    ];
    expect(sortPlayersForRanking(players).map((p) => p.name)).toEqual(["Score leader", "Amount leader"]);
    expect(sortPlayersForRanking(players, "wagered").map((p) => p.name)).toEqual(["Amount leader", "Score leader"]);
    expect(sortPlayersForRanking([{ name: "B", score: 2 }, { name: "A", score: 2 }], "score").map((p) => p.name)).toEqual(["A", "B"]);
  });
});
