// Viewer 1v1 Duels & Wager Challenges Handlers.
import { ok, bad, readJson } from "../auth.js";
import {
  one as defaultOne,
  query as defaultQuery,
  withTransaction as defaultWithTransaction,
} from "@yourrank/shared/db";
import { requireViewer as defaultRequireViewer } from "./viewer-auth.js";
import { rateLimit as defaultRateLimit } from "@yourrank/shared/ratelimit";

function getCryptoRandomRoll() {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return (arr[0] % 100) + 1; // 1 - 100
}

/**
 * GET /api/duels/active — List active and recent duels
 */
export async function handleGetDuels(request, env, deps = {}) {
  const {
    one = defaultOne,
    query = defaultQuery,
  } = deps;

  const url = new URL(request.url);
  const siteSlugOrId = url.searchParams.get("site") || url.searchParams.get("siteId");
  if (!siteSlugOrId) return bad("Site identifier is required.");

  const site = await one("SELECT id, name FROM sites WHERE slug=$1 OR id::text=$1", [siteSlugOrId]);
  if (!site) return bad("Site not found.", 404);

  const duels = await query(
    `SELECT d.id, d.wager_amount, d.status, d.roll_details, d.created_at, d.expires_at,
            vc.kick_username AS challenger_name,
            vt.kick_username AS target_name,
            vw.kick_username AS winner_name
       FROM viewer_duels d
       JOIN viewers vc ON vc.id = d.challenger_viewer_id
       JOIN viewers vt ON vt.id = d.target_viewer_id
  LEFT JOIN viewers vw ON vw.id = d.winner_viewer_id
      WHERE d.site_id=$1
      ORDER BY d.created_at DESC LIMIT 30`,
    [site.id]
  );

  return ok({ duels: duels || [] });
}

/**
 * POST /api/duels/create — Create a 1v1 duel challenge
 */
export async function handleCreateDuel(request, env, deps = {}) {
  const {
    one = defaultOne,
    withTransaction = defaultWithTransaction,
    requireViewer = defaultRequireViewer,
    rateLimit = defaultRateLimit,
  } = deps;

  const { viewer, res } = await requireViewer(request, env);
  if (res) return res;

  const body = await readJson(request);
  const siteSlugOrId = String(body?.site || body?.siteId || "").trim();
  const challengerViewerId = viewer.id;
  const targetUsername = String(body?.targetUsername || "").trim().toLowerCase();
  const wagerAmount = parseInt(body?.wagerAmount, 10) || 0;

  if (!siteSlugOrId || !targetUsername || wagerAmount <= 0) {
    return bad("site, targetUsername, and positive wagerAmount are required.");
  }

  const rl = await rateLimit(env, `duel:create:${challengerViewerId}`, 10, 60);
  if (!rl.ok) return bad("Too many attempts. Please wait a minute.", 429);

  const site = await one("SELECT id, name FROM sites WHERE slug=$1 OR id::text=$1", [siteSlugOrId]);
  if (!site) return bad("Site not found.", 404);

  const challengerSv = await one(
    "SELECT id, balance FROM site_viewers WHERE site_id=$1 AND viewer_id=$2",
    [site.id, challengerViewerId]
  );
  if (!challengerSv) return bad("Challenger viewer not found.", 404);
  if ((challengerSv.balance || 0) < wagerAmount) {
    return bad(`Insufficient credits. You need ${wagerAmount} pts to challenge (you have ${challengerSv.balance || 0} pts).`);
  }

  const targetViewer = await one("SELECT id, kick_username FROM viewers WHERE lower(kick_username)=$1", [targetUsername]);
  if (!targetViewer) return bad(`Viewer @${targetUsername} not found.`, 404);
  if (targetViewer.id === challengerViewerId) return bad("You cannot duel yourself!", 400);

  const targetSv = await one("SELECT id, balance FROM site_viewers WHERE site_id=$1 AND viewer_id=$2", [site.id, targetViewer.id]);
  if (!targetSv) return bad(`Viewer @${targetUsername} has not joined this streamer's community yet.`, 404);
  if ((targetSv.balance || 0) < wagerAmount) {
    return bad(`@${targetUsername} does not have enough points for a ${wagerAmount} pts duel (they have ${targetSv.balance || 0} pts).`);
  }

  const result = await withTransaction(async (tx) => {
    const updatedChallenger = await tx.one(
      "UPDATE site_viewers SET balance = balance - $1, updated_at=now() WHERE id=$2 AND balance >= $1 RETURNING id, balance",
      [wagerAmount, challengerSv.id]
    );
    if (!updatedChallenger) return { error: `Insufficient credits. You need ${wagerAmount} pts to challenge (you have ${challengerSv.balance || 0} pts).`, status: 400 };

    const duel = await tx.one(
      `INSERT INTO viewer_duels (site_id, challenger_viewer_id, challenger_site_viewer_id, target_viewer_id, target_site_viewer_id, wager_amount)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, wager_amount, status, created_at`,
      [site.id, challengerViewerId, challengerSv.id, targetViewer.id, targetSv.id, wagerAmount]
    );

    await tx.unsafe(
      `INSERT INTO credit_ledger (site_viewer_id, type, amount, description)
       VALUES ($1, 'bet', $2, $3)`,
      [challengerSv.id, -wagerAmount, `Duel Challenge against @${targetViewer.kick_username} (${wagerAmount} pts)`]
    );

    return { duel, balance: updatedChallenger.balance };
  });
  if (result.error) return bad(result.error, result.status);

  return ok({
    duel: result.duel,
    message: `⚔️ Duel challenge sent to @${targetViewer.kick_username} for ${wagerAmount} pts! Waiting for acceptance...`,
  });
}

/**
 * POST /api/duels/:id/accept — Target accepts duel; execute provably fair roll
 */
export async function handleAcceptDuel(request, env, deps = {}) {
  const {
    one = defaultOne,
    withTransaction = defaultWithTransaction,
    requireViewer = defaultRequireViewer,
    rateLimit = defaultRateLimit,
  } = deps;

  const { viewer, res } = await requireViewer(request, env);
  if (res) return res;

  const body = await readJson(request);
  const duelId = String(body?.duelId || "").trim();
  const targetViewerId = viewer.id;

  if (!duelId) return bad("duelId is required.");

  const rl = await rateLimit(env, `duel:accept:${targetViewerId}`, 10, 60);
  if (!rl.ok) return bad("Too many attempts. Please wait a minute.", 429);

  const duel = await one(
    `SELECT d.id, d.site_id, d.challenger_viewer_id, d.challenger_site_viewer_id,
            d.target_viewer_id, d.target_site_viewer_id, d.wager_amount, d.status,
            vc.kick_username AS challenger_name, vt.kick_username AS target_name
       FROM viewer_duels d
       JOIN viewers vc ON vc.id = d.challenger_viewer_id
       JOIN viewers vt ON vt.id = d.target_viewer_id
      WHERE d.id=$1`,
    [duelId]
  );

  if (!duel) return bad("Duel not found.", 404);
  if (duel.status !== "pending") return bad("Duel is no longer pending.", 400);
  if (duel.target_viewer_id !== targetViewerId) return bad("Only the challenged viewer can accept this duel.", 403);

  const targetSv = await one("SELECT id, balance FROM site_viewers WHERE id=$1", [duel.target_site_viewer_id]);
  if (!targetSv || (targetSv.balance || 0) < duel.wager_amount) {
    return bad(`Insufficient credits. You need ${duel.wager_amount} pts to accept.`);
  }

  // Provably fair roll
  let rollChallenger = getCryptoRandomRoll();
  let rollTarget = getCryptoRandomRoll();
  while (rollChallenger === rollTarget) {
    rollChallenger = getCryptoRandomRoll();
    rollTarget = getCryptoRandomRoll();
  }

  const challengerWon = rollChallenger > rollTarget;
  const winnerViewerId = challengerWon ? duel.challenger_viewer_id : duel.target_viewer_id;
  const winnerSiteViewerId = challengerWon ? duel.challenger_site_viewer_id : duel.target_site_viewer_id;
  const winnerName = challengerWon ? duel.challenger_name : duel.target_name;
  const totalPot = duel.wager_amount * 2;

  const rollDetails = {
    challenger_roll: rollChallenger,
    target_roll: rollTarget,
    challenger_name: duel.challenger_name,
    target_name: duel.target_name,
  };

  const result = await withTransaction(async (tx) => {
    const updatedTarget = await tx.one(
      "UPDATE site_viewers SET balance = balance - $1, updated_at=now() WHERE id=$2 AND balance >= $1 RETURNING id, balance",
      [duel.wager_amount, targetSv.id]
    );
    if (!updatedTarget) return { error: `Insufficient credits. You need ${duel.wager_amount} pts to accept.`, status: 400 };

    // 2. Award total pot to winner
    await tx.unsafe(
      "UPDATE site_viewers SET balance = balance + $1, total_earned = total_earned + $1, updated_at=now() WHERE id=$2",
      [totalPot, winnerSiteViewerId]
    );

    // 3. Record in ledger
    await tx.unsafe(
      `INSERT INTO credit_ledger (site_viewer_id, type, amount, description)
       VALUES ($1, 'bet', $2, $3)`,
      [targetSv.id, -duel.wager_amount, `Accepted Duel vs @${duel.challenger_name} (${duel.wager_amount} pts)`]
    );

    await tx.unsafe(
      `INSERT INTO credit_ledger (site_viewer_id, type, amount, description)
       VALUES ($1, 'win', $2, $3)`,
      [winnerSiteViewerId, totalPot, `Won Duel Pot vs ${challengerWon ? duel.target_name : duel.challenger_name} (+${totalPot} pts)`]
    );

    // 4. Update duel status
    await tx.unsafe(
      `UPDATE viewer_duels
          SET status='completed', winner_viewer_id=$1, roll_details=$2
        WHERE id=$3`,
      [winnerViewerId, rollDetails, duel.id]
    );
    return { balance: updatedTarget.balance };
  });
  if (result.error) return bad(result.error, result.status);

  return ok({
    duelId: duel.id,
    winnerName,
    winnerViewerId,
    totalPot,
    rollDetails,
    message: `🏆 @${winnerName} won the duel! (${challengerWon ? `${duel.challenger_name} (${rollChallenger}) vs ${duel.target_name} (${rollTarget})` : `${duel.target_name} (${rollTarget}) vs ${duel.challenger_name} (${rollChallenger})`}) +${totalPot} credits!`,
  });
}

/**
 * POST /api/duels/:id/decline — Decline or cancel duel challenge
 */
export async function handleDeclineDuel(request, env, deps = {}) {
  const {
    one = defaultOne,
    withTransaction = defaultWithTransaction,
    requireViewer = defaultRequireViewer,
    rateLimit = defaultRateLimit,
  } = deps;

  const { viewer, res } = await requireViewer(request, env);
  if (res) return res;

  const body = await readJson(request);
  const duelId = String(body?.duelId || "").trim();
  const viewerId = viewer.id;

  if (!duelId) return bad("duelId is required.");

  const rl = await rateLimit(env, `duel:decline:${viewerId}`, 10, 60);
  if (!rl.ok) return bad("Too many attempts. Please wait a minute.", 429);

  const duel = await one(
    "SELECT id, challenger_site_viewer_id, challenger_viewer_id, target_viewer_id, wager_amount, status FROM viewer_duels WHERE id=$1",
    [duelId]
  );
  if (!duel) return bad("Duel not found.", 404);
  if (duel.status !== "pending") return bad("Duel is no longer pending.", 400);

  if (duel.challenger_viewer_id !== viewerId && duel.target_viewer_id !== viewerId) {
    return bad("Unauthorized to decline this duel.", 403);
  }

  await withTransaction(async (tx) => {
    // Refund challenger
    await tx.unsafe(
      "UPDATE site_viewers SET balance = balance + $1, updated_at=now() WHERE id=$2",
      [duel.wager_amount, duel.challenger_site_viewer_id]
    );

    await tx.unsafe(
      `INSERT INTO credit_ledger (site_viewer_id, type, amount, description)
       VALUES ($1, 'refund', $2, 'Duel Cancelled/Declined Refund')`,
      [duel.challenger_site_viewer_id, duel.wager_amount]
    );

    await tx.unsafe("UPDATE viewer_duels SET status='declined' WHERE id=$1", [duel.id]);
  });

  return ok({ duelId: duel.id, status: "declined", message: "Duel declined and points refunded." });
}
