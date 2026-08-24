// ============================================================================
//  YourRank Originals — data access.
//
//  Everything money-related goes through the SECURITY DEFINER functions
//  `place_bet` / `settle_round` (see 20260810120000_originals_games.sql) so the
//  debit, the ledger row, the round and the nonce bump are one transaction.
//
//  SECURITY: `server_seed` is only ever read inside this module (and inside the
//  request that needs it to derive an outcome). It must never be serialised
//  into an HTTP response while the seed is active.
// ============================================================================

import { one, exec, query, withTransaction } from "../db.js";
import type { GameKey } from "./types.js";
import { DEFAULT_HOUSE_EDGE_BPS } from "./types.js";
import { newClientSeed, newServerSeed, serverSeedHash } from "./fairness.js";

export interface GameSettingsRow {
  game: GameKey;
  enabled: boolean;
  minBet: number;
  maxBet: number;
  houseEdgeBps: number;
  dailyLossCap: number | null;
}

export interface SiteGamesConfig {
  siteId: string;
  gamesEnabled: boolean;
  games: GameSettingsRow[];
}

export interface FairnessState {
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
}

export interface PlaceBetResult {
  ok: boolean;
  error?: string;
  replayed?: boolean;
  roundId?: string;
  nonce?: number;
  /** SECRET. Never include in a response body. */
  serverSeed?: string | null;
  serverSeedHash?: string;
  clientSeed?: string;
  state?: string;
  outcomeRecorded?: boolean;
  balance?: number;
  houseEdgeBps?: number;
  minBet?: number;
  maxBet?: number;
}

export interface SettleResult {
  ok: boolean;
  error?: string;
  replayed?: boolean;
  payout?: number;
  multiplier?: number;
  balance?: number;
}

export interface RoundRow {
  id: string;
  site_id: string;
  site_viewer_id: string;
  game: GameKey;
  bet: number;
  state: "open" | "settled" | "cancelled";
  payout: number;
  multiplier: string | number;
  house_edge_bps: number;
  server_seed_hash: string;
  client_seed: string;
  nonce: string | number;
  params: Record<string, unknown>;
  outcome: Record<string, unknown> | null;
  revealed: number[];
  created_at: string;
  settled_at: string | null;
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Public per-site games config. Absent settings row = game disabled. */
export async function getSiteGamesConfig(siteId: string): Promise<SiteGamesConfig> {
  const [site, rows] = await Promise.all([
    one<{ games_enabled: boolean }>("SELECT games_enabled FROM sites WHERE id = $1", [siteId]),
    query<{
      game: GameKey;
      enabled: boolean;
      min_bet: number;
      max_bet: number;
      house_edge_bps: number;
      daily_loss_cap: number | null;
    }>(
      `SELECT game, enabled, min_bet, max_bet, house_edge_bps, daily_loss_cap
         FROM site_game_settings
        WHERE site_id = $1
        ORDER BY game`,
      [siteId]
    ),
  ]);

  return {
    siteId,
    gamesEnabled: !!site?.games_enabled,
    games: (rows || []).map((r) => ({
      game: r.game,
      enabled: !!r.enabled,
      minBet: num(r.min_bet, 1),
      maxBet: num(r.max_bet, 1),
      houseEdgeBps: num(r.house_edge_bps, DEFAULT_HOUSE_EDGE_BPS),
      dailyLossCap: r.daily_loss_cap === null ? null : num(r.daily_loss_cap),
    })),
  };
}

export async function getGameSettings(siteId: string, game: GameKey): Promise<GameSettingsRow | null> {
  const row = await one<{
    enabled: boolean;
    min_bet: number;
    max_bet: number;
    house_edge_bps: number;
    daily_loss_cap: number | null;
  }>(
    `SELECT enabled, min_bet, max_bet, house_edge_bps, daily_loss_cap
       FROM site_game_settings WHERE site_id = $1 AND game = $2`,
    [siteId, game]
  );
  if (!row) return null;
  return {
    game,
    enabled: !!row.enabled,
    minBet: num(row.min_bet, 1),
    maxBet: num(row.max_bet, 1),
    houseEdgeBps: num(row.house_edge_bps, DEFAULT_HOUSE_EDGE_BPS),
    dailyLossCap: row.daily_loss_cap === null ? null : num(row.daily_loss_cap),
  };
}

/** Resolve the viewer's per-site membership row (never trust a client id). */
export async function getSiteViewer(
  siteId: string,
  viewerId: string
): Promise<{ id: string; balance: number; blocked: boolean } | null> {
  const row = await one<{ id: string; balance: number; blocked: boolean }>(
    `SELECT id, balance, blocked FROM site_viewers WHERE site_id = $1 AND viewer_id = $2`,
    [siteId, viewerId]
  );
  return row ? { id: row.id, balance: num(row.balance), blocked: !!row.blocked } : null;
}

// ---------------------------------------------------------------------------
// Seeds (commit / reveal)
// ---------------------------------------------------------------------------

/** Create the seed pair on first use; returns only public fields. */
export async function ensureSeed(siteViewerId: string): Promise<FairnessState> {
  const existing = await one<{ server_seed_hash: string; client_seed: string; nonce: string }>(
    `SELECT server_seed_hash, client_seed, nonce FROM game_seeds WHERE site_viewer_id = $1`,
    [siteViewerId]
  );
  if (existing) {
    return {
      serverSeedHash: existing.server_seed_hash,
      clientSeed: existing.client_seed,
      nonce: num(existing.nonce),
    };
  }

  const serverSeed = newServerSeed();
  const hash = await serverSeedHash(serverSeed);
  const clientSeed = newClientSeed();
  const rows = await exec(
    `INSERT INTO game_seeds (site_viewer_id, server_seed, server_seed_hash, client_seed, nonce)
     VALUES ($1, $2, $3, $4, 0)
     ON CONFLICT (site_viewer_id) DO NOTHING
     RETURNING server_seed_hash, client_seed, nonce`,
    [siteViewerId, serverSeed, hash, clientSeed]
  );
  if (rows && rows.length > 0) {
    return { serverSeedHash: rows[0].server_seed_hash, clientSeed: rows[0].client_seed, nonce: num(rows[0].nonce) };
  }
  // Lost the insert race — read the winner's row.
  return ensureSeed(siteViewerId);
}

export interface RotateResult {
  revealed: { serverSeed: string; serverSeedHash: string; clientSeed: string; finalNonce: number } | null;
  current: FairnessState;
}

/**
 * Rotate the seed pair: the old server seed becomes public (so every round
 * played under it can be verified) and a fresh commitment replaces it.
 * Rejected while a round is still open, so an in-flight outcome can never be
 * revealed early.
 */
export async function rotateSeed(
  siteViewerId: string,
  requestedClientSeed?: string | null
): Promise<{ ok: boolean; error?: string; result?: RotateResult }> {
  const serverSeed = newServerSeed();
  const hash = await serverSeedHash(serverSeed);
  const clientSeed = (requestedClientSeed || "").trim() || newClientSeed();

  return withTransaction(async (tx) => {
    const openRound = await tx.one<{ id: string }>(
      `SELECT id FROM game_rounds WHERE site_viewer_id = $1 AND state = 'open' LIMIT 1`,
      [siteViewerId]
    );
    if (openRound) return { ok: false, error: "finish your open round before rotating" };

    const old = await tx.one<{
      server_seed: string;
      server_seed_hash: string;
      client_seed: string;
      nonce: string;
    }>(
      `SELECT server_seed, server_seed_hash, client_seed, nonce
         FROM game_seeds WHERE site_viewer_id = $1 FOR UPDATE`,
      [siteViewerId]
    );
    if (!old) return { ok: false, error: "no active seed" };

    await tx.unsafe(
      `INSERT INTO game_seed_reveals (site_viewer_id, server_seed, server_seed_hash, client_seed, final_nonce)
       VALUES ($1, $2, $3, $4, $5)`,
      [siteViewerId, old.server_seed, old.server_seed_hash, old.client_seed, num(old.nonce)]
    );
    await tx.unsafe(
      `UPDATE game_seeds
          SET server_seed = $2, server_seed_hash = $3, client_seed = $4,
              nonce = 0, rotated_at = now(), updated_at = now()
        WHERE site_viewer_id = $1`,
      [siteViewerId, serverSeed, hash, clientSeed]
    );

    return {
      ok: true,
      result: {
        revealed: {
          serverSeed: old.server_seed,
          serverSeedHash: old.server_seed_hash,
          clientSeed: old.client_seed,
          finalNonce: num(old.nonce),
        },
        current: { serverSeedHash: hash, clientSeed, nonce: 0 },
      },
    };
  });
}

export async function getFairness(siteViewerId: string): Promise<FairnessState | null> {
  const row = await one<{ server_seed_hash: string; client_seed: string; nonce: string }>(
    `SELECT server_seed_hash, client_seed, nonce FROM game_seeds WHERE site_viewer_id = $1`,
    [siteViewerId]
  );
  if (!row) return null;
  return { serverSeedHash: row.server_seed_hash, clientSeed: row.client_seed, nonce: num(row.nonce) };
}

export async function listRevealedSeeds(siteViewerId: string, limit = 20) {
  const rows = await query<{
    server_seed: string;
    server_seed_hash: string;
    client_seed: string;
    final_nonce: string;
    revealed_at: string;
  }>(
    `SELECT server_seed, server_seed_hash, client_seed, final_nonce, revealed_at
       FROM game_seed_reveals
      WHERE site_viewer_id = $1
      ORDER BY revealed_at DESC
      LIMIT $2`,
    [siteViewerId, Math.min(Math.max(limit, 1), 50)]
  );
  return (rows || []).map((r) => ({
    serverSeed: r.server_seed,
    serverSeedHash: r.server_seed_hash,
    clientSeed: r.client_seed,
    finalNonce: num(r.final_nonce),
    revealedAt: r.revealed_at,
  }));
}

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------

export async function placeBet(input: {
  siteId: string;
  siteViewerId: string;
  game: GameKey;
  bet: number;
  params: Record<string, unknown>;
  idempotencyKey: string;
}): Promise<PlaceBetResult> {
  const row = await exec(`SELECT place_bet($1, $2, $3, $4, $5::jsonb, $6) AS result`, [
    input.siteId,
    input.siteViewerId,
    input.game,
    input.bet,
    input.params ?? {},
    input.idempotencyKey,
  ]);
  const result = (row?.[0]?.result ?? {}) as Record<string, unknown>;
  if (!result.ok) {
    return {
      ok: false,
      error: String(result.error || "bet rejected"),
      minBet: result.min_bet === undefined ? undefined : num(result.min_bet),
      maxBet: result.max_bet === undefined ? undefined : num(result.max_bet),
    };
  }
  return {
    ok: true,
    replayed: !!result.replayed,
    roundId: String(result.round_id),
    nonce: num(result.nonce),
    serverSeed: (result.server_seed as string | null) ?? null,
    serverSeedHash: String(result.server_seed_hash),
    clientSeed: String(result.client_seed),
    state: String(result.state || "open"),
    outcomeRecorded: !!result.outcome_recorded,
    balance: num(result.balance),
    houseEdgeBps: num(result.house_edge_bps, DEFAULT_HOUSE_EDGE_BPS),
  };
}

export async function setRoundOutcome(roundId: string, outcome: unknown): Promise<void> {
  await exec(`SELECT set_round_outcome($1, $2::jsonb) AS result`, [roundId, outcome ?? {}]);
}

export async function settleRound(
  roundId: string,
  multiplier: number,
  payout: number,
  outcome?: unknown
): Promise<SettleResult> {
  const row = await exec(`SELECT settle_round($1, $2::numeric, $3, $4::jsonb) AS result`, [
    roundId,
    multiplier,
    payout,
    outcome === undefined ? null : outcome,
  ]);
  const result = (row?.[0]?.result ?? {}) as Record<string, unknown>;
  if (!result.ok) return { ok: false, error: String(result.error || "settle failed") };
  return {
    ok: true,
    replayed: !!result.replayed,
    payout: num(result.payout),
    multiplier: num(result.multiplier),
    balance: num(result.balance),
  };
}

/** Load a round the viewer owns. Returns null for anyone else's round. */
export async function getOwnedRound(roundId: string, siteViewerId: string): Promise<RoundRow | null> {
  const row = await one<RoundRow>(
    `SELECT * FROM game_rounds WHERE id = $1 AND site_viewer_id = $2`,
    [roundId, siteViewerId]
  );
  return row ?? null;
}

/**
 * Append a tile to an open round's revealed list. The conditional UPDATE makes
 * a double-reveal race a no-op instead of two "first reveals".
 */
export async function revealTile(
  roundId: string,
  siteViewerId: string,
  tile: number
): Promise<number[] | null> {
  const rows = await exec(
    `UPDATE game_rounds
        SET revealed = array_append(revealed, $3::int)
      WHERE id = $1
        AND site_viewer_id = $2
        AND state = 'open'
        AND NOT ($3::int = ANY(revealed))
      RETURNING revealed`,
    [roundId, siteViewerId, tile]
  );
  if (!rows || rows.length === 0) return null;
  return (rows[0].revealed as number[]) ?? [];
}

export async function listHistory(siteViewerId: string, limit = 25) {
  const rows = await query<RoundRow>(
    `SELECT id, game, bet, state, payout, multiplier, server_seed_hash, client_seed,
            nonce, params, outcome, revealed, created_at, settled_at
       FROM game_rounds
      WHERE site_viewer_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [siteViewerId, Math.min(Math.max(limit, 1), 50)]
  );
  return rows || [];
}
