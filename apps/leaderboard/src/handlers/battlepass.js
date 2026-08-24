// Seasonal Battle Pass & Viewer Progression Handlers.
import { fromJsonb } from "@yourrank/shared/jsonb";
import { requireUser as defaultRequireUser, ok, bad, readJson } from "../auth.js";
import { getByUser as defaultGetByUser, getBoardById as defaultGetBoardById } from "../site.js";
import { requireSiteCapability } from "../site-authorization.js";
import {
  one as defaultOne,
  exec as defaultExec,
  withTransaction as defaultWithTransaction,
} from "@yourrank/shared/db";
import { logAudit as defaultLogAudit } from "@yourrank/shared/audit";
import { requireViewer as defaultRequireViewer } from "./viewer-auth.js";
import { rateLimit as defaultRateLimit } from "@yourrank/shared/ratelimit";

export function generateDefaultTiers() {
  const tiers = [];
  for (let lvl = 1; lvl <= 50; lvl++) {
    const xpRequired = lvl * 100;
    let reward = null;

    if (lvl === 5) reward = { type: "points_and_badge", title: "🥉 Bronze Supporter Badge", points: 250, badge: "bronze" };
    else if (lvl === 10) reward = { type: "points_and_badge", title: "🥈 Silver Racer Badge", points: 500, badge: "silver" };
    else if (lvl === 15) reward = { type: "multiplier", title: "⚡ 1.2x Points Multiplier", points: 750, multiplier: 1.2 };
    else if (lvl === 20) reward = { type: "vip_title", title: "👑 Streamer VIP Title", points: 1000, title_name: "VIP" };
    else if (lvl === 25) reward = { type: "points_and_badge", title: "🥇 Gold Champion Badge", points: 1500, badge: "gold" };
    else if (lvl === 35) reward = { type: "points_and_badge", title: "🔥 Elite Legend Badge", points: 2500, badge: "elite" };
    else if (lvl === 50) reward = { type: "points_and_badge", title: "💎 Diamond Master Title & Border", points: 5000, badge: "diamond" };
    else if (lvl % 2 === 0) reward = { type: "points", title: `+${lvl * 20} Bonus Credits`, points: lvl * 20 };

    tiers.push({
      level: lvl,
      xp_required: xpRequired,
      reward,
    });
  }
  return tiers;
}

/**
 * GET /api/battlepass/season — Get active season and viewer progress
 */
export async function handleGetSeason(request, env, deps = {}) {
  const {
    one = defaultOne,
    requireViewer = defaultRequireViewer,
  } = deps;

  const url = new URL(request.url);
  const siteSlugOrId = url.searchParams.get("site") || url.searchParams.get("siteId");
  const { viewer } = await requireViewer(request, env);
  const viewerId = viewer?.id || null;

  if (!siteSlugOrId) return bad("Site identifier is required.");

  const site = await one("SELECT id, name FROM sites WHERE slug=$1 OR id::text=$1", [siteSlugOrId]);
  if (!site) return bad("Site not found.", 404);

  // Get active season (or auto-create Season 1 if none exists)
  let season = await one(
    "SELECT id, season_number, title, status, tiers_json, starts_at, ends_at FROM seasons WHERE site_id=$1 AND status='active' ORDER BY season_number DESC LIMIT 1",
    [site.id]
  );

  if (!season) {
    const defaultTiers = generateDefaultTiers();
    season = await one(
      `INSERT INTO seasons (site_id, season_number, title, tiers_json)
       VALUES ($1, 1, 'Season 1: Grand Launch', $2)
       RETURNING id, season_number, title, status, tiers_json, starts_at, ends_at`,
      [site.id, defaultTiers]
    );
  }

  const tiers = fromJsonb(season.tiers_json) || [];

  let progress = {
    currentLevel: 1,
    currentXp: 0,
    claimedTiers: [],
    nextLevelXp: 100,
  };

  if (viewerId) {
    const prog = await one(
      "SELECT current_level, current_xp, claimed_tiers FROM viewer_season_progress WHERE season_id=$1 AND viewer_id=$2",
      [season.id, viewerId]
    );

    if (prog) {
      const claimed = fromJsonb(prog.claimed_tiers) || [];
      const nextTier = tiers.find((t) => t.level === (prog.current_level + 1));
      progress = {
        currentLevel: prog.current_level,
        currentXp: prog.current_xp,
        claimedTiers: claimed,
        nextLevelXp: nextTier ? nextTier.xp_required : (prog.current_level * 100),
      };
    }
  }

  return ok({
    season: {
      id: season.id,
      seasonNumber: season.season_number,
      title: season.title,
      startsAt: season.starts_at,
      endsAt: season.ends_at,
      tiers,
    },
    viewerProgress: progress,
  });
}

/**
 * POST /api/battlepass/season — Streamer creates or starts a new season
 */
export async function handleCreateSeason(request, env, deps = {}) {
  const {
    requireUser = defaultRequireUser,
    getByUser = defaultGetByUser,
    getBoardById = defaultGetBoardById,
    one = defaultOne,
    exec = defaultExec,
    logAudit = defaultLogAudit,
  } = deps;

  const { user, res } = await requireUser(request, env);
  if (res) return res;

  const body = await readJson(request);
  const title = String(body?.title || "").trim() || "New Season";

  const url = new URL(request.url);
  const siteId = body?.siteId || url.searchParams.get("siteId");
  const site = siteId ? await getBoardById(env, user.id, siteId) : await getByUser(env, user.id);
  if (!site) return bad("Site not found", 404);
  const authorization = await requireSiteCapability(user, site, "canRoleManageBot");
  if (authorization.res) return authorization.res;

  // Close previous active seasons
  await exec("UPDATE seasons SET status='ended', updated_at=now() WHERE site_id=$1 AND status='active'", [site.id]);

  const latestSeason = await one("SELECT COALESCE(max(season_number), 0) AS max_num FROM seasons WHERE site_id=$1", [site.id]);
  const newSeasonNumber = (latestSeason?.max_num || 0) + 1;

  const tiers = Array.isArray(body?.tiers) && body.tiers.length > 0 ? body.tiers : generateDefaultTiers();

  const newSeason = await one(
    `INSERT INTO seasons (site_id, season_number, title, tiers_json)
     VALUES ($1, $2, $3, $4)
     RETURNING id, season_number, title, status, tiers_json, starts_at`,
    [site.id, newSeasonNumber, title, tiers]
  );

  await logAudit({
    actorId: user.id,
    action: "season_create",
    entityType: "season",
    entityId: newSeason.id,
    request,
    details: { seasonNumber: newSeasonNumber, title },
  });

  return ok({ season: newSeason, message: `🎉 Season ${newSeasonNumber}: ${title} is now active!` });
}

/**
 * POST /api/battlepass/claim — Viewer claims milestone tier reward
 */
export async function handleClaimTierReward(request, env, deps = {}) {
  const {
    one = defaultOne,
    withTransaction = defaultWithTransaction,
    requireViewer = defaultRequireViewer,
    rateLimit = defaultRateLimit,
  } = deps;

  const { viewer, res } = await requireViewer(request, env);
  if (res) return res;

  const body = await readJson(request);
  const seasonId = String(body?.seasonId || "").trim();
  const tierLevel = parseInt(body?.tierLevel, 10);
  const viewerId = viewer.id;

  if (!seasonId || !tierLevel) {
    return bad("seasonId and tierLevel are required.");
  }

  const rl = await rateLimit(env, `battlepass:claim:${viewerId}`, 10, 60);
  if (!rl.ok) return bad("Too many attempts. Please wait a minute.", 429);
  const season = await one("SELECT id, site_id, title, tiers_json FROM seasons WHERE id=$1 AND status='active'", [seasonId]);
  if (!season) return bad("Active season not found.", 404);

  const tiers = fromJsonb(season.tiers_json) || [];
  const tier = tiers.find((t) => t.level === tierLevel);
  if (!tier || !tier.reward) return bad("Milestone reward not found for this tier.", 404);

  const siteViewer = await one("SELECT id, balance FROM site_viewers WHERE site_id=$1 AND viewer_id=$2", [season.site_id, viewerId]);
  if (!siteViewer) return bad("Viewer not found on this site.", 404);

  const prog = await one(
    "SELECT id, current_level, claimed_tiers FROM viewer_season_progress WHERE season_id=$1 AND viewer_id=$2",
    [season.id, viewerId]
  );

  if (!prog || prog.current_level < tierLevel) {
    return bad(`You need to reach Level ${tierLevel} to claim this reward (current Level: ${prog?.current_level || 1}).`, 400);
  }

  const claimed = fromJsonb(prog.claimed_tiers) || [];
  if (claimed.includes(tierLevel)) {
    return bad("You have already claimed this milestone reward!", 400);
  }

  const bonusPoints = tier.reward.points || 0;
  const outcome = await withTransaction(async (tx) => {
    const updatedClaimed = [...claimed, tierLevel];

    const claimedRow = await tx.one(
      `UPDATE viewer_season_progress
          SET claimed_tiers = claimed_tiers || $1::jsonb, updated_at = now()
        WHERE id = $2
          AND NOT (claimed_tiers @> $3::jsonb)
       RETURNING id`,
      [[tierLevel], prog.id, [tierLevel]]
    );
    if (!claimedRow) return { error: "You have already claimed this milestone reward!", status: 400 };

    let balance = siteViewer.balance || 0;
    if (bonusPoints > 0) {
      const updatedViewer = await tx.one(
        "UPDATE site_viewers SET balance = balance + $1, total_earned = total_earned + $1, updated_at = now() WHERE id = $2 RETURNING id, balance",
        [bonusPoints, siteViewer.id]
      );
      balance = updatedViewer.balance;

      await tx.unsafe(
        `INSERT INTO credit_ledger (site_viewer_id, type, amount, description)
         VALUES ($1, 'reward', $2, $3)`,
        [siteViewer.id, bonusPoints, `Battle Pass Level ${tierLevel} Reward: ${tier.reward.title}`]
      );
    }

    return {
      claimedTiers: updatedClaimed,
      newBalance: balance,
    };
  });
  if (outcome.error) return bad(outcome.error, outcome.status);

  return ok({
    tierLevel,
    reward: tier.reward,
    claimedTiers: outcome.claimedTiers,
    newBalance: outcome.newBalance,
    message: `🎉 Reward claimed: ${tier.reward.title}!`,
  });
}

/**
 * POST /api/battlepass/award-xp — Award XP to a viewer and handle automatic level up
 */
export async function handleAwardXp(request, env, deps = {}) {
  const {
    requireUser = defaultRequireUser,
    getByUser = defaultGetByUser,
    getBoardById = defaultGetBoardById,
    one = defaultOne,
    withTransaction = defaultWithTransaction,
  } = deps;

  const { user, res } = await requireUser(request, env);
  if (res) return res;
  const body = await readJson(request);
  const siteId = String(body?.siteId || "").trim();
  const viewerId = String(body?.viewerId || "").trim();
  const xpAmount = Math.max(1, parseInt(body?.xp, 10) || 50);

  if (!siteId || !viewerId) return bad("siteId and viewerId are required.");
  const site = siteId ? await getBoardById(env, user.id, siteId) : await getByUser(env, user.id);
  const authorization = await requireSiteCapability(user, site, "canRoleManageCredits");
  if (authorization.res) return authorization.res;

  const season = await one("SELECT id, tiers_json FROM seasons WHERE site_id=$1 AND status='active' ORDER BY season_number DESC LIMIT 1", [siteId]);
  if (!season) return ok({ message: "No active season for XP." });

  const siteViewer = await one("SELECT id FROM site_viewers WHERE site_id=$1 AND viewer_id=$2", [siteId, viewerId]);
  if (!siteViewer) return bad("Viewer not found on site.", 404);

  const tiers = fromJsonb(season.tiers_json) || [];

  const outcome = await withTransaction(async (tx) => {
    let prog = await tx.one(
      "SELECT id, current_level, current_xp FROM viewer_season_progress WHERE season_id=$1 AND viewer_id=$2 FOR UPDATE",
      [season.id, viewerId]
    );

    if (!prog) {
      prog = await tx.one(
        `INSERT INTO viewer_season_progress (season_id, site_viewer_id, viewer_id, current_level, current_xp)
         VALUES ($1, $2, $3, 1, 0)
         RETURNING id, current_level, current_xp`,
        [season.id, siteViewer.id, viewerId]
      );
    }

    let newXp = (prog.current_xp || 0) + xpAmount;
    let newLevel = prog.current_level || 1;

    // Calculate level ups based on tier thresholds
    for (let l = newLevel + 1; l <= 50; l++) {
      const tier = tiers.find((t) => t.level === l);
      if (tier && newXp >= tier.xp_required) {
        newLevel = l;
      } else {
        break;
      }
    }

    await tx.unsafe(
      "UPDATE viewer_season_progress SET current_level=$1, current_xp=$2, updated_at=now() WHERE id=$3",
      [newLevel, newXp, prog.id]
    );

    return {
      currentLevel: newLevel,
      currentXp: newXp,
      leveledUp: newLevel > prog.current_level,
    };
  });

  return ok({
    xpAdded: xpAmount,
    currentLevel: outcome.currentLevel,
    currentXp: outcome.currentXp,
    leveledUp: outcome.leveledUp,
    message: outcome.leveledUp ? `🎉 LEVEL UP! You reached Level ${outcome.currentLevel}!` : `+${xpAmount} XP added.`,
  });
}
