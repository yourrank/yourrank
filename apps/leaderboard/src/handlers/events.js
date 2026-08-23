// Community Events Handlers: Raffles (Ticket Draws) & Flash Code Drops.
import { requireUser as defaultRequireUser, ok, bad, readJson } from "../auth.js";
import { getByUser as defaultGetByUser, getBoardById as defaultGetBoardById } from "../site.js";
import { requireSiteCapability } from "../site-authorization.js";
import {
  one as defaultOne,
  query as defaultQuery,
  exec as defaultExec,
  withTransaction as defaultWithTransaction,
} from "@yourrank/shared/db";
import { rateLimit as defaultRateLimit } from "@yourrank/shared/ratelimit";
import { logAudit as defaultLogAudit } from "@yourrank/shared/audit";
import { requireViewer as defaultRequireViewer } from "./viewer-auth.js";

function getCryptoRandomInt(max) {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return arr[0] % max;
}

/**
 * GET /api/events/raffles — List raffles for streamer dashboard
 */
export async function handleGetRaffles(request, env, deps = {}) {
  const {
    requireUser = defaultRequireUser,
    getByUser = defaultGetByUser,
    getBoardById = defaultGetBoardById,
    query = defaultQuery,
  } = deps;

  const { user, res } = await requireUser(request, env);
  if (res) return res;

  const url = new URL(request.url);
  const siteId = url.searchParams.get("siteId");
  const site = siteId ? await getBoardById(env, user.id, siteId) : await getByUser(env, user.id);
  if (!site) return bad("Site not found", 404);
  const authorization = await requireSiteCapability(user, site, "canRoleManageBoard");
  if (authorization.res) return authorization.res;

  const raffles = await query(
    `SELECT r.id, r.title, r.description, r.ticket_cost, r.max_tickets_per_viewer, r.status,
            r.winner_name, r.winner_ticket_number, r.total_tickets, r.ends_at, r.drawn_at, r.created_at,
            (SELECT count(DISTINCT site_viewer_id) FROM raffle_tickets WHERE raffle_id=r.id) AS participant_count
       FROM raffles r
      WHERE r.site_id=$1
      ORDER BY r.created_at DESC LIMIT 50`,
    [site.id]
  );

  return ok({ raffles: raffles || [] });
}

/**
 * POST /api/events/raffles — Create a new ticket raffle
 */
export async function handleCreateRaffle(request, env, deps = {}) {
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
  if (!title) return bad("Raffle prize title is required.");

  const ticketCost = Math.max(0, parseInt(body?.ticketCost, 10) || 50);
  const maxTickets = Math.max(1, parseInt(body?.maxTickets, 10) || 10);
  const description = String(body?.description || "").trim().slice(0, 500);

  const url = new URL(request.url);
  const siteId = body?.siteId || url.searchParams.get("siteId");
  const site = siteId ? await getBoardById(env, user.id, siteId) : await getByUser(env, user.id);
  if (!site) return bad("Site not found", 404);
  const authorization = await requireSiteCapability(user, site, "canRoleManageBoard");
  if (authorization.res) return authorization.res;

  const endsAt = body?.endsAt ? new Date(body.endsAt).toISOString() : null;

  const result = await one(
    `INSERT INTO raffles (site_id, title, description, ticket_cost, max_tickets_per_viewer, ends_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, title, ticket_cost, max_tickets_per_viewer, status, created_at`,
    [site.id, title, description, ticketCost, maxTickets, endsAt]
  );

  await logAudit({
    actorId: user.id,
    action: "raffle_create",
    entityType: "raffle",
    entityId: result.id,
    request,
    details: { title, ticketCost, maxTickets },
  });

  return ok({ raffle: result, message: "Raffle created successfully! 🎉" });
}

/**
 * POST /api/events/raffles/draw — Draw a random winning ticket for an active raffle
 */
export async function handleDrawRaffle(request, env, deps = {}) {
  const {
    requireUser = defaultRequireUser,
    one = defaultOne,
    query = defaultQuery,
    exec = defaultExec,
    logAudit = defaultLogAudit,
  } = deps;

  const { user, res } = await requireUser(request, env);
  if (res) return res;

  const body = await readJson(request);
  const raffleId = String(body?.raffleId || "").trim();
  if (!raffleId) return bad("Raffle ID is required.");

  const raffle = await one(
    `SELECT r.id, r.site_id, r.title, r.status, r.total_tickets
       FROM raffles r
       JOIN sites s ON s.id = r.site_id
      WHERE r.id=$1 AND s.user_id=$2`,
    [raffleId, user.id]
  );

  if (!raffle) return bad("Raffle not found or you do not have permission.", 404);
  if (raffle.status !== "active") return bad("This raffle has already been drawn or closed.", 400);

  const tickets = await query(
    `SELECT t.id, t.ticket_number, t.viewer_id, t.site_viewer_id,
            COALESCE(v.kick_username, 'Viewer') AS viewer_name
       FROM raffle_tickets t
       LEFT JOIN viewers v ON v.id = t.viewer_id
      WHERE t.raffle_id=$1
      ORDER BY t.ticket_number ASC`,
    [raffleId]
  );

  if (!tickets || tickets.length === 0) {
    await exec("UPDATE raffles SET status='drawn', drawn_at=now(), updated_at=now() WHERE id=$1", [raffleId]);
    return ok({
      raffleId,
      status: "drawn",
      winnerName: null,
      message: "Raffle closed with 0 tickets sold.",
    });
  }

  // Provably fair random draw
  const winningIndex = getCryptoRandomInt(tickets.length);
  const winningTicket = tickets[winningIndex];

  await exec(
    `UPDATE raffles
        SET status='drawn',
            winner_viewer_id=$1,
            winner_name=$2,
            winner_ticket_number=$3,
            drawn_at=now(),
            updated_at=now()
      WHERE id=$4`,
    [winningTicket.viewer_id, winningTicket.viewer_name, winningTicket.ticket_number, raffleId]
  );

  await logAudit({
    actorId: user.id,
    action: "raffle_draw",
    entityType: "raffle",
    entityId: raffleId,
    request,
    details: {
      winnerName: winningTicket.viewer_name,
      ticketNumber: winningTicket.ticket_number,
      totalTickets: tickets.length,
    },
  });

  return ok({
    raffleId,
    status: "drawn",
    winnerName: winningTicket.viewer_name,
    winnerTicketNumber: winningTicket.ticket_number,
    totalTickets: tickets.length,
    message: `🎉 Winner drawn: ${winningTicket.viewer_name} (Ticket #${winningTicket.ticket_number})!`,
  });
}

/**
 * POST /api/events/raffles/tickets — Viewer buys raffle ticket(s)
 */
export async function handleBuyRaffleTicket(request, env, deps = {}) {
  const {
    one = defaultOne,
    withTransaction = defaultWithTransaction,
    requireViewer = defaultRequireViewer,
    rateLimit = defaultRateLimit,
    logAudit = defaultLogAudit,
  } = deps;

  const { viewer, res } = await requireViewer(request, env);
  if (res) return res;

  const body = await readJson(request);
  const raffleId = String(body?.raffleId || "").trim();
  const requestedCount = Math.max(1, Math.min(100, parseInt(body?.count, 10) || 1));

  if (!raffleId) return bad("Raffle ID is required.");

  const rl = await rateLimit(env, `raffle:ticket:${viewer.id}`, 30, 60);
  if (!rl.ok) return bad("Too many attempts. Please wait a minute.", 429);

  const raffle = await one(
    `SELECT id, site_id, title, ticket_cost, max_tickets_per_viewer, status, total_tickets, ends_at
       FROM raffles
      WHERE id=$1 AND status='active'`,
    [raffleId]
  );

  if (!raffle) return bad("Raffle not found or no longer active.", 404);
  if (raffle.ends_at && new Date(raffle.ends_at).getTime() < Date.now()) {
    return bad("This raffle has ended.", 400);
  }

  const siteViewer = await one(
    `INSERT INTO site_viewers (site_id, viewer_id, balance, total_earned, total_spent)
     VALUES ($1, $2, 0, 0, 0)
     ON CONFLICT (site_id, viewer_id) DO UPDATE SET updated_at=now()
     RETURNING id, balance`,
    [raffle.site_id, viewer.id]
  );

  const existing = await one(
    `SELECT count(*)::int AS count FROM raffle_tickets WHERE raffle_id=$1 AND viewer_id=$2`,
    [raffle.id, viewer.id]
  );

  const count = Math.min(requestedCount, raffle.max_tickets_per_viewer - (existing?.count || 0));
  if (count <= 0) {
    return bad(`You already have the maximum ${raffle.max_tickets_per_viewer} ticket(s) for this raffle.`, 400);
  }

  const totalCost = (raffle.ticket_cost || 0) * count;
  if ((siteViewer.balance || 0) < totalCost) {
    return bad(`Insufficient credits. ${count} ticket(s) cost ${totalCost} credits.`, 400);
  }

  const outcome = await withTransaction(async (tx) => {
    const locked = await tx.one(
      `SELECT site_id, ticket_cost, max_tickets_per_viewer, status, total_tickets, ends_at
         FROM raffles WHERE id=$1 FOR UPDATE`,
      [raffle.id]
    );
    if (!locked || locked.status !== "active") {
      return { error: "Raffle is no longer active.", status: 400 };
    }
    if (locked.ends_at && new Date(locked.ends_at).getTime() < Date.now()) {
      return { error: "This raffle has ended.", status: 400 };
    }

    const lockedViewer = await tx.one(
      "SELECT id, balance FROM site_viewers WHERE id=$1 FOR UPDATE",
      [siteViewer.id]
    );
    if (!lockedViewer || lockedViewer.balance < (locked.ticket_cost || 0) * count) {
      return { error: "Insufficient credits.", status: 400 };
    }

    const lockedExisting = await tx.one(
      `SELECT count(*)::int AS count FROM raffle_tickets WHERE raffle_id=$1 AND viewer_id=$2`,
      [raffle.id, viewer.id]
    );
    if ((lockedExisting?.count || 0) + count > locked.max_tickets_per_viewer) {
      return { error: `Maximum ${locked.max_tickets_per_viewer} tickets per viewer.`, status: 400 };
    }

    for (let i = 0; i < count; i++) {
      const ticketNumber = locked.total_tickets + i + 1;
      await tx.unsafe(
        `INSERT INTO raffle_tickets (raffle_id, site_viewer_id, viewer_id, ticket_number, viewer_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [raffle.id, siteViewer.id, viewer.id, ticketNumber, viewer.kick_username || viewer.discord_username || "Viewer"]
      );
    }

    const updatedViewer = await tx.one(
      "UPDATE site_viewers SET balance = balance - $1, total_spent = total_spent + $1, updated_at=now() WHERE id=$2 RETURNING id, balance",
      [totalCost, siteViewer.id]
    );

    const updatedRaffle = await tx.one(
      "UPDATE raffles SET total_tickets = total_tickets + $1, updated_at=now() WHERE id=$2 RETURNING total_tickets",
      [count, raffle.id]
    );

    await tx.unsafe(
      `INSERT INTO credit_ledger (site_viewer_id, type, amount, description)
       VALUES ($1, 'spend', $2, $3)`,
      [siteViewer.id, -totalCost, `Raffle tickets: ${raffle.title}`]
    );

    return {
      newBalance: updatedViewer.balance,
      totalTickets: updatedRaffle.total_tickets,
    };
  });

  if (outcome.error) return bad(outcome.error, outcome.status);

  await logAudit({
    actorId: viewer.id,
    action: "raffle_buy_ticket",
    entityType: "raffle",
    entityId: raffle.id,
    request,
    details: { ticketsBought: count, totalCost, newBalance: outcome.newBalance },
  });

  return ok({
    ok: true,
    ticketsBought: count,
    newBalance: outcome.newBalance,
    totalTickets: outcome.totalTickets,
    cost: totalCost,
  });
}

/**
 * GET /api/events/drops — List flash code drops
 */
export async function handleGetCodeDrops(request, env, deps = {}) {
  const {
    requireUser = defaultRequireUser,
    getByUser = defaultGetByUser,
    getBoardById = defaultGetBoardById,
    query = defaultQuery,
  } = deps;

  const { user, res } = await requireUser(request, env);
  if (res) return res;

  const url = new URL(request.url);
  const siteId = url.searchParams.get("siteId");
  const site = siteId ? await getBoardById(env, user.id, siteId) : await getByUser(env, user.id);
  if (!site) return bad("Site not found", 404);
  const authorization = await requireSiteCapability(user, site, "canRoleManageBoard");
  if (authorization.res) return authorization.res;

  const drops = await query(
    `SELECT id, code, points_reward, max_claims, claimed_count, status, expires_at, created_at
       FROM code_drops
      WHERE site_id=$1
      ORDER BY created_at DESC LIMIT 50`,
    [site.id]
  );

  return ok({ drops: drops || [] });
}

/**
 * POST /api/events/drops — Create a new flash code drop
 */
export async function handleCreateCodeDrop(request, env, deps = {}) {
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
  const rawCode = String(body?.code || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  if (!rawCode || rawCode.length < 3) return bad("Code must be at least 3 alphanumeric characters.");

  const pointsReward = Math.max(1, parseInt(body?.pointsReward, 10) || 100);
  const maxClaims = Math.max(1, parseInt(body?.maxClaims, 10) || 50);
  const expireMinutes = parseInt(body?.expireMinutes, 10) || 0;
  const expiresAt = expireMinutes > 0 ? new Date(Date.now() + expireMinutes * 60000).toISOString() : null;

  const url = new URL(request.url);
  const siteId = body?.siteId || url.searchParams.get("siteId");
  const site = siteId ? await getBoardById(env, user.id, siteId) : await getByUser(env, user.id);
  if (!site) return bad("Site not found", 404);
  const authorization = await requireSiteCapability(user, site, "canRoleManageBoard");
  if (authorization.res) return authorization.res;

  try {
    const result = await one(
      `INSERT INTO code_drops (site_id, code, points_reward, max_claims, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, code, points_reward, max_claims, claimed_count, status, expires_at, created_at`,
      [site.id, rawCode, pointsReward, maxClaims, expiresAt]
    );

    await logAudit({
      actorId: user.id,
      action: "code_drop_create",
      entityType: "code_drop",
      entityId: result.id,
      request,
      details: { code: rawCode, pointsReward, maxClaims },
    });

    return ok({ drop: result, message: `Drop code ${rawCode} is now live! ⚡` });
  } catch (err) {
    if (String(err?.message || "").includes("idx_code_drops_site_code")) {
      return bad("A drop with this code already exists for this site.");
    }
    throw err;
  }
}

/**
 * POST /api/events/drops/claim — Viewer redeems a flash drop code
 */
export async function handleClaimCodeDrop(request, env, deps = {}) {
  const {
    one = defaultOne,
    exec = defaultExec,
    withTransaction = defaultWithTransaction,
    rateLimit = defaultRateLimit,
    requireViewer = defaultRequireViewer,
  } = deps;

  const { viewer, res } = await requireViewer(request, env);
  if (res) return res;

  const body = await readJson(request);
  const rawCode = String(body?.code || "").trim().toUpperCase();
  const siteSlugOrId = String(body?.site || body?.siteId || "").trim();
  const viewerId = viewer.id;

  if (!rawCode || !siteSlugOrId) {
    return bad("Code and site are required.");
  }

  // Rate limit claims by IP / viewer to prevent brute forcing
  const clientIp = request.headers.get("cf-connecting-ip") || "anon";
  const rl = await rateLimit(env, `drop:claim:${viewerId}:${clientIp}`, 15, 60);
  if (!rl.ok) return bad("Too many attempts. Please wait a minute.", 429);

  // Find site
  const site = await one("SELECT id, slug FROM sites WHERE slug=$1 OR id::text=$1", [siteSlugOrId]);
  if (!site) return bad("Site not found.", 404);

  // Find active drop
  const drop = await one(
    `SELECT id, code, points_reward, max_claims, claimed_count, status, expires_at
       FROM code_drops
      WHERE site_id=$1 AND lower(code)=lower($2) AND status='active'`,
    [site.id, rawCode]
  );

  if (!drop) {
    return bad("Invalid or expired drop code.", 404);
  }

  if (drop.expires_at && new Date(drop.expires_at).getTime() < Date.now()) {
    await exec("UPDATE code_drops SET status='expired', updated_at=now() WHERE id=$1", [drop.id]);
    return bad("This drop code has expired.", 400);
  }

  if (drop.claimed_count >= drop.max_claims) {
    await exec("UPDATE code_drops SET status='exhausted', updated_at=now() WHERE id=$1", [drop.id]);
    return bad("All claims for this drop have been taken!", 400);
  }

  // Resolve viewer. Create a site membership row on first interaction
  // so a viewer can claim a drop, place a bet, or buy a raffle ticket
  // without having earned credits first.
  const siteViewer = await one(
    `INSERT INTO site_viewers (site_id, viewer_id, balance, total_earned, total_spent)
     VALUES ($1, $2, 0, 0, 0)
     ON CONFLICT (site_id, viewer_id) DO UPDATE SET updated_at=now()
     RETURNING id, balance`,
    [site.id, viewerId]
  );

  // Check if viewer already claimed
  const alreadyClaimed = await one(
    "SELECT id FROM code_drop_claims WHERE code_drop_id=$1 AND viewer_id=$2",
    [drop.id, viewerId]
  );
  if (alreadyClaimed) {
    return bad("You have already claimed this drop code!", 400);
  }

  // Execute atomic claim and points award
  const outcome = await withTransaction(async (tx) => {
    // Re-verify under row lock
    const lockedDrop = await tx.one("SELECT claimed_count, max_claims FROM code_drops WHERE id=$1 FOR UPDATE", [drop.id]);
    if (lockedDrop.claimed_count >= lockedDrop.max_claims) {
      await tx.unsafe("UPDATE code_drops SET status='exhausted' WHERE id=$1", [drop.id]);
      return { exhausted: true };
    }

    // Claim first: a duplicate conflicts here, so the count below only ever
    // counts claims that were actually recorded.
    const claim = await tx.one(
      `INSERT INTO code_drop_claims (code_drop_id, site_viewer_id, viewer_id, points_awarded)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (code_drop_id, viewer_id) DO NOTHING
       RETURNING id`,
      [drop.id, siteViewer.id, viewerId, drop.points_reward]
    );
    if (!claim) return { alreadyClaimed: true };

    const newClaimedCount = lockedDrop.claimed_count + 1;
    const newStatus = newClaimedCount >= lockedDrop.max_claims ? "exhausted" : "active";

    await tx.unsafe(
      "UPDATE code_drops SET claimed_count=$1, status=$2, updated_at=now() WHERE id=$3",
      [newClaimedCount, newStatus, drop.id]
    );

    const updatedViewer = await tx.one(
      "UPDATE site_viewers SET balance = balance + $1, total_earned = total_earned + $1, updated_at=now() WHERE id=$2 RETURNING id, balance",
      [drop.points_reward, siteViewer.id]
    );

    await tx.unsafe(
      `INSERT INTO credit_ledger (site_viewer_id, type, amount, description)
       VALUES ($1, 'reward', $2, $3)`,
      [siteViewer.id, drop.points_reward, `Flash Code Drop: ${drop.code}`]
    );

    return { success: true, pointsAwarded: drop.points_reward, newBalance: updatedViewer.balance };
  });

  if (outcome?.exhausted) {
    return bad("All claims for this drop have been taken!", 400);
  }
  if (outcome?.alreadyClaimed) {
    return bad("You have already claimed this drop code!", 400);
  }

  return ok({
    code: drop.code,
    pointsAwarded: outcome.pointsAwarded,
    newBalance: outcome.newBalance,
    message: `🎉 Success! +${outcome.pointsAwarded} credits added to your balance.`,
  });
}
