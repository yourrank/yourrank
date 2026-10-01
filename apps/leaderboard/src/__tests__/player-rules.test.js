import { describe, expect, it } from "bun:test";
import { normalizePlayerName, rankField, sortPlayersForRanking, truncatePlayerName, validateAndNormalizePlayers, mergePlayerPatch } from "../player-rules.js";

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
    expect(validateAndNormalizePlayers([{ name: "A", amount: -1 }]).code).toBe("invalid_player_number");
    expect(validateAndNormalizePlayers([{ name: "A", score: "nope" }]).code).toBe("invalid_player_number");
    expect(validateAndNormalizePlayers([{ name: "A", prize: 1e15 + 1 }]).code).toBe("invalid_player_number");
  });

  it("keeps score independent from amount data", () => {
    const result = validateAndNormalizePlayers([{ name: "A", amount: 12, prize: 5 }]);
    expect(result.players[0]).toMatchObject({ amount: 12, score: 0, change: 0 });

    const scoreOnly = validateAndNormalizePlayers([{ name: "Score only", score: 44 }]);
    expect(scoreOnly.players[0]).toMatchObject({ amount: 0, score: 44 });
  });

  it("fails missing, null, malformed, and unknown ranking configuration toward score", () => {
    expect(rankField()).toBe("score");
    expect(rankField(null)).toBe("score");
    expect(rankField("not-a-rank")).toBe("score");
    expect(rankField({})).toBe("score");
  });

  it("sorts by score by default and honors explicit amount ranking", () => {
    const players = [
      { name: "Amount leader", score: 1, amount: 100 },
      { name: "Score leader", score: 20, amount: 2 },
    ];
    expect(sortPlayersForRanking(players).map((p) => p.name)).toEqual(["Score leader", "Amount leader"]);
    expect(sortPlayersForRanking(players, "amount").map((p) => p.name)).toEqual(["Amount leader", "Score leader"]);
    expect(sortPlayersForRanking([{ name: "B", score: 2 }, { name: "A", score: 2 }], "score").map((p) => p.name)).toEqual(["A", "B"]);
  });
});

describe("mergePlayerPatch", () => {
  const existing = [
    { name: "Alice", amount: 100, prize: 5, score: 9, change: 2 },
    { name: "Bob", amount: 50, prize: 0, score: 4, change: 0 },
  ];

  it("overlays only the provided fields on a normalized-name match", () => {
    const { players, updated, created } = mergePlayerPatch(existing, [{ name: "  ALICE ", score: 20 }]);
    expect(updated).toBe(1);
    expect(created).toBe(0);
    expect(players[0]).toMatchObject({ name: "  ALICE ", score: 20, amount: 100, prize: 5 });
    expect(players[1]).toEqual(existing[1]);
    expect(existing[0].score).toBe(9);
  });

  it("appends unmatched patch players in patch order", () => {
    const { players, updated, created } = mergePlayerPatch(existing, [
      { name: "Carol", score: 7 },
      { name: "Dave", amount: 3 },
    ]);
    expect(updated).toBe(0);
    expect(created).toBe(2);
    expect(players.map((p) => p.name)).toEqual(["Alice", "Bob", "Carol", "Dave"]);
    expect(players[2]).toEqual({ name: "Carol", score: 7 });
  });

  it("updates and creates in one patch", () => {
    const { players, updated, created } = mergePlayerPatch(existing, [
      { name: "bob", prize: 10 },
      { name: "Eve", score: 1 },
    ]);
    expect({ updated, created }).toEqual({ updated: 1, created: 1 });
    expect(players[1]).toMatchObject({ name: "bob", prize: 10, amount: 50 });
    expect(players[2].name).toBe("Eve");
  });
});
