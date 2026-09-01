import { requireUser, json, bad, readJson, rateLimit } from "../auth.js";
import { getBoardById, getPlayers, saveSite } from "../site.js";
import { logAudit } from "@yourrank/shared/audit";
import { requireSiteCapability } from "../site-authorization.js";
import { normalizePlayerName, rankField, sortPlayersForRanking, validateIncrementAmount } from "../player-rules.js";

// POST /api/sites/:id/quick-add
// Takes { name: "Steve", amount: 500 }
// Updates existing player or creates new one, then saves board.
export async function handleQuickAdd(request, env) {
  const { user, res } = await requireUser(request, env);
  if (res) return res;
  if (user.status === "suspended") return bad("This account is suspended.", 403);
  
  if (!(await rateLimit(env, `quick-add:${user.id}`, 60, 60)).ok) return bad("Too many requests. Try again shortly.", 429);
  
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/sites\/([^/]+)\/quick-add$/);
  const siteId = match ? match[1] : null;
  if (!siteId) return bad("Invalid board ID", 400);

  const payload = await readJson(request);
  const playerName = String(payload?.name || "").trim().replace(/\s+/g, " ");
  if (!playerName) return bad("Player name required", 400);
  const amountResult = validateIncrementAmount(payload?.amount);
  if (amountResult.error) return bad(amountResult.error, 400);
  const amount = amountResult.amount;

  // Fetch current site state
  const site = await getBoardById(env, user.id, siteId);
  if (!site) return bad("Board not found", 404);
  const authorization = await requireSiteCapability(user, site, "canRoleManageBoard");
  if (authorization.res) return authorization.res;
  if (site.starts_at && new Date(site.starts_at).getTime() > Date.now()) {
    return bad("This leaderboard has not started yet. Change the start date before adding scores.", 409);
  }
  if (site.ends_at && new Date(site.ends_at).getTime() <= Date.now()) {
    return bad("This leaderboard has ended. Change the end date or start a new race before adding scores.", 409);
  }

  // getBoardById returns the raw sites row; players live in the players table.
  const rows = await getPlayers(env, site.id, { rankBy: site.rank_by });
  const players = (rows || []).map((p) => ({
    name: p.name,
    wagered: p.wagered,
    prize: p.prize,
    score: p.score,
    hands: p.hands,
    netProfit: p.net_profit,
    winRate: p.win_rate,
    change: p.change,
  }));
  
  // Find or create player
  const searchName = normalizePlayerName(playerName);
  const metric = rankField(site.rank_by);
  let playerIndex = players.findIndex((player) => normalizePlayerName(player.name) === searchName);
  
  if (playerIndex >= 0) {
    // Update existing
    players[playerIndex][metric] = (players[playerIndex][metric] || 0) + amount;
  } else {
    // Create new
    players.push({
      name: playerName,
      wagered: metric === "wagered" ? amount : 0,
      score: metric === "score" ? amount : 0,
      prize: 0,
    });
  }

  const sortedPlayers = sortPlayersForRanking(players, metric);

  // Save against the version we read so a concurrent dashboard or API update is
  // rejected instead of being overwritten by this full-roster mutation.
  const r = await saveSite(env, user, { players: sortedPlayers, siteId: site.id, expectedUpdatedAt: site.updated_at }, site.id, request);
  if (r.error) return bad(r.error, 400);

  await logAudit({
    actorId: user.id,
    action: "quick_add_player",
    entityType: "site",
    entityId: site.id,
    request,
    details: { player: playerName, amount_added: amount },
  });

  return json({ ok: true, players: sortedPlayers });
}
