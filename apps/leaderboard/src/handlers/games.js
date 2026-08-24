// ============================================================================
//  YourRank Originals — viewer-facing games API.
//
//  Credits are non-cashable, site-specific loyalty points earned from Kick
//  channel-point redemptions. These endpoints let a viewer wager them on
//  provably-fair games. There is no deposit and no cashout anywhere.
//
//  Security invariants enforced here (see also the migration):
//   * viewer identity comes from the viewer session cookie only;
//   * the bet, the debit, the ledger row and the round are one DB transaction
//     (`place_bet`), so a balance can never go negative;
//   * the outcome is derived and stored (`set_round_outcome`) BEFORE it is
//     returned, and open-round outcomes are never serialised — for Mines the
//     mine layout is stripped until the round settles;
//   * the active server seed is never returned, only its hash.
// ============================================================================

import { fromJsonb } from "@yourrank/shared/jsonb";
import { bad, ok, readJson } from "../auth.js";
import { getPublicSite } from "../site.js";
import { requireViewer } from "./viewer-auth.js";
import { rateLimit } from "@yourrank/shared/ratelimit";
import {
  GAME_KEYS,
  isGameKey,
  cashoutMultiplier,
  minesMultiplierTable,
  payoutForBet,
  plinkoPayoutTable,
  PLINKO_MAX_ROWS,
  resolveRound,
  validateParams,
  isMultiStep,
  MINES_GRID_SIZE,
} from "@yourrank/shared/games/index";
import {
  ensureSeed,
  getFairness,
  getGameSettings,
  getOwnedRound,
  getSiteGamesConfig,
  getSiteViewer,
  listHistory,
  listRevealedSeeds,
  placeBet,
  revealTile,
  rotateSeed,
  setRoundOutcome,
  settleRound,
} from "@yourrank/shared/games/store";

const MAX_IDEMPOTENCY_KEY = 100;

/** Round timestamps are the server's clock, never the browser's. */
const nowIso = () => new Date().toISOString();

const defaultDependencies = {
  getPublicSite,
  requireViewer,
  rateLimit,
  ensureSeed,
  getFairness,
  getGameSettings,
  getOwnedRound,
  getSiteGamesConfig,
  getSiteViewer,
  listHistory,
  listRevealedSeeds,
  placeBet,
  revealTile,
  rotateSeed,
  setRoundOutcome,
  settleRound,
};

async function resolveSite(request, env, slug, deps) {
  const clean = String(slug || "").trim().toLowerCase();
  if (!clean) return { error: bad("slug required") };
  const site = await deps.getPublicSite(env, clean, request);
  if (site && site.requiresPassword) return { error: bad("Password required.", 401) };
  if (!site || site.suspended) return { error: bad("site not found", 404) };
  return { site };
}

/**
 * Resolve site + the viewer's membership row for a wagering request.
 * Never trusts any client-supplied viewer identity.
 */
async function requirePlayer(request, env, slug, deps) {
  const { viewer, res } = await deps.requireViewer(request, env);
  if (res) return { error: res };
  const { site, error } = await resolveSite(request, env, slug, deps);
  if (error) return { error };
  const player = await deps.getSiteViewer(site.id, viewer.id);
  if (!player) return { error: bad("No credits on this board yet.", 400) };
  if (player.blocked) return { error: bad("viewer blocked", 403) };
  return { viewer, site, player };
}

function idempotencyKeyOf(body) {
  const key = String(body?.idempotencyKey || "").trim();
  if (!key || key.length > MAX_IDEMPOTENCY_KEY) return null;
  return key;
}

/**
 * Strip everything the client must not learn yet. For an open Mines round the
 * whole outcome (the mine layout) is withheld; revealed tiles are reported
 * separately from the round's `revealed` list.
 */
function publicRound(round, { includeOutcome }) {
  return {
    id: round.id,
    game: round.game,
    bet: Number(round.bet),
    state: round.state,
    payout: Number(round.payout),
    multiplier: Number(round.multiplier),
    params: fromJsonb(round.params) || {},
    revealed: round.revealed || [],
    outcome: includeOutcome && round.state === "settled" ? fromJsonb(round.outcome) : null,
    serverSeedHash: round.server_seed_hash,
    clientSeed: round.client_seed,
    nonce: Number(round.nonce),
    createdAt: round.created_at,
    settledAt: round.settled_at,
  };
}

// ---------------------------------------------------------------------------
// GET /api/games/config?slug=
// ---------------------------------------------------------------------------
export async function handleGamesConfig(request, env, deps = defaultDependencies) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");
  const { site, error } = await resolveSite(request, env, slug, deps);
  if (error) return error;

  if (!(await deps.rateLimit(env, `games:config:${site.id}`, 120, 60)).ok) return bad("rate limited", 429);

  const config = await deps.getSiteGamesConfig(site.id);
  const games = config.games
    .filter((g) => g.enabled)
    .map((g) => ({
      game: g.game,
      minBet: g.minBet,
      maxBet: g.maxBet,
      houseEdgeBps: g.houseEdgeBps,
      dailyLossCap: g.dailyLossCap,
      // Payout tables are public information — they are pure functions of the
      // configured edge, and the UI needs them to draw the board. `rows` says
      // which board those tables price, so the client cannot render a board the
      // server would settle differently.
      rows: g.game === "plinko" ? PLINKO_MAX_ROWS : undefined,
      tables:
        g.game === "plinko"
          ? {
              low: plinkoPayoutTable(PLINKO_MAX_ROWS, "low", g.houseEdgeBps),
              medium: plinkoPayoutTable(PLINKO_MAX_ROWS, "medium", g.houseEdgeBps),
              high: plinkoPayoutTable(PLINKO_MAX_ROWS, "high", g.houseEdgeBps),
            }
          : undefined,
    }));

  return ok({
    slug: site.data?.slug || String(slug || "").trim().toLowerCase(),
    gamesEnabled: config.gamesEnabled,
    games: config.gamesEnabled ? games : [],
    supported: GAME_KEYS,
  });
}

// ---------------------------------------------------------------------------
// POST /api/games/bet
// ---------------------------------------------------------------------------
export async function handleGamesBet(request, env, deps = defaultDependencies) {
  const body = request.validatedBody || (await readJson(request));
  const { site, player, error } = await requirePlayer(request, env, body?.slug, deps);
  if (error) return error;

  const game = String(body?.game || "");
  if (!isGameKey(game)) return bad("unknown game");
  const bet = Number(body?.bet);
  if (!Number.isInteger(bet) || bet <= 0) return bad("bet must be a positive integer");
  const idempotencyKey = idempotencyKeyOf(body);
  if (!idempotencyKey) return bad("idempotencyKey required");

  if (!(await deps.rateLimit(env, `games:bet:${site.id}:${player.id}`, 30, 60)).ok) {
    return bad("rate limited", 429);
  }

  const settings = await deps.getGameSettings(site.id, game);
  if (!settings || !settings.enabled) return bad("game disabled", 403);

  const validated = validateParams(game, body?.params, settings.houseEdgeBps);
  if (!validated.ok) return bad(validated.error);

  await deps.ensureSeed(player.id);

  const result = await deps.placeBet({
    siteId: site.id,
    siteViewerId: player.id,
    game,
    bet,
    params: validated.params,
    idempotencyKey,
  });
  if (!result.ok) {
    const status = result.error === "insufficient balance" ? 400 : 403;
    return bad(result.error, status);
  }

  // Idempotent retry that already produced (and possibly settled) a round:
  // return the stored state instead of resolving anything again.
  if (result.replayed && result.outcomeRecorded) {
    const round = await deps.getOwnedRound(result.roundId, player.id);
    return ok({ round: publicRound(round, { includeOutcome: true }), balance: result.balance, replayed: true });
  }

  // The seed material was committed by place_bet; derive the outcome and store
  // it before returning anything to the client.
  const { outcome, multiplier } = await resolveRound(
    game,
    { serverSeed: result.serverSeed, clientSeed: result.clientSeed, nonce: result.nonce },
    validated.params
  );
  await deps.setRoundOutcome(result.roundId, outcome);

  if (isMultiStep(game)) {
    // Mines: the layout stays secret until the round ends.
    return ok({
      round: {
        id: result.roundId,
        game,
        bet,
        state: "open",
        params: validated.params,
        revealed: [],
        serverSeedHash: result.serverSeedHash,
        clientSeed: result.clientSeed,
        nonce: result.nonce,
        createdAt: nowIso(),
      },
      multiplierTable: minesMultiplierTable(
        validated.params.gridSize || MINES_GRID_SIZE,
        validated.params.mines,
        settings.houseEdgeBps
      ),
      balance: result.balance,
    });
  }

  const payout = payoutForBet(bet, multiplier);
  const settled = await deps.settleRound(result.roundId, multiplier, payout, outcome);
  if (!settled.ok) return bad(settled.error, 500);

  return ok({
    round: {
      id: result.roundId,
      game,
      bet,
      state: "settled",
      params: validated.params,
      outcome,
      multiplier,
      payout: settled.payout,
      serverSeedHash: result.serverSeedHash,
      clientSeed: result.clientSeed,
      nonce: result.nonce,
      createdAt: nowIso(),
    },
    balance: settled.balance,
  });
}

// ---------------------------------------------------------------------------
// POST /api/games/mines/reveal
// ---------------------------------------------------------------------------
export async function handleGamesMinesReveal(request, env, deps = defaultDependencies) {
  const body = request.validatedBody || (await readJson(request));
  const { site, player, error } = await requirePlayer(request, env, body?.slug, deps);
  if (error) return error;

  const roundId = String(body?.roundId || "").trim();
  const tile = Number(body?.tile);
  if (!roundId) return bad("roundId required");
  if (!Number.isInteger(tile) || tile < 0 || tile >= MINES_GRID_SIZE) return bad("invalid tile");

  if (!(await deps.rateLimit(env, `games:reveal:${site.id}:${player.id}`, 120, 60)).ok) {
    return bad("rate limited", 429);
  }

  const round = await deps.getOwnedRound(roundId, player.id);
  if (!round || round.game !== "mines") return bad("round not found", 404);
  if (round.state !== "open") return bad("round already settled", 409);
  const roundOutcome = fromJsonb(round.outcome);
  if (!roundOutcome) return bad("round not ready", 409);

  const minePositions = roundOutcome.minePositions || [];
  const gridSize = roundOutcome.gridSize || MINES_GRID_SIZE;
  const mines = roundOutcome.mines || minePositions.length;

  const already = (round.revealed || []).includes(tile);
  // Re-revealing the same tile is a no-op, which makes a client retry safe.
  const revealed = already ? round.revealed : await deps.revealTile(roundId, player.id, tile);
  if (!revealed) return bad("round already settled", 409);

  if (minePositions.includes(tile)) {
    // Mine hit: the round is over, so the full layout becomes public.
    const settled = await deps.settleRound(roundId, 0, 0);
    return ok({
      roundId,
      game: "mines",
      bet: Number(round.bet),
      tile,
      hitMine: true,
      state: "settled",
      revealed,
      minePositions,
      payout: 0,
      multiplier: 0,
      balance: settled.balance,
    });
  }

  const safeRevealed = revealed.filter((t) => !minePositions.includes(t)).length;
  const current = cashoutMultiplier(gridSize, mines, safeRevealed, round.house_edge_bps);
  const next = cashoutMultiplier(gridSize, mines, safeRevealed + 1, round.house_edge_bps);
  return ok({
    roundId,
    game: "mines",
    bet: Number(round.bet),
    tile,
    hitMine: false,
    state: "open",
    revealed,
    multiplier: current,
    nextMultiplier: next,
    cashoutValue: payoutForBet(Number(round.bet), current),
    // Unchanged by an open reveal, but reported so the client never has to
    // guess or keep its own copy of the balance.
    balance: Number(player.balance),
  });
}

// ---------------------------------------------------------------------------
// POST /api/games/mines/cashout
// ---------------------------------------------------------------------------
export async function handleGamesMinesCashout(request, env, deps = defaultDependencies) {
  const body = request.validatedBody || (await readJson(request));
  const { site, player, error } = await requirePlayer(request, env, body?.slug, deps);
  if (error) return error;

  const roundId = String(body?.roundId || "").trim();
  if (!roundId) return bad("roundId required");

  if (!(await deps.rateLimit(env, `games:cashout:${site.id}:${player.id}`, 60, 60)).ok) {
    return bad("rate limited", 429);
  }

  const round = await deps.getOwnedRound(roundId, player.id);
  if (!round || round.game !== "mines") return bad("round not found", 404);
  const roundOutcome = fromJsonb(round.outcome);
  if (!roundOutcome) return bad("round not ready", 409);

  // Settled rounds return their stored result: cashing out twice pays once.
  if (round.state === "settled") {
    return ok({
      roundId,
      game: "mines",
      bet: Number(round.bet),
      state: "settled",
      replayed: true,
      multiplier: Number(round.multiplier),
      payout: Number(round.payout),
      minePositions: roundOutcome.minePositions || [],
      balance: Number(player.balance),
    });
  }
  if (round.state !== "open") return bad("round is not open", 409);

  const minePositions = roundOutcome.minePositions || [];
  const gridSize = roundOutcome.gridSize || MINES_GRID_SIZE;
  const mines = roundOutcome.mines || minePositions.length;
  const safeRevealed = (round.revealed || []).filter((t) => !minePositions.includes(t)).length;
  if (safeRevealed <= 0) return bad("reveal at least one tile before cashing out");

  const multiplier = cashoutMultiplier(gridSize, mines, safeRevealed, round.house_edge_bps);
  const payout = payoutForBet(Number(round.bet), multiplier);
  const settled = await deps.settleRound(roundId, multiplier, payout);
  if (!settled.ok) return bad(settled.error, 409);

  return ok({
    roundId,
    game: "mines",
    bet: Number(round.bet),
    state: "settled",
    replayed: !!settled.replayed,
    multiplier: settled.multiplier,
    payout: settled.payout,
    minePositions,
    balance: settled.balance,
  });
}

// ---------------------------------------------------------------------------
// GET /api/games/history?slug=&limit=
// ---------------------------------------------------------------------------
export async function handleGamesHistory(request, env, deps = defaultDependencies) {
  const url = new URL(request.url);
  const { site, player, error } = await requirePlayer(request, env, url.searchParams.get("slug"), deps);
  if (error) return error;

  if (!(await deps.rateLimit(env, `games:history:${site.id}:${player.id}`, 60, 60)).ok) {
    return bad("rate limited", 429);
  }

  const limit = Number(url.searchParams.get("limit")) || 25;
  const rounds = await deps.listHistory(player.id, limit);
  return ok({
    rounds: rounds.map((r) => publicRound(r, { includeOutcome: true })),
  });
}

// ---------------------------------------------------------------------------
// GET /api/games/fairness?slug=
// ---------------------------------------------------------------------------
export async function handleGamesFairness(request, env, deps = defaultDependencies) {
  const url = new URL(request.url);
  const { site, player, error } = await requirePlayer(request, env, url.searchParams.get("slug"), deps);
  if (error) return error;

  if (!(await deps.rateLimit(env, `games:fairness:${site.id}:${player.id}`, 60, 60)).ok) {
    return bad("rate limited", 429);
  }

  const current = (await deps.getFairness(player.id)) || (await deps.ensureSeed(player.id));
  const revealed = await deps.listRevealedSeeds(player.id);
  // `serverSeed` is intentionally absent: only its hash is public until rotation.
  return ok({ current, revealed });
}

// ---------------------------------------------------------------------------
// POST /api/games/fairness/rotate
// ---------------------------------------------------------------------------
export async function handleGamesFairnessRotate(request, env, deps = defaultDependencies) {
  const body = request.validatedBody || (await readJson(request));
  const { site, player, error } = await requirePlayer(request, env, body?.slug, deps);
  if (error) return error;

  if (!(await deps.rateLimit(env, `games:rotate:${site.id}:${player.id}`, 10, 60)).ok) {
    return bad("rate limited", 429);
  }

  await deps.ensureSeed(player.id);
  const rotated = await deps.rotateSeed(player.id, body?.clientSeed);
  if (!rotated.ok) return bad(rotated.error, 409);
  return ok(rotated.result);
}
