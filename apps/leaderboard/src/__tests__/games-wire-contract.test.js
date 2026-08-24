// The one boundary between the games API and the island's UI types.
//
// Every fixture below is a real response body from
// apps/leaderboard/src/handlers/games.js — copied from the handler, not invented
// for the test. If a handler changes a field name, these tests are what fails,
// which is the point: before this boundary existed the drift showed up as an
// unplayable board (Mines read `res.roundId` from a response that nests the
// round under `round.id`) with no failing test anywhere.
import { describe, expect, test } from "bun:test";
import {
  toBetResult,
  toFairnessResponse,
  toGameConfig,
  toGamesConfig,
  toHistoryResponse,
  toMinesCashoutResult,
  toMinesRevealResult,
  toRotatedFairness,
} from "../games/api/wire.ts";

const FIXED = "2026-01-01T00:00:00.000Z";
const now = () => FIXED;

describe("config", () => {
  test("gamesEnabled + per-game rows drive the UI config", () => {
    const config = toGamesConfig({
      slug: "acme",
      gamesEnabled: true,
      games: [
        { game: "dice", minBet: 5, maxBet: 500, houseEdgeBps: 100, dailyLossCap: null },
        { game: "mines", minBet: 1, maxBet: 1000, houseEdgeBps: 250, dailyLossCap: 5000 },
      ],
      supported: ["mines", "plinko", "dice", "limbo"],
    });
    expect(config.enabled).toBe(true);
    expect(config.games.map((g) => g.id)).toEqual(["dice", "mines"]);
    expect(config.games[1]).toEqual({
      id: "mines",
      enabled: true,
      name: "Mines",
      minBet: 1,
      maxBet: 1000,
      houseEdgeBps: 250,
      dailyLossCap: 5000,
    });
    // The global limit is the widest per-game maximum, not a number of its own.
    expect(config.limits.maxBet).toBe(1000);
  });

  test("a game the island cannot render is dropped rather than shown as broken", () => {
    expect(toGameConfig({ game: "limbo", minBet: 1, maxBet: 10, houseEdgeBps: 100, dailyLossCap: null })).toBeNull();
    const config = toGamesConfig({
      slug: "acme",
      gamesEnabled: true,
      games: [{ game: "limbo", minBet: 1, maxBet: 10, houseEdgeBps: 100, dailyLossCap: null }],
    });
    expect(config.games).toEqual([]);
  });

  test("games switched off site-wide produce an empty, disabled config", () => {
    expect(toGamesConfig({ slug: "acme", gamesEnabled: false, games: [] })).toEqual({
      enabled: false,
      currency: "credits",
      games: [],
      limits: { maxBet: 0, dailyWagerLimit: null, cooldownMs: 0 },
    });
  });

  test("plinko carries the server's row count and payout tables, so the board cannot price itself", () => {
    const tables = { low: [1, 0.5, 1], medium: [2, 0.3, 2], high: [5, 0.2, 5] };
    const cfg = toGameConfig({
      game: "plinko",
      minBet: 1,
      maxBet: 100,
      houseEdgeBps: 100,
      dailyLossCap: null,
      rows: 16,
      tables,
    });
    expect(cfg.rows).toBe(16);
    expect(cfg.payoutTables).toEqual(tables);
    expect(cfg.maxMultiplier).toBe(5);
  });
});

describe("bet", () => {
  const settled = {
    round: {
      id: "r1",
      game: "dice",
      bet: 10,
      state: "settled",
      params: { target: 50, direction: "over", houseEdgeBps: 100 },
      outcome: { roll: 4242, rollDisplay: 42.42, win: true },
      multiplier: 1.98,
      payout: 19,
      serverSeedHash: "hash",
      clientSeed: "seed",
      nonce: 7,
      createdAt: FIXED,
    },
    balance: 509,
  };

  test("a settled round keeps the server's money and its own timestamp", () => {
    expect(toBetResult(settled, now)).toEqual({
      roundId: "r1",
      game: "dice",
      status: "won",
      amount: 10,
      multiplier: 1.98,
      payout: 19,
      balance: 509,
      outcome: settled.round.outcome,
      params: settled.round.params,
      revealed: [],
      fairness: { serverSeedHash: "hash", clientSeed: "seed", nonce: 7 },
      createdAt: FIXED,
    });
  });

  test("a settled round with no payout is a loss", () => {
    const lost = { ...settled, round: { ...settled.round, multiplier: 0, payout: 0 } };
    expect(toBetResult(lost, now).status).toBe("lost");
  });

  test("an open mines round exposes the round id and the server's cashout ladder", () => {
    const open = {
      round: {
        id: "r2",
        game: "mines",
        bet: 25,
        state: "open",
        params: { gridSize: 25, mines: 3, houseEdgeBps: 100 },
        revealed: [],
        serverSeedHash: "hash",
        clientSeed: "seed",
        nonce: 1,
        createdAt: FIXED,
      },
      multiplierTable: [1.13, 1.29, 1.48],
      balance: 475,
    };
    const result = toBetResult(open, now);
    expect(result.roundId).toBe("r2");
    expect(result.status).toBe("open");
    expect(result.payout).toBe(0);
    expect(result.balance).toBe(475);
    // No layout is leaked while the round can still be played.
    expect(result.outcome).toEqual({});
    expect(result.minesMultiplierTable).toEqual([1.13, 1.29, 1.48]);
  });
});

describe("mines lifecycle", () => {
  test("a safe reveal reports the current and next multiplier and what cashing out pays", () => {
    const result = toMinesRevealResult(
      {
        roundId: "r2",
        game: "mines",
        bet: 25,
        tile: 4,
        hitMine: false,
        state: "open",
        revealed: [4],
        multiplier: 1.13,
        nextMultiplier: 1.29,
        cashoutValue: 28,
        balance: 475,
      },
      now
    );
    expect(result.status).toBe("open");
    expect(result.revealed).toEqual([4]);
    expect(result.multiplier).toBe(1.13);
    expect(result.nextMultiplier).toBe(1.29);
    expect(result.cashoutValue).toBe(28);
    expect(result.minePositions).toEqual([]);
    expect(result.payout).toBe(0);
  });

  test("hitting a mine loses the round and publishes the layout", () => {
    const result = toMinesRevealResult(
      {
        roundId: "r2",
        game: "mines",
        bet: 25,
        tile: 7,
        hitMine: true,
        state: "settled",
        revealed: [4, 7],
        minePositions: [7, 12, 20],
        payout: 0,
        multiplier: 0,
        balance: 475,
      },
      now
    );
    expect(result.status).toBe("lost");
    expect(result.hitMine).toBe(true);
    expect(result.tile).toBe(7);
    expect(result.minePositions).toEqual([7, 12, 20]);
    expect(result.payout).toBe(0);
  });

  test("cashing out is `cashed_out`, and a replay says so instead of paying twice", () => {
    const paid = toMinesCashoutResult(
      {
        roundId: "r2",
        game: "mines",
        bet: 25,
        state: "settled",
        replayed: false,
        multiplier: 1.29,
        payout: 32,
        minePositions: [7, 12, 20],
        balance: 507,
      },
      now
    );
    expect(paid).toEqual({
      roundId: "r2",
      game: "mines",
      status: "cashed_out",
      amount: 25,
      multiplier: 1.29,
      payout: 32,
      balance: 507,
      outcome: { minePositions: [7, 12, 20] },
      params: {},
      revealed: [],
      createdAt: FIXED,
      minePositions: [7, 12, 20],
      replayed: false,
    });

    const replay = toMinesCashoutResult(
      {
        roundId: "r2",
        game: "mines",
        bet: 25,
        state: "settled",
        replayed: true,
        multiplier: 1.29,
        payout: 32,
        minePositions: [7, 12, 20],
        balance: 507,
      },
      now
    );
    expect(replay.replayed).toBe(true);
    expect(replay.payout).toBe(32);
    expect(replay.balance).toBe(507);
  });
});

describe("history and fairness", () => {
  test("`rounds` becomes `entries`, and unplayable games are left out", () => {
    const history = toHistoryResponse({
      rounds: [
        {
          id: "r1",
          game: "dice",
          bet: 10,
          state: "settled",
          multiplier: 1.98,
          payout: 19,
          serverSeedHash: "h",
          clientSeed: "c",
          nonce: 1,
          createdAt: FIXED,
        },
        {
          id: "r0",
          game: "limbo",
          bet: 10,
          state: "settled",
          multiplier: 0,
          payout: 0,
          serverSeedHash: "h",
          clientSeed: "c",
          nonce: 0,
          createdAt: FIXED,
        },
      ],
    });
    expect(history.entries).toEqual([
      { roundId: "r1", game: "dice", amount: 10, multiplier: 1.98, payout: 19, status: "won", createdAt: FIXED },
    ]);
    expect(history.nextCursor).toBeNull();
  });

  test("fairness exposes the current commitment and the most recent reveal", () => {
    const fairness = toFairnessResponse({
      current: { serverSeedHash: "h2", clientSeed: "c2", nonce: 4 },
      revealed: [
        { serverSeed: "s1", serverSeedHash: "h1", clientSeed: "c1", finalNonce: 9, revealedAt: FIXED },
        { serverSeed: "s0", serverSeedHash: "h0", clientSeed: "c0", finalNonce: 3, revealedAt: FIXED },
      ],
    });
    expect(fairness.serverSeedHash).toBe("h2");
    expect(fairness.nonce).toBe(4);
    expect(fairness.previous).toEqual({ serverSeed: "s1", serverSeedHash: "h1", clientSeed: "c1", nonce: 9 });
  });

  test("a viewer with no rotations yet has no previous seed rather than a blank one", () => {
    const fairness = toFairnessResponse({ current: { serverSeedHash: "h", clientSeed: "c", nonce: 0 } });
    expect(fairness.previous).toBeUndefined();
  });

  test("rotation returns the new commitment plus the seed it just revealed", () => {
    const rotated = toRotatedFairness({
      current: { serverSeedHash: "h2", clientSeed: "c2", nonce: 0 },
      revealed: { serverSeed: "s1", serverSeedHash: "h1", clientSeed: "c1", finalNonce: 12 },
    });
    expect(rotated.serverSeedHash).toBe("h2");
    expect(rotated.nonce).toBe(0);
    expect(rotated.previous.serverSeed).toBe("s1");
    expect(rotated.previous.nonce).toBe(12);
  });
});
