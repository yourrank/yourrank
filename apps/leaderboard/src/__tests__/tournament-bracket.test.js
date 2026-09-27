// Pure bracket engine: seeding order, BYE placement and auto-advancement.
import { describe, expect, it } from "bun:test";
import {
  BYE,
  MIN_BRACKET_PARTICIPANTS,
  bracketSeedOrder,
  buildBracket,
  canCorrectMatch,
  isBye,
} from "../lib/tournament-bracket.js";

const names = (n) => Array.from({ length: n }, (_, i) => `P${i + 1}`);
const inRound = (matches, round) => matches.filter((m) => m.round_number === round);

describe("tournament bracket engine", () => {
  it("produces the standard seed order for each supported size", () => {
    expect(bracketSeedOrder(2)).toEqual([1, 2]);
    expect(bracketSeedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(bracketSeedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(bracketSeedOrder(16)).toEqual([1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]);
    expect(bracketSeedOrder(32)).toHaveLength(32);
    expect(bracketSeedOrder(32).slice(0, 4)).toEqual([1, 32, 16, 17]);
  });

  it("8-cap with 2 players cascades BYEs to a real final", () => {
    const matches = buildBracket(names(2), 8);
    const r1 = inRound(matches, 1);
    expect(r1.filter((m) => (isBye(m.player1_name) ? 1 : 0) + (isBye(m.player2_name) ? 1 : 0) === 1)).toHaveLength(2);
    expect(r1.filter((m) => isBye(m.player1_name) && isBye(m.player2_name))).toHaveLength(2);
    const r2 = inRound(matches, 2);
    expect(r2.every((m) => m.status === "completed")).toBe(true);
    const final = inRound(matches, 3)[0];
    expect(final.status).toBe("pending");
    expect([final.player1_name, final.player2_name].sort()).toEqual(["P1", "P2"]);
  });

  it("8-cap with 5 players leaves exactly one real round-1 match and no BYE-vs-BYE", () => {
    const matches = buildBracket(names(5), 8);
    const r1 = inRound(matches, 1);
    const byeMatches = r1.filter((m) => isBye(m.player1_name) || isBye(m.player2_name));
    expect(byeMatches).toHaveLength(3);
    expect(r1.filter((m) => isBye(m.player1_name) && isBye(m.player2_name))).toHaveLength(0);
    expect(r1.filter((m) => m.status === "pending")).toHaveLength(1);
    const real = r1.find((m) => m.status === "pending");
    expect([real.player1_name, real.player2_name].sort()).toEqual(["P4", "P5"]);
    const realNames = r1.flatMap((m) => [m.player1_name, m.player2_name]).filter((n) => !isBye(n));
    expect(realNames.sort()).toEqual(["P1", "P2", "P3", "P4", "P5"]);
  });

  it("8-cap with 8 players has no BYEs and nothing completed", () => {
    const matches = buildBracket(names(8), 8);
    expect(matches.some((m) => isBye(m.player1_name) || isBye(m.player2_name))).toBe(false);
    expect(matches.every((m) => m.status === "pending")).toBe(true);
  });

  it("rejects participant counts outside 2..bracketSize", () => {
    expect(() => buildBracket(names(1), 8)).toThrow();
    expect(() => buildBracket(names(9), 8)).toThrow();
    expect(MIN_BRACKET_PARTICIPANTS).toBe(2);
  });

  it("treats a player literally named BYE as a normal participant", () => {
    const matches = buildBracket(["BYE", "Alice"], 4);
    const r1 = inRound(matches, 1);
    // Both slots are real-vs-sentinel matches; the human "BYE" advances as a
    // regular player, and no BYE-vs-BYE match exists.
    expect(r1).toHaveLength(2);
    expect(r1.every((m) => m.status === "completed")).toBe(true);
    expect(r1.every((m) => (isBye(m.player1_name) || isBye(m.player2_name)) && !(isBye(m.player1_name) && isBye(m.player2_name)))).toBe(true);
    expect(r1.map((m) => m.winner_name).sort()).toEqual(["Alice", "BYE"]);
    const final = inRound(matches, 2)[0];
    expect(final.status).toBe("pending");
    expect([final.player1_name, final.player2_name].sort()).toEqual(["Alice", "BYE"]);
  });

  it("never leaves a pending match with a BYE, for every fill of every size", () => {
    for (const size of [4, 8, 16]) {
      for (let n = 2; n <= size; n++) {
        const matches = buildBracket(names(n), size);
        const pending = matches.filter((m) => m.status === "pending");
        for (const match of pending) {
          expect(isBye(match.player1_name)).toBe(false);
          expect(isBye(match.player2_name)).toBe(false);
        }
      }
    }
  });
});

describe("canCorrectMatch", () => {
  const row = (over) => ({
    id: over.id ?? `m-${over.round_number}-${over.match_index}`,
    round_number: over.round_number ?? 1,
    match_index: over.match_index ?? 0,
    player1_name: "A",
    player2_name: "B",
    player1_score: 0,
    player2_score: 0,
    status: "pending",
    winner_name: null,
    ...over,
  });
  const played = (over) => row({ status: "completed", winner_name: "A", player1_score: 2, player2_score: 1, ...over });

  it("allows correcting the final", () => {
    const matches = [played({ round_number: 3, match_index: 0 })];
    const decision = canCorrectMatch(matches, matches[0]);
    expect(decision.ok).toBe(true);
    expect(decision.path).toEqual([]);
  });

  it("allows correcting when the next match is still pending", () => {
    const matches = [
      played({ id: "m-1", round_number: 1, match_index: 0 }),
      row({ id: "m-2", round_number: 2, match_index: 0, player1_name: "A", player2_name: "TBD" }),
    ];
    const decision = canCorrectMatch(matches, matches[0]);
    expect(decision.ok).toBe(true);
    expect(decision.path).toEqual([
      { id: "m-2", round_number: 2, match_index: 0, slotColumn: "player1_name", byeResolved: false },
    ]);
  });

  it("feeds even-index winners into player1 and odd-index into player2", () => {
    const matches = [
      played({ id: "m-1", round_number: 1, match_index: 1 }),
      row({ id: "m-2", round_number: 2, match_index: 0, player1_name: "X", player2_name: "A" }),
    ];
    const decision = canCorrectMatch(matches, matches[0]);
    expect(decision.ok).toBe(true);
    expect(decision.path[0].slotColumn).toBe("player2_name");
  });

  it("walks a chain of BYE-resolved matches to the first pending one", () => {
    // 16-player bracket: r1m0 -> r2m0 -> r3m0 -> r4m0(final, pending).
    const matches = [
      played({ id: "m-1", round_number: 1, match_index: 0 }),
      played({ id: "m-2", round_number: 2, match_index: 0, player1_name: "A", player2_name: BYE }),
      played({ id: "m-3", round_number: 3, match_index: 0, player1_name: "A", player2_name: BYE }),
      row({ id: "m-4", round_number: 4, match_index: 0, player1_name: "A", player2_name: "C" }),
    ];
    const decision = canCorrectMatch(matches, matches[0]);
    expect(decision.ok).toBe(true);
    expect(decision.path).toEqual([
      { id: "m-2", round_number: 2, match_index: 0, slotColumn: "player1_name", byeResolved: true },
      { id: "m-3", round_number: 3, match_index: 0, slotColumn: "player1_name", byeResolved: true },
      { id: "m-4", round_number: 4, match_index: 0, slotColumn: "player1_name", byeResolved: false },
    ]);
  });

  it("refuses when a real downstream match was played", () => {
    const matches = [
      played({ id: "m-1", round_number: 1, match_index: 0 }),
      played({ id: "m-2", round_number: 2, match_index: 0, player1_name: "A", player2_name: "C", winner_name: "C" }),
    ];
    const decision = canCorrectMatch(matches, matches[0]);
    expect(decision.ok).toBe(false);
  });

  it("refuses matches that are not completed or not real", () => {
    const pending = row({});
    expect(canCorrectMatch([pending], pending).ok).toBe(false);
    const byeMatch = played({ player2_name: BYE, winner_name: "A" });
    expect(canCorrectMatch([byeMatch], byeMatch).ok).toBe(false);
    const tbd = row({ player2_name: "TBD" });
    expect(canCorrectMatch([tbd], tbd).ok).toBe(false);
  });
});
