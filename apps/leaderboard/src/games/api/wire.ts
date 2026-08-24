// ============================================================================
//  Wire format of the games API — declared once, read in exactly one place.
//
//  The shapes below are what apps/leaderboard/src/handlers/games.js actually
//  sends. The mappers turn them into the UI types in ../types.ts. Nothing else
//  in the island may read a raw response: if the backend changes a field, this
//  file and its tests are the only things that have to move.
//
//  The mappers translate. They never compute money, randomness, a multiplier
//  or an outcome — every number they return came out of the response.
// ============================================================================
import type {
  BetResult,
  FairnessResponse,
  GameConfig,
  GameId,
  GameParams,
  GamesConfig,
  HistoryEntry,
  HistoryResponse,
  MinesCashoutResult,
  MinesRevealResult,
  PlinkoPayoutTables,
  RoundStatus,
} from "../types.js";

/** Games the island can actually render — the registry decides, not the server. */
const PLAYABLE: readonly GameId[] = ["mines", "plinko", "dice"];

const GAME_NAMES: Record<GameId, string> = {
  mines: "Mines",
  plinko: "Plinko",
  dice: "Dice",
};

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

export interface WireGame {
  game: string;
  minBet: number;
  maxBet: number;
  houseEdgeBps: number;
  dailyLossCap: number | null;
  rows?: number;
  tables?: PlinkoPayoutTables;
}

export interface WireConfig {
  slug: string;
  gamesEnabled: boolean;
  games?: WireGame[];
  supported?: string[];
}

export interface WireRound {
  id: string;
  game: string;
  bet: number;
  state: "open" | "settled";
  params?: GameParams;
  outcome?: Record<string, unknown> | null;
  multiplier?: number;
  payout?: number;
  revealed?: number[];
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  createdAt?: string;
  settledAt?: string | null;
}

export interface WireBetResponse {
  round: WireRound;
  balance: number;
  replayed?: boolean;
  /** Mines only: server cashout multipliers for 1..n safe tiles. */
  multiplierTable?: number[];
}

export interface WireMinesReveal {
  roundId: string;
  game: string;
  bet: number;
  tile: number;
  hitMine: boolean;
  state: "open" | "settled";
  revealed: number[];
  multiplier: number;
  nextMultiplier?: number;
  cashoutValue?: number;
  minePositions?: number[];
  payout?: number;
  balance: number;
}

export interface WireMinesCashout {
  roundId: string;
  game: string;
  bet: number;
  state: "settled";
  replayed?: boolean;
  multiplier: number;
  payout: number;
  minePositions?: number[];
  balance: number;
}

export interface WireHistory {
  rounds?: WireRound[];
}

export interface WireFairness {
  current: { serverSeedHash: string; clientSeed: string; nonce: number };
  revealed?: Array<{
    serverSeed: string;
    serverSeedHash: string;
    clientSeed: string;
    finalNonce: number;
    revealedAt?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function isPlayable(game: string): game is GameId {
  return (PLAYABLE as readonly string[]).includes(game);
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** A settled round with no payout is a loss; with one, a win. Mines cashouts say so themselves. */
function statusOf(state: string, payout: number): RoundStatus {
  if (state === "open") return "open";
  return payout > 0 ? "won" : "lost";
}

export function toGameConfig(game: WireGame): GameConfig | null {
  if (!isPlayable(game.game)) return null;
  const tables = game.tables;
  return {
    id: game.game,
    // The config endpoint only lists games the streamer enabled.
    enabled: true,
    name: GAME_NAMES[game.game],
    minBet: num(game.minBet, 1),
    maxBet: num(game.maxBet, 1),
    houseEdgeBps: num(game.houseEdgeBps),
    dailyLossCap: game.dailyLossCap === null || game.dailyLossCap === undefined ? null : num(game.dailyLossCap),
    ...(tables ? { payoutTables: tables, maxMultiplier: Math.max(...tables.high) } : {}),
    ...(game.rows ? { rows: num(game.rows) } : {}),
  };
}

export function toGamesConfig(wire: WireConfig): GamesConfig {
  const games = (wire.games ?? [])
    .map(toGameConfig)
    .filter((g): g is GameConfig => g !== null);
  return {
    enabled: Boolean(wire.gamesEnabled),
    // Credits are the only wager unit in the product; the backend does not
    // carry a per-site name for them.
    currency: "credits",
    games,
    limits: {
      maxBet: games.reduce((max, g) => Math.max(max, g.maxBet), 0),
      // Per-game only server-side (`dailyLossCap`); there is no global cap.
      dailyWagerLimit: null,
      // No server-enforced cooldown between rounds — rate limits, not cooldowns.
      cooldownMs: 0,
    },
  };
}

export function toBetResult(wire: WireBetResponse, nowIso: () => string = () => new Date().toISOString()): BetResult {
  const round = wire.round;
  const payout = num(round.payout);
  const game = isPlayable(round.game) ? round.game : "dice";
  return {
    roundId: round.id,
    game,
    status: statusOf(round.state, payout),
    amount: num(round.bet),
    multiplier: num(round.multiplier),
    payout,
    balance: num(wire.balance),
    outcome: round.outcome ?? {},
    params: round.params ?? {},
    revealed: round.revealed ?? [],
    fairness: { serverSeedHash: round.serverSeedHash, clientSeed: round.clientSeed, nonce: num(round.nonce) },
    createdAt: round.createdAt ?? nowIso(),
    ...(wire.multiplierTable ? { minesMultiplierTable: wire.multiplierTable } : {}),
  };
}

export function toMinesRevealResult(
  wire: WireMinesReveal,
  nowIso: () => string = () => new Date().toISOString()
): MinesRevealResult {
  const payout = num(wire.payout);
  return {
    roundId: wire.roundId,
    game: "mines",
    status: wire.hitMine ? "lost" : statusOf(wire.state, payout),
    amount: num(wire.bet),
    multiplier: num(wire.multiplier),
    payout,
    balance: num(wire.balance),
    outcome: wire.minePositions ? { minePositions: wire.minePositions } : {},
    params: {},
    revealed: wire.revealed ?? [],
    createdAt: nowIso(),
    tile: num(wire.tile),
    hitMine: Boolean(wire.hitMine),
    cashoutValue: num(wire.cashoutValue),
    nextMultiplier: num(wire.nextMultiplier),
    minePositions: wire.minePositions ?? [],
  };
}

export function toMinesCashoutResult(
  wire: WireMinesCashout,
  nowIso: () => string = () => new Date().toISOString()
): MinesCashoutResult {
  return {
    roundId: wire.roundId,
    game: "mines",
    status: "cashed_out",
    amount: num(wire.bet),
    multiplier: num(wire.multiplier),
    payout: num(wire.payout),
    balance: num(wire.balance),
    outcome: wire.minePositions ? { minePositions: wire.minePositions } : {},
    params: {},
    revealed: [],
    createdAt: nowIso(),
    minePositions: wire.minePositions ?? [],
    replayed: Boolean(wire.replayed),
  };
}

export function toHistoryEntry(round: WireRound): HistoryEntry | null {
  if (!isPlayable(round.game)) return null;
  const payout = num(round.payout);
  return {
    roundId: round.id,
    game: round.game,
    amount: num(round.bet),
    multiplier: num(round.multiplier),
    payout,
    status: statusOf(round.state, payout),
    createdAt: round.createdAt ?? "",
  };
}

export function toHistoryResponse(wire: WireHistory): HistoryResponse {
  return {
    entries: (wire.rounds ?? []).map(toHistoryEntry).filter((e): e is HistoryEntry => e !== null),
    // The endpoint returns a bounded, non-paginated list.
    nextCursor: null,
  };
}

export function toFairnessResponse(wire: WireFairness): FairnessResponse {
  const previous = (wire.revealed ?? [])[0];
  return {
    serverSeedHash: wire.current.serverSeedHash,
    clientSeed: wire.current.clientSeed,
    nonce: num(wire.current.nonce),
    ...(previous
      ? {
          previous: {
            serverSeed: previous.serverSeed,
            serverSeedHash: previous.serverSeedHash,
            clientSeed: previous.clientSeed,
            nonce: num(previous.finalNonce),
          },
        }
      : {}),
  };
}

/** POST /api/games/fairness/rotate returns `{ current, revealed }` (single reveal). */
export function toRotatedFairness(wire: {
  current: WireFairness["current"];
  revealed: NonNullable<WireFairness["revealed"]>[number] | null;
}): FairnessResponse {
  return toFairnessResponse({ current: wire.current, revealed: wire.revealed ? [wire.revealed] : [] });
}
