// Live Predictions & Voting Handlers.
import { fromJsonb } from "@yourrank/shared/jsonb";
import { requireUser as defaultRequireUser, ok, bad, readJson } from "../auth.js";
import { getByUser as defaultGetByUser, getBoardById as defaultGetBoardById } from "../site.js";
import { requireSiteCapability } from "../site-authorization.js";
import {
  one as defaultOne,
  query as defaultQuery,
  exec as defaultExec,
  withTransaction as defaultWithTransaction,
} from "@yourrank/shared/db";
import { logAudit as defaultLogAudit } from "@yourrank/shared/audit";
/**
 * GET /api/predictions — List predictions for the site
 */
export async function handleGetPredictions(request, env, deps = {}) {
  const {
    requireUser = defaultRequireUser,
    getByUser = defaultGetByUser,
    getBoardById = defaultGetBoardById,
    query = defaultQuery,
    exec = defaultExec,
  } = deps;

  const { user, res } = await requireUser(request, env);
  if (res) return res;

  const url = new URL(request.url);
  const siteId = url.searchParams.get("siteId");
  const site = siteId ? await getBoardById(env, user.id, siteId) : await getByUser(env, user.id);
  if (!site) return bad("Site not found", 404);
  const authorization = await requireSiteCapability(user, site, "canRoleManageBoard");
  if (authorization.res) return authorization.res;

  // Lazily close predictions whose betting window has elapsed so the dashboard
  // never shows them as "Betting Open" forever.
  await exec(
    "UPDATE predictions SET status='locked', updated_at=now() WHERE site_id=$1 AND status='open' AND lock_at IS NOT NULL AND lock_at <= now()",
    [site.id]
  );

  const predictions = await query(
    `SELECT p.id, p.title, p.options, p.status, p.winning_option_id, p.total_pool,
            p.min_bet, p.max_bet, p.lock_at, p.settled_at, p.created_at,
            (SELECT count(DISTINCT site_viewer_id) FROM prediction_bets WHERE prediction_id=p.id) AS participant_count,
            (SELECT count(*) FROM prediction_bets WHERE prediction_id=p.id) AS total_bets_count
       FROM predictions p
      WHERE p.site_id=$1
      ORDER BY p.created_at DESC LIMIT 50`,
    [site.id]
  );

  // Unwrap jsonb at this boundary so the client always receives options as an
  // array; the browser must not carry a second decoder.
  return ok({
    predictions: (predictions || []).map((p) => ({ ...p, options: fromJsonb(p.options) || [] })),
  });
}

/**
 * POST /api/predictions — Create a new prediction
 */
export async function handleCreatePrediction(request, env, deps = {}) {
  const {
    requireUser = defaultRequireUser,
    getByUser = defaultGetByUser,
    getBoardById = defaultGetBoardById,
    one = defaultOne,
    logAudit = defaultLogAudit,
  } = deps;

  const { user, res } = await requireUser(request, env);
  if (res) return res;

  const body = await readJson(request);
  const title = String(body?.title || "").trim();
  if (!title) return bad("Prediction title is required.");

  // Options validation (minimum 2 options)
  const rawOptions = Array.isArray(body?.options) ? body.options : [
    { id: "yes", label: "Yes / نعم" },
    { id: "no", label: "No / لا" },
  ];

  if (rawOptions.length < 2) return bad("At least 2 options are required.");

  const options = rawOptions.map((opt, idx) => ({
    id: String(opt.id || `opt_${idx + 1}`).trim().toLowerCase(),
    label: String(opt.label ?? "").trim().slice(0, 80),
    total_points: 0,
    total_bets: 0,
  }));

  if (options.some((opt) => !opt.id || !opt.label)) {
    return bad("Every option needs both an id and a label.");
  }
  const seenIds = new Set();
  const seenLabels = new Set();
  for (const opt of options) {
    if (seenIds.has(opt.id)) return bad("Option ids must be unique.");
    if (seenLabels.has(opt.label.toLowerCase())) {
      return bad("Option labels must be different from each other.");
    }
    seenIds.add(opt.id);
    seenLabels.add(opt.label.toLowerCase());
  }

  const minBet = Math.max(1, parseInt(body?.minBet, 10) || 10);
  const maxBet = parseInt(body?.maxBet, 10) || 1000;
  if (maxBet < minBet) {
    return bad(`Maximum bet (${maxBet}) must be at least the minimum bet (${minBet}).`);
  }
  const lockMinutes = parseInt(body?.lockMinutes, 10) || 5;
  const lockAt = lockMinutes > 0 ? new Date(Date.now() + lockMinutes * 60000).toISOString() : null;

  const url = new URL(request.url);
  const siteId = body?.siteId || url.searchParams.get("siteId");
  const site = siteId ? await getBoardById(env, user.id, siteId) : await getByUser(env, user.id);
  if (!site) return bad("Site not found", 404);
  const authorization = await requireSiteCapability(user, site, "canRoleManageBoard");
  if (authorization.res) return authorization.res;

  const result = await one(
    `INSERT INTO predictions (site_id, title, options, min_bet, max_bet, lock_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, title, options, status, total_pool, min_bet, max_bet, lock_at, created_at`,
    [site.id, title, options, minBet, maxBet, lockAt]
  );

  await logAudit({
    actorId: user.id,
    action: "prediction_create",
    entityType: "prediction",
    entityId: result.id,
    request,
    details: { title, minBet, maxBet, optionsCount: options.length },
  });

  return ok({ prediction: result, message: "Live prediction created! 🔮" });
}

/**
 * POST /api/predictions/:id/lock — Lock betting on prediction
 */
export async function handleLockPrediction(request, env, deps = {}) {
  const {
    requireUser = defaultRequireUser,
    one = defaultOne,
    exec = defaultExec,
    logAudit = defaultLogAudit,
  } = deps;

  const { user, res } = await requireUser(request, env);
  if (res) return res;

  const body = await readJson(request);
  const predictionId = String(body?.predictionId || "").trim();
  if (!predictionId) return bad("Prediction ID is required.");

  const pred = await one(
    `SELECT p.id, p.status FROM predictions p
       JOIN sites s ON s.id = p.site_id
      WHERE p.id=$1 AND s.user_id=$2`,
    [predictionId, user.id]
  );

  if (!pred) return bad("Prediction not found or access denied.", 404);
  if (pred.status !== "open") return bad("Prediction is not currently open.", 400);

  await exec("UPDATE predictions SET status='locked', updated_at=now() WHERE id=$1", [predictionId]);

  await logAudit({
    actorId: user.id,
    action: "prediction_lock",
    entityType: "prediction",
    entityId: predictionId,
    request,
    details: {},
  });

  return ok({ predictionId, status: "locked", message: "Prediction locked. No more bets accepted." });
}

/**
 * POST /api/predictions/:id/settle — Settle prediction and distribute proportional payouts
 */
export async function handleSettlePrediction(request, env, deps = {}) {
  const {
    requireUser = defaultRequireUser,
    one = defaultOne,
    withTransaction = defaultWithTransaction,
    logAudit = defaultLogAudit,
  } = deps;

  const { user, res } = await requireUser(request, env);
  if (res) return res;

  const body = await readJson(request);
  const predictionId = String(body?.predictionId || "").trim();
  const winningOptionId = String(body?.winningOptionId || "").trim().toLowerCase();

  if (!predictionId || !winningOptionId) {
    return bad("Prediction ID and winning option ID are required.");
  }

  const pred = await one(
    `SELECT p.id, p.site_id, p.title, p.options, p.status, p.total_pool
       FROM predictions p
       JOIN sites s ON s.id = p.site_id
      WHERE p.id=$1 AND s.user_id=$2`,
    [predictionId, user.id]
  );

  if (!pred) return bad("Prediction not found or access denied.", 404);
  if (pred.status === "settled" || pred.status === "cancelled") {
    return bad("Prediction has already been resolved or cancelled.", 400);
  }

  // Validate the winning option belongs to this prediction.
  const predOptions = fromJsonb(pred.options) || [];
  if (!predOptions.some((opt) => String(opt.id).toLowerCase() === winningOptionId)) {
    return bad("Winning option does not belong to this prediction.", 400);
  }

  const totalPool = pred.total_pool || 0;

  const results = await withTransaction(async (tx) => {
    // Atomically close betting inside the transaction so a wager can never
    // slip in between reading the bets and paying them out.
    const closed = await tx.one(
      "UPDATE predictions SET status='locked', updated_at=now() WHERE id=$1 AND status IN ('open','locked') RETURNING id",
      [predictionId]
    );
    if (!closed) return { error: "Prediction has already been resolved or cancelled.", status: 400 };

    const bets = await tx.unsafe(
      `SELECT b.id, b.site_viewer_id, b.viewer_id, b.option_id, b.amount
         FROM prediction_bets b
        WHERE b.prediction_id=$1`,
      [predictionId]
    );

    const winningBets = bets.filter((b) => b.option_id === winningOptionId);
    const winningTotal = winningBets.reduce((sum, b) => sum + b.amount, 0);

    // 1. If no winning bets, refund everyone
    if (winningTotal === 0 || winningBets.length === 0) {
      for (const bet of bets) {
        await tx.unsafe(
          "UPDATE site_viewers SET balance = balance + $1, updated_at=now() WHERE id=$2",
          [bet.amount, bet.site_viewer_id]
        );
        await tx.unsafe(
          `INSERT INTO credit_ledger (site_viewer_id, type, amount, description)
           VALUES ($1, 'refund', $2, $3)`,
          [bet.site_viewer_id, bet.amount, `Prediction Refund (No Winners): ${pred.title}`]
        );
      }
      await tx.unsafe(
        "UPDATE predictions SET status='settled', winning_option_id=$1, settled_at=now(), updated_at=now() WHERE id=$2",
        [winningOptionId, predictionId]
      );
      return { totalWinners: 0, totalPayout: 0, refunded: true };
    }

    // 2. Distribute proportional dynamic payout
    let totalDistributed = 0;
    for (const winBet of winningBets) {
      const share = winBet.amount / winningTotal;
      const payout = Math.floor(share * totalPool);
      totalDistributed += payout;

      await tx.unsafe(
        "UPDATE prediction_bets SET payout=$1 WHERE id=$2",
        [payout, winBet.id]
      );

      await tx.unsafe(
        "UPDATE site_viewers SET balance = balance + $1, total_earned = total_earned + $1, updated_at=now() WHERE id=$2",
        [payout, winBet.site_viewer_id]
      );

      await tx.unsafe(
        `INSERT INTO credit_ledger (site_viewer_id, type, amount, description)
         VALUES ($1, 'win', $2, $3)`,
        [winBet.site_viewer_id, payout, `Prediction Payout (${winningOptionId.toUpperCase()}): ${pred.title}`]
      );
    }

    await tx.unsafe(
      "UPDATE predictions SET status='settled', winning_option_id=$1, settled_at=now(), updated_at=now() WHERE id=$2",
      [winningOptionId, predictionId]
    );

    return { totalWinners: winningBets.length, totalPayout: totalDistributed, refunded: false };
  });
  if (results.error) return bad(results.error, results.status);

  await logAudit({
    actorId: user.id,
    action: "prediction_settle",
    entityType: "prediction",
    entityId: predictionId,
    request,
    details: { winningOptionId, totalWinners: results.totalWinners, totalPayout: results.totalPayout },
  });

  return ok({
    predictionId,
    status: "settled",
    winningOptionId,
    totalWinners: results.totalWinners,
    totalPayout: results.totalPayout,
    message: results.refunded
      ? "No bets were placed on the winning option; all bets were refunded."
      : `🎉 Prediction settled! Distributed ${results.totalPayout} credits to ${results.totalWinners} winners!`,
  });
}

/**
 * POST /api/predictions/:id/cancel — Cancel prediction and refund all bets
 */
export async function handleCancelPrediction(request, env, deps = {}) {
  const {
    requireUser = defaultRequireUser,
    one = defaultOne,
    query = defaultQuery,
    withTransaction = defaultWithTransaction,
    logAudit = defaultLogAudit,
  } = deps;

  const { user, res } = await requireUser(request, env);
  if (res) return res;

  const body = await readJson(request);
  const predictionId = String(body?.predictionId || "").trim();
  if (!predictionId) return bad("Prediction ID is required.");

  const pred = await one(
    `SELECT p.id, p.title, p.status FROM predictions p
       JOIN sites s ON s.id = p.site_id
      WHERE p.id=$1 AND s.user_id=$2`,
    [predictionId, user.id]
  );

  if (!pred) return bad("Prediction not found or access denied.", 404);
  if (pred.status === "settled" || pred.status === "cancelled") {
    return bad("Prediction is already resolved or cancelled.", 400);
  }

  const bets = await query(
    `SELECT b.id, b.site_viewer_id, b.amount FROM prediction_bets b WHERE b.prediction_id=$1`,
    [predictionId]
  );

  await withTransaction(async (tx) => {
    for (const bet of bets) {
      await tx.unsafe(
        "UPDATE site_viewers SET balance = balance + $1, updated_at=now() WHERE id=$2",
        [bet.amount, bet.site_viewer_id]
      );
      await tx.unsafe(
        `INSERT INTO credit_ledger (site_viewer_id, type, amount, description)
         VALUES ($1, 'refund', $2, $3)`,
        [bet.site_viewer_id, bet.amount, `Cancelled Prediction Refund: ${pred.title}`]
      );
    }
    await tx.unsafe("UPDATE predictions SET status='cancelled', updated_at=now() WHERE id=$1", [predictionId]);
  });

  await logAudit({
    actorId: user.id,
    action: "prediction_cancel",
    entityType: "prediction",
    entityId: predictionId,
    request,
    details: { betsRefunded: bets.length },
  });

  return ok({ predictionId, status: "cancelled", message: `Prediction cancelled and ${bets.length} bets refunded.` });
}


