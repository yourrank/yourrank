// Dashboard API for the Kick credits / shop system.
import { requireUser, bad, ok, json, readJson } from "../auth.js";
import { getByUser, getBoardById, getPublicSite } from "../site.js";
import { query, one, exec, withTransaction } from "@yourrank/shared/db";
import { resolveViewer } from "@yourrank/shared/viewer-session";
import { rateLimit } from "@yourrank/shared/ratelimit";
import { setSiteKickChannel } from "@yourrank/shared/kick-credits";
import { notifyLiveBoard } from "../live-board-config.js";
import {
  getValidKickAccessToken,
  createKickChannelReward,
  fetchKickCurrentChannel,
} from "@yourrank/shared/kick-oauth";
import {
  effectivePlan,
  CREDITS_REWARD_LIMITS,
  CREDITS_SHOP_LIMITS,
  CREDITS_PENDING_REDEMPTIONS_LIMITS,
  CREDITS_REDEMPTIONS_PER_30D_LIMITS,
  CREDITS_VIEWERS_PER_30D_LIMITS,
} from "@yourrank/shared/plans";
import { requireSiteCapability } from "../site-authorization.js";
import { routeContext } from "../middleware/handler.js";

// Injectable seams for tests (see handlers/auth.js defaultDependencies).
const creditsCreateRewardDefaults = {
  requireUser,
  getByUser,
  getBoardById,
  requireSiteCapability,
  rateLimit,
  one,
  exec,
  withTransaction,
  getValidKickAccessToken,
  createKickChannelReward,
  fetchKickCurrentChannel,
};

function getSite(env, user, url) {
  const siteId = url.searchParams.get("siteId");
  return siteId ? getBoardById(env, user.id, siteId) : getByUser(env, user.id);
}

const LEDGER_DIRECTIONS = Object.freeze({
  earn: "credit",
  revoke: "credit",
  spend: "debit",
  redeem: "debit",
  refund: "debit",
});

// A revoked/expired Kick grant used to bubble out of getValidKickAccessToken as
// an unhandled throw and reach the streamer as a bare 500. Answer 409 with a
// machine code instead: the dashboard flips the channel card to "Needs
// attention" and reveals the Reconnect link. Not 403 — fetchDashboardJson
// treats every 403 as an expired session and redirects to login.
const kickReconnectRequired = () => json({
  ok: false,
  error: "Kick connection needs attention. Reconnect Kick to keep rewards working.",
  code: "kick_reconnect_required",
}, 409);

export function ledgerDirection(type) {
  return LEDGER_DIRECTIONS[type] || null;
}

function encodeActivityCursor(createdAt, id) {
  return btoa(JSON.stringify({ createdAt, id }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeActivityCursor(value) {
  if (!value) return null;
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
    const parsed = JSON.parse(atob(padded));
    if (!parsed || typeof parsed.createdAt !== "string" || typeof parsed.id !== "string") return null;
    if (!parsed.createdAt || !parsed.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function getSiteCreditsUsage(siteId) {
  const [rewardMappings, shopItems, pendingRedemptions, redemptions30d, newViewers30d] = await Promise.all([
    one("SELECT count(*)::int AS count FROM credit_reward_mappings WHERE site_id=$1 AND active=true", [siteId]),
    one("SELECT count(*)::int AS count FROM shop_items WHERE site_id=$1 AND active=true", [siteId]),
    one(
      `SELECT count(*)::int AS count FROM redemptions r
         JOIN site_viewers sv ON sv.id = r.site_viewer_id
        WHERE sv.site_id=$1 AND r.status='pending'`,
      [siteId]
    ),
    one(
      `SELECT count(*)::int AS count FROM redemptions r
         JOIN site_viewers sv ON sv.id = r.site_viewer_id
        WHERE sv.site_id=$1 AND r.status='fulfilled' AND r.created_at > now() - interval '30 days'`,
      [siteId]
    ),
    one(
      `SELECT count(*)::int AS count FROM site_viewers
        WHERE site_id=$1 AND created_at > now() - interval '30 days'`,
      [siteId]
    ),
  ]);
  return {
    rewardMappings: rewardMappings?.count || 0,
    shopItems: shopItems?.count || 0,
    pendingRedemptions: pendingRedemptions?.count || 0,
    redemptionsPer30Days: redemptions30d?.count || 0,
    newViewersPer30Days: newViewers30d?.count || 0,
  };
}

export async function handleCreditsStatus(request, env) {
  const { user, res } = await requireUser(request, env);
  if (res) return res;
  const url = new URL(request.url);
  const site = await getSite(env, user, url);
  if (!site) return bad("no site", 404);
  const authorization = await requireSiteCapability(user, site, "canRoleManageCredits");
  if (authorization.res) return authorization.res;
  if (!(await rateLimit(env, `credits:status:${user.id}`, 60, 60)).ok) return bad("Too many requests.", 429);

  const [channel, mappings, items, viewers, redemptions, usage] = await Promise.all([
    one(
      `SELECT s.kick_channel_external_id, s.kick_channel_name, s.kick_channel_linked_at,
              u.kick_token_expires_at
         FROM sites s
         JOIN users u ON u.id = s.user_id
        WHERE s.id=$1`,
      [site.id]
    ),
    query(
      `SELECT id, kick_reward_id, kick_reward_title, kick_reward_cost, credits, active
         FROM credit_reward_mappings
        WHERE site_id=$1 ORDER BY created_at DESC`,
      [site.id]
    ),
    query(
      // Defensive ceiling above the Agency plan's 999 active-item contractual limit.
      `SELECT id, name, description, cost, stock, active
         FROM shop_items
        WHERE site_id=$1 ORDER BY created_at DESC LIMIT 1024`,
      [site.id]
    ),
    query(
      `SELECT sv.id, v.id AS viewer_id, v.kick_user_id, v.kick_username, v.avatar_url,
              v.discord_username, v.discord_user_id, sv.balance, sv.total_earned, sv.total_spent,
              sv.blocked, sv.fraud_score, sv.block_reason, sv.last_earned_at, sv.last_seen_at, sv.created_at
         FROM site_viewers sv
         JOIN viewers v ON v.id = sv.viewer_id
        WHERE sv.site_id=$1
        ORDER BY sv.balance DESC, v.kick_username ASC
        LIMIT 100`,
      [site.id]
    ),
    query(
      `SELECT r.id, r.cost, r.status, r.created_at, r.updated_at,
              v.kick_user_id, v.kick_username,
              v.discord_user_id, v.discord_username, i.name AS item_name
         FROM redemptions r
         JOIN site_viewers sv ON sv.id = r.site_viewer_id
         JOIN viewers v ON v.id = sv.viewer_id
         JOIN shop_items i ON i.id = r.shop_item_id
        WHERE sv.site_id=$1
        ORDER BY r.created_at DESC
        LIMIT 100`,
      [site.id]
    ),
    getSiteCreditsUsage(site.id),
  ]);

  const plan = effectivePlan(user);

  return ok({
    enabled: Boolean(site.credits_enabled),
    channel: {
      externalId: channel?.kick_channel_external_id || null,
      name: channel?.kick_channel_name || null,
      linkedAt: channel?.kick_channel_linked_at || null,
      tokenExpiresAt: channel?.kick_token_expires_at || null,
    },
    mappings: mappings || [],
    shopItems: items || [],
    viewers: viewers || [],
    redemptions: redemptions || [],
    usage: usage || {},
    viewerAuth: {
      kick: site.viewer_kick_auth_enabled,
      discord: site.viewer_discord_auth_enabled,
      public: site.viewer_public_redeem_enabled,
    },
    limits: {
      rewardMappings: CREDITS_REWARD_LIMITS[plan],
      shopItems: CREDITS_SHOP_LIMITS[plan],
      pendingRedemptions: CREDITS_PENDING_REDEMPTIONS_LIMITS[plan],
      redemptionsPer30Days: CREDITS_REDEMPTIONS_PER_30D_LIMITS[plan],
      newViewersPer30Days: CREDITS_VIEWERS_PER_30D_LIMITS[plan],
    },
  });
}

export async function handleCreditsConnect(request, env) {
  const { user, res } = await requireUser(request, env);
  if (res) return res;
  const url = new URL(request.url);
  const site = await getSite(env, user, url);
  if (!site) return bad("no site", 404);
  const authorization = await requireSiteCapability(user, site, "canRoleManageCredits");
  if (authorization.res) return authorization.res;
  if (!(await rateLimit(env, `credits:connect:${user.id}`, 10, 60)).ok) return bad("Too many requests.", 429);

  const body = await readJson(request);
  const externalId = String(body?.externalId || "").trim();
  const name = String(body?.name || "").trim();
  if (!externalId) return bad("Kick channel ID is required");

  await setSiteKickChannel(site.id, externalId, name);
  void notifyLiveBoard(env, site.id);
  const row = await one(
    `SELECT kick_channel_linked_at FROM sites WHERE id = $1`,
    [site.id]
  );
  return ok({ channel: { externalId, name, linkedAt: row?.kick_channel_linked_at || null } });
}

export async function handleCreditsSaveReward(request, env) {
  const { user, res } = await requireUser(request, env);
  if (res) return res;
  const url = new URL(request.url);
  const site = await getSite(env, user, url);
  if (!site) return bad("no site", 404);
  const authorization = await requireSiteCapability(user, site, "canRoleManageCredits");
  if (authorization.res) return authorization.res;
  if (!(await rateLimit(env, `credits:reward:${user.id}`, 20, 60)).ok) return bad("Too many requests.", 429);

  const body = await readJson(request);
  const id = body?.id ? String(body.id).trim() : null;
  const kickRewardId = String(body?.kickRewardId || "").trim();
  const kickRewardTitle = String(body?.kickRewardTitle || "").trim();
  const kickRewardCost = Number(body?.kickRewardCost || 0);
  const credits = Number(body?.credits || 0);

  if (!kickRewardId || !kickRewardTitle) return bad("Reward ID and title are required");
  if (!Number.isFinite(kickRewardCost) || kickRewardCost < 0) return bad("Reward cost must be a non-negative number");
  if (!Number.isFinite(credits) || credits <= 0) return bad("Credits must be a positive number");

  const plan = effectivePlan(user);
  const limit = CREDITS_REWARD_LIMITS[plan];

  const txResult = await withTransaction(async (tx) => {
    await tx.unsafe("SELECT id FROM sites WHERE id=$1 FOR UPDATE", [site.id]);

    const countRow = await tx.one(
      `SELECT count(*)::int AS count FROM credit_reward_mappings
        WHERE site_id=$1 AND active=true ${id ? "AND id != $2" : ""}`,
      id ? [site.id, id] : [site.id]
    );
    if ((countRow?.count || 0) >= limit) {
      return { error: `Reward mapping limit reached for the ${plan} plan. Upgrade to add more.`, status: 403 };
    }

    const existing = id
      ? await tx.one("SELECT id FROM credit_reward_mappings WHERE id=$1 AND site_id=$2", [id, site.id])
      : await tx.one(
          `SELECT id FROM credit_reward_mappings
            WHERE site_id=$1 AND kick_reward_id=$2
            LIMIT 1`,
          [site.id, kickRewardId]
        );

    if (existing) {
      await tx.unsafe(
        `UPDATE credit_reward_mappings
            SET kick_reward_id=$1, kick_reward_title=$2, kick_reward_cost=$3, credits=$4, active=true, updated_at=now()
          WHERE id=$5`,
        [kickRewardId, kickRewardTitle, kickRewardCost, credits, existing.id]
      );
      return { id: existing.id };
    }

    const rows = await tx.unsafe(
      `INSERT INTO credit_reward_mappings (site_id, kick_reward_id, kick_reward_title, kick_reward_cost, credits)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [site.id, kickRewardId, kickRewardTitle, kickRewardCost, credits]
    );
    return { id: rows[0].id };
  });

  if (txResult.error) return bad(txResult.error, txResult.status);
  return ok({ id: txResult.id });
}

export async function handleCreditsCreateReward(request, env, deps = creditsCreateRewardDefaults) {
  const { user, res } = await deps.requireUser(request, env);
  if (res) return res;
  const url = new URL(request.url);
  const siteIdForLookup = url.searchParams.get("siteId");
  const site = siteIdForLookup ? await deps.getBoardById(env, user.id, siteIdForLookup) : await deps.getByUser(env, user.id);
  if (!site) return bad("no site", 404);
  const authorization = await deps.requireSiteCapability(user, site, "canRoleManageCredits");
  if (authorization.res) return authorization.res;
  if (!(await deps.rateLimit(env, `credits:reward-create:${user.id}`, 5, 60)).ok) return bad("Too many requests.", 429);

  const body = await readJson(request);
  const title = String(body?.title || "").trim();
  const cost = Number(body?.cost || 0);
  const credits = Number(body?.credits || 0);
  const description = String(body?.description || "").trim();
  const backgroundColor = String(body?.backgroundColor || "#00e701").trim();

  if (!title) return bad("Reward title is required");
  if (!Number.isFinite(cost) || cost < 1) return bad("Reward cost must be a positive number");
  if (!Number.isFinite(credits) || credits <= 0) return bad("Credits must be a positive number");

  // Enforce plan limit before calling Kick (re-checked under a lock below).
  const plan = effectivePlan(user);
  const limit = CREDITS_REWARD_LIMITS[plan];
  const preCount = await deps.one(
    "SELECT count(*)::int AS count FROM credit_reward_mappings WHERE site_id=$1 AND active=true",
    [site.id]
  );
  if ((preCount?.count || 0) >= limit) {
    return bad(`Reward mapping limit reached for the ${plan} plan. Upgrade to add more.`, 403);
  }

  // Load and refresh the streamer's Kick tokens.
  const tokenRow = await deps.one(
    `SELECT kick_access_token_enc, kick_refresh_token_enc, kick_token_expires_at
       FROM users WHERE id=$1`,
    [user.id]
  );
  if (!tokenRow?.kick_access_token_enc) {
    return bad("Connect your Kick account first in the channel section", 403);
  }

  let tokenSet;
  try {
    tokenSet = await deps.getValidKickAccessToken(
      env,
      tokenRow.kick_access_token_enc,
      tokenRow.kick_refresh_token_enc || null,
      tokenRow.kick_token_expires_at
    );
  } catch (err) {
    // Refresh token revoked/expired (Kick's invalid_grant) or missing.
    console.warn("[credits] Kick token refresh failed:", err?.message || err);
    return kickReconnectRequired();
  }

  let reward;
  try {
    reward = await deps.createKickChannelReward(tokenSet.accessToken, {
      title,
      cost,
      description: description || undefined,
      background_color: backgroundColor,
      is_enabled: true,
    });
  } catch (err) {
    // A 401 here means the access token was revoked despite a fresh-looking
    // expiry; anything else is a Kick-API problem the streamer cannot fix.
    if (/\b401\b|invalid_grant|unauthorized/i.test(String(err?.message || err))) {
      return kickReconnectRequired();
    }
    console.warn("[credits] Kick reward creation failed:", err?.message || err);
    return bad("Kick did not accept the reward. Try again in a moment.", 502);
  }

  // The reward was created on the streamer's Kick channel. Capture that channel
  // so webhook redemptions can find this site even if the manual connect form was skipped.
  const kickChannel = await deps.fetchKickCurrentChannel(tokenSet.accessToken);
  if (!kickChannel) {
    return bad("Could not determine your Kick channel from the OAuth token", 500);
  }
  const kickChannelId = String(kickChannel.broadcaster_user_id || "");
  const kickChannelName = String(kickChannel.slug || "");
  if (!kickChannelId) {
    return bad("Kick channel ID missing from current channel response", 500);
  }

  // Persist refreshed tokens if they changed.
  await deps.exec(
    `UPDATE users
        SET kick_access_token_enc = $1,
            kick_refresh_token_enc = $2,
            kick_token_expires_at = $3,
            updated_at = now()
      WHERE id = $4`,
    [tokenSet.accessEnc, tokenSet.refreshEnc, tokenSet.expiresAt, user.id]
  );

  // Atomic insert under a site lock so two concurrent auto-creates cannot overrun the plan limit.
  const txResult = await deps.withTransaction(async (tx) => {
    await tx.unsafe("SELECT id FROM sites WHERE id=$1 FOR UPDATE", [site.id]);

    await tx.unsafe(
      `UPDATE sites
          SET kick_channel_external_id = $1,
              kick_channel_name = $2,
              updated_at = now()
        WHERE id = $3`,
      [kickChannelId, kickChannelName, site.id]
    );

    const countRow = await tx.one(
      "SELECT count(*)::int AS count FROM credit_reward_mappings WHERE site_id=$1 AND active=true",
      [site.id]
    );
    if ((countRow?.count || 0) >= limit) {
      return { error: `Reward mapping limit reached for the ${plan} plan. Upgrade to add more.`, status: 403 };
    }

    const existing = await tx.one(
      `SELECT id FROM credit_reward_mappings
        WHERE site_id=$1 AND kick_reward_id=$2
        LIMIT 1`,
      [site.id, String(reward.id)]
    );

    if (existing) {
      await tx.unsafe(
        `UPDATE credit_reward_mappings
            SET kick_reward_id=$1, kick_reward_title=$2, kick_reward_cost=$3, credits=$4, active=true, updated_at=now()
          WHERE id=$5`,
        [String(reward.id), reward.title, reward.cost, credits, existing.id]
      );
      return { id: existing.id };
    }

    const rows = await tx.unsafe(
      `INSERT INTO credit_reward_mappings (site_id, kick_reward_id, kick_reward_title, kick_reward_cost, credits)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [site.id, String(reward.id), reward.title, reward.cost, credits]
    );
    return { id: rows[0].id };
  });
  if (txResult.error) return bad(txResult.error, txResult.status);
  void notifyLiveBoard(env, site.id);

  return ok({
    id: txResult.id,
    reward: {
      id: reward.id,
      title: reward.title,
      cost: reward.cost,
      description: reward.description,
      backgroundColor: reward.background_color,
    },
  });
}

export async function handleCreditsDeleteReward(request, env) {
  const { user, res } = await requireUser(request, env);
  if (res) return res;
  const url = new URL(request.url);
  const site = await getSite(env, user, url);
  if (!site) return bad("no site", 404);
  const authorization = await requireSiteCapability(user, site, "canRoleManageCredits");
  if (authorization.res) return authorization.res;

  if (!(await rateLimit(env, `credits:reward-del:${user.id}`, 20, 60)).ok) return bad("Too many requests.", 429);

  const id = routeContext(request).slug || url.pathname.split("/").pop();
  if (!id) return bad("missing reward id");

  const rows = await exec(
    "UPDATE credit_reward_mappings SET active=false, updated_at=now() WHERE id=$1 AND site_id=$2 RETURNING id",
    [id, site.id]
  );
  if (!rows || rows.length === 0) return bad("reward not found", 404);
  return ok({ id: rows[0].id });
}

export async function handleCreditsSaveShopItem(request, env) {
  const { user, res } = await requireUser(request, env);
  if (res) return res;
  const url = new URL(request.url);
  const site = await getSite(env, user, url);
  if (!site) return bad("no site", 404);
  const authorization = await requireSiteCapability(user, site, "canRoleManageCredits");
  if (authorization.res) return authorization.res;
  if (!(await rateLimit(env, `credits:shop:${user.id}`, 20, 60)).ok) return bad("Too many requests.", 429);

  const body = await readJson(request);
  const id = body?.id ? String(body.id).trim() : null;
  const name = String(body?.name || "").trim();
  const description = String(body?.description || "").trim();
  const cost = Number(body?.cost || 0);
  const stock = body?.stock === null || body?.stock === undefined ? null : Number(body.stock);
  const active = body?.active !== false;

  if (!name) return bad("Item name is required");
  if (!Number.isFinite(cost) || cost <= 0) return bad("Cost must be a positive number");
  if (stock !== null && (!Number.isFinite(stock) || stock < 0)) return bad("Stock must be a non-negative number or null");

  const plan = effectivePlan(user);
  const limit = CREDITS_SHOP_LIMITS[plan];

  const txResult = await withTransaction(async (tx) => {
    await tx.unsafe("SELECT id FROM sites WHERE id=$1 FOR UPDATE", [site.id]);

    const countRow = await tx.one(
      `SELECT count(*)::int AS count FROM shop_items
        WHERE site_id=$1 AND active=true ${id ? "AND id != $2" : ""}`,
      id ? [site.id, id] : [site.id]
    );
    if (active && (countRow?.count || 0) >= limit) {
      return { error: `Shop item limit reached for the ${plan} plan. Upgrade to add more.`, status: 403 };
    }

    if (id) {
      const rows = await tx.unsafe(
        `UPDATE shop_items
            SET name=$1, description=$2, cost=$3, stock=$4, active=$5, updated_at=now()
          WHERE id=$6 AND site_id=$7
          RETURNING id`,
        [name, description, cost, stock, active, id, site.id]
      );
      if (!rows || rows.length === 0) return { error: "shop item not found", status: 404 };
      return { id: rows[0].id };
    }

    const rows = await tx.unsafe(
      `INSERT INTO shop_items (site_id, name, description, cost, stock, active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [site.id, name, description, cost, stock, active]
    );
    return { id: rows[0].id };
  });

  if (txResult.error) return bad(txResult.error, txResult.status);
  return ok({ id: txResult.id });
}

export async function handleCreditsDeleteShopItem(request, env) {
  const { user, res } = await requireUser(request, env);
  if (res) return res;
  const url = new URL(request.url);
  const site = await getSite(env, user, url);
  if (!site) return bad("no site", 404);
  const authorization = await requireSiteCapability(user, site, "canRoleManageCredits");
  if (authorization.res) return authorization.res;
  if (!(await rateLimit(env, `credits:shop-del:${user.id}`, 20, 60)).ok) return bad("Too many requests.", 429);

  const id = routeContext(request).slug || url.pathname.split("/").pop();
  if (!id) return bad("missing item id");

  const rows = await exec(
    `UPDATE shop_items
        SET active=false, updated_at=now()
      WHERE id=$1 AND site_id=$2
      RETURNING id`,
    [id, site.id]
  );
  if (!rows || rows.length === 0) return bad("shop item not found", 404);
  return ok({ id: rows[0].id });
}

export async function handleCreditsUpdateRedemption(request, env) {
  const { user, res } = await requireUser(request, env);
  if (res) return res;
  const url = new URL(request.url);
  const site = await getSite(env, user, url);
  if (!site) return bad("no site", 404);
  const authorization = await requireSiteCapability(user, site, "canRoleManageCredits");
  if (authorization.res) return authorization.res;
  if (!(await rateLimit(env, `credits:redeem-update:${user.id}`, 30, 60)).ok) return bad("Too many requests.", 429);

  const id = routeContext(request).slug || url.pathname.split("/").pop();
  const body = await readJson(request);
  const status = String(body?.status || "").trim();
  if (!["fulfilled", "cancelled"].includes(status)) return bad("status must be fulfilled or cancelled");

  const result = await withTransaction(async (tx) => {
    // Only allow transitions from pending; this makes the refund idempotent
    // and prevents a redemption being cancelled twice.
    const redemption = await tx.one(
      `UPDATE redemptions r
          SET status=$1, updated_at=now()
        FROM site_viewers sv
        WHERE r.id=$2 AND r.site_viewer_id = sv.id AND sv.site_id=$3 AND r.status = 'pending'
        RETURNING r.id, r.site_viewer_id, r.shop_item_id, r.cost`,
      [status, id, site.id]
    );
    if (!redemption) return null;

    if (status === "cancelled") {
      await tx.unsafe(
        `UPDATE site_viewers
            SET balance = balance + $1,
                total_spent = GREATEST(total_spent - $1, 0),
                updated_at = now()
          WHERE id=$2`,
        [redemption.cost, redemption.site_viewer_id]
      );
      await tx.unsafe(
        `UPDATE shop_items
            SET stock = stock + 1, updated_at = now()
          WHERE id=$1 AND stock IS NOT NULL`,
        [redemption.shop_item_id]
      );
      await tx.unsafe(
        `INSERT INTO credit_ledger (site_viewer_id, type, amount, description, metadata)
         VALUES ($1, 'revoke', $2, 'Cancelled redemption refund', $3)`,
        [redemption.site_viewer_id, redemption.cost, { redemption_id: redemption.id }]
      );
    }

    return { id: redemption.id, status };
  });

  if (!result) return bad("redemption not found", 404);
  return ok(result);
}

// Cross-board viewer history for a streamer: all of their sites where a given
// Kick viewer has a site_viewer record, with balances and redemption counts.
export async function handleCreditsViewerHistory(request, env) {
  const { user, res } = await requireUser(request, env);
  if (res) return res;

  const url = new URL(request.url);
  if (!(await rateLimit(env, `credits:viewer-history:${user.id}`, 20, 60)).ok) return bad("Too many requests.", 429);

  const kickUsername = String(url.searchParams.get("kickUsername") || "").trim();
  const kickUserId = String(url.searchParams.get("kickUserId") || "").trim();
  if (!kickUsername && !kickUserId) return bad("kickUsername or kickUserId is required");

  const rows = await query(
    `SELECT
       s.id AS site_id,
       s.slug,
       s.name,
       sv.id AS site_viewer_id,
       sv.balance,
       sv.total_earned,
       sv.total_spent,
       sv.blocked,
       sv.fraud_score,
       sv.created_at,
       v.kick_user_id,
       v.kick_username,
       v.discord_user_id,
       v.discord_username,
       COUNT(r.id) FILTER (WHERE r.status != 'cancelled')::int AS redemptions_total,
       COUNT(r.id) FILTER (WHERE r.status = 'pending')::int AS redemptions_pending
     FROM sites s
     JOIN site_viewers sv ON sv.site_id = s.id
     JOIN viewers v ON v.id = sv.viewer_id
     LEFT JOIN redemptions r ON r.site_viewer_id = sv.id
     WHERE s.user_id = $1
       AND ($2 = '' OR lower(v.kick_username) = lower($2) OR lower(v.discord_username) = lower($2))
       AND ($3 = '' OR v.kick_user_id = $3 OR v.discord_user_id = $3)
     GROUP BY s.id, s.slug, s.name, sv.id, v.kick_user_id, v.kick_username, v.discord_user_id, v.discord_username
     ORDER BY sv.total_earned DESC, s.name ASC
     LIMIT 50`,
    [user.id, kickUsername, kickUserId]
  );

  const boards = (rows || []).map((r) => ({
    siteId: r.site_id,
    slug: r.slug,
    name: r.name,
    siteViewerId: r.site_viewer_id,
    balance: r.balance,
    totalEarned: r.total_earned,
    totalSpent: r.total_spent,
    blocked: r.blocked,
    fraudScore: r.fraud_score,
    createdAt: r.created_at,
    kickUserId: r.kick_user_id,
    kickUsername: r.kick_username,
    discordUserId: r.discord_user_id,
    discordUsername: r.discord_username,
    redemptionsTotal: r.redemptions_total,
    redemptionsPending: r.redemptions_pending,
  }));

  return ok({ kickUsername: kickUsername || null, kickUserId: kickUserId || null, boards });
}

export async function handleCreditsActivity(request, env) {
  const { user, res } = await requireUser(request, env);
  if (res) return res;

  const url = new URL(request.url);
  if (!(await rateLimit(env, `credits:activity:${user.id}`, 60, 60)).ok) return bad("Too many requests.", 429);

  const siteId = String(url.searchParams.get("siteId") || "").trim();
  if (!siteId) return bad("siteId is required");

  const site = await getBoardById(env, user.id, siteId);
  if (!site) return bad("no site", 404);
  const authorization = await requireSiteCapability(user, site, "canRoleManageCredits");
  if (authorization.res) return authorization.res;

  const rawLimit = url.searchParams.get("limit");
  const parsedLimit = rawLimit === null || rawLimit === "" ? 25 : Number(rawLimit);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1) return bad("limit must be a positive integer");
  const limit = Math.min(parsedLimit, 100);

  const cursorValue = url.searchParams.get("cursor");
  const cursor = decodeActivityCursor(cursorValue);
  if (cursorValue && !cursor) return bad("invalid cursor");

  const kickUsername = String(url.searchParams.get("kickUsername") || "").trim();
  const type = String(url.searchParams.get("type") || "").trim().toLowerCase();
  if (type && !ledgerDirection(type)) return bad("invalid type");

  const params = [siteId, kickUsername, type, user.id];
  const conditions = [
    "sv.site_id = $1",
    "($2 = '' OR lower(v.kick_username) = lower($2) OR lower(v.discord_username) = lower($2))",
    "($3 = '' OR cl.type = $3)",
    "s.user_id = $4",
  ];
  if (cursor) {
    params.push(cursor.createdAt, cursor.id);
    conditions.push("(cl.created_at, cl.id) < ($5::timestamptz, $6::uuid)");
  }
  params.push(limit + 1);

  const rows = await query(
    `SELECT cl.id, cl.created_at, cl.type, cl.amount, cl.description,
            v.kick_username, v.kick_user_id,
            v.discord_username, v.discord_user_id,
            s.id AS site_id, s.name AS site_name
       FROM credit_ledger cl
       JOIN site_viewers sv ON sv.id = cl.site_viewer_id
       JOIN sites s ON s.id = sv.site_id
       JOIN viewers v ON v.id = sv.viewer_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY cl.created_at DESC, cl.id DESC
      LIMIT $${params.length}`,
    params
  );

  const page = rows || [];
  const hasNext = page.length > limit;
  const events = page.slice(0, limit).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    type: row.type,
    amount: row.amount,
    direction: ledgerDirection(row.type),
    description: row.description,
    kickUsername: row.kick_username,
    kickUserId: row.kick_user_id,
    discordUsername: row.discord_username,
    discordUserId: row.discord_user_id,
    siteId: row.site_id,
    siteName: row.site_name,
  }));
  const last = events[events.length - 1];

  return ok({
    events,
    nextCursor: hasNext && last ? encodeActivityCursor(last.createdAt, last.id) : null,
  });
}

// Public viewer endpoints: shop is public, viewer data is session-only.
export async function handlePublicCredits(request, env) {
  const url = new URL(request.url);
  const slug = String(url.searchParams.get("slug") || "").trim().toLowerCase();
  if (!slug) return bad("slug required");

  const r = await getPublicSite(env, slug, request);
  if (r && r.requiresPassword) return bad("Password required.", 401);
  if (!r || r.suspended) return bad("site not found", 404);

  const { viewer } = await resolveViewer(request, env);

  const rl = await rateLimit(env, `public-credits:${r.id}:${viewer?.id || "anon"}`, 30, 60);
  if (!rl.ok) return bad("rate limited", 429);

  let viewerData = null;
  if (viewer) {
    viewerData = await one(
      `SELECT sv.id, sv.balance, sv.total_earned, sv.total_spent, sv.blocked, sv.block_reason, v.kick_username
         FROM site_viewers sv
         JOIN viewers v ON v.id = sv.viewer_id
        WHERE sv.site_id=$1 AND sv.viewer_id=$2`,
      [r.id, viewer.id]
    );
    if (viewerData?.blocked) {
      return bad("viewer blocked");
    }
  }

  const shopItems = await query(
    // Defensive ceiling above the Agency plan's 999 active-item contractual limit.
    `SELECT id, name, description, cost, stock, active
       FROM shop_items
      WHERE site_id=$1 AND active=true
      ORDER BY cost ASC
      LIMIT 1024`,
    [r.id]
  );

  return ok({
    viewer: viewerData
      ? {
          id: viewerData.id,
          balance: viewerData.balance,
          total_earned: viewerData.total_earned,
          total_spent: viewerData.total_spent,
          blocked: viewerData.blocked,
          block_reason: viewerData.block_reason,
          kick_username: viewerData.kick_username,
        }
      : null,
    shopItems: shopItems || [],
    auth: {
      kickEnabled: r.viewerKickAuthEnabled,
      discordEnabled: r.viewerDiscordAuthEnabled,
      publicRedeemEnabled: r.viewerPublicRedeemEnabled,
    },
  });
}

export async function handleCreditsViewerAuth(request, env) {
  const { user, res } = await requireUser(request, env);
  if (res) return res;
  const url = new URL(request.url);
  const site = await getSite(env, user, url);
  if (!site) return bad("no site", 404);
  const authorization = await requireSiteCapability(user, site, "canRoleManageCredits");
  if (authorization.res) return authorization.res;
  if (!(await rateLimit(env, `credits:auth-toggle:${user.id}`, 10, 60)).ok) return bad("Too many requests.", 429);

  const body = await readJson(request);
  const kick = body?.kick === true || body?.kick === "true";
  const discord = body?.discord === true || body?.discord === "true";
  // The public-redeem flow is not built yet, so preserve the existing flag
  // when the dashboard no longer sends the hidden checkbox.
  const publicRedeem = body && ("public" in body)
    ? body.public === true || body.public === "true"
    : !!site.viewer_public_redeem_enabled;

  await exec(
    `UPDATE sites
        SET viewer_kick_auth_enabled = $1,
            viewer_discord_auth_enabled = $2,
            viewer_public_redeem_enabled = $3,
            updated_at = now()
      WHERE id = $4 AND user_id = $5`,
    [kick, discord, publicRedeem, site.id, user.id]
  );
  void notifyLiveBoard(env, site.id);

  return ok({ kick, discord, public: publicRedeem });
}

export async function handleCreditsAnalytics(request, env) {
  const { user, res } = await requireUser(request, env);
  if (res) return res;
  const url = new URL(request.url);
  const site = await getSite(env, user, url);
  if (!site) return bad("no site", 404);
  const authorization = await requireSiteCapability(user, site, "canRoleManageCredits");
  if (authorization.res) return authorization.res;
  if (!(await rateLimit(env, `credits:analytics:${user.id}`, 30, 60)).ok) return bad("Too many requests.", 429);

  const rawDays = Number(url.searchParams.get("days") || 30);
  const days = Math.min(Math.max(Number.isFinite(rawDays) ? rawDays : 30, 1), 90);
  const startDate = new Date(Date.now() - days * 86400000).toISOString();

  const [
    allTimeEarned,
    periodEarned,
    allTimeSpent,
    periodSpent,
    redemptionSummary,
    viewerBalance,
    topEarners,
    topItems,
    redemptionsByStatus,
    creditsByDay,
  ] = await Promise.all([
    one(
      `SELECT total_earned::int AS total
         FROM site_credit_aggregates
        WHERE site_id = $1`,
      [site.id]
    ),
    one(
      `SELECT COALESCE(SUM(CASE WHEN cl.type = 'earn' THEN cl.amount
                                WHEN cl.type = 'refund' THEN -cl.amount
                                ELSE 0 END), 0)::int AS total
         FROM credit_ledger cl
         JOIN site_viewers sv ON sv.id = cl.site_viewer_id
        WHERE sv.site_id = $1 AND cl.type IN ('earn', 'refund') AND cl.created_at > $2::timestamptz`,
      [site.id, startDate]
    ),
    one(
      `SELECT total_spent::int AS total
         FROM site_credit_aggregates
        WHERE site_id = $1`,
      [site.id]
    ),
    one(
      `SELECT COALESCE(SUM(CASE WHEN cl.type = 'spend' THEN cl.amount
                                WHEN cl.type = 'revoke' THEN -cl.amount
                                ELSE 0 END), 0)::int AS total
         FROM credit_ledger cl
         JOIN site_viewers sv ON sv.id = cl.site_viewer_id
        WHERE sv.site_id = $1 AND cl.type IN ('spend', 'revoke') AND cl.created_at > $2::timestamptz`,
      [site.id, startDate]
    ),
    one(
      `SELECT
         COUNT(*) FILTER (WHERE r.status != 'cancelled')::int AS total,
         COUNT(*) FILTER (WHERE r.status = 'fulfilled')::int AS fulfilled,
         COUNT(*) FILTER (WHERE r.status = 'pending')::int AS pending,
         COUNT(*) FILTER (WHERE r.status = 'cancelled')::int AS cancelled,
         COALESCE(SUM(r.cost) FILTER (WHERE r.status != 'cancelled'), 0)::int AS credits_spent
         FROM redemptions r
         JOIN site_viewers sv ON sv.id = r.site_viewer_id
        WHERE sv.site_id = $1 AND r.created_at > $2::timestamptz`,
      [site.id, startDate]
    ),
    one(
      "SELECT total_balance::int AS total FROM site_credit_aggregates WHERE site_id = $1",
      [site.id]
    ),
    query(
      `SELECT v.kick_username, sv.balance, sv.total_earned, sv.total_spent
         FROM site_viewers sv
         JOIN viewers v ON v.id = sv.viewer_id
        WHERE sv.site_id = $1
        ORDER BY sv.total_earned DESC, v.kick_username ASC
        LIMIT 10`,
      [site.id]
    ),
    query(
      `SELECT i.id, i.name, COUNT(r.id) FILTER (WHERE r.status != 'cancelled')::int AS redemptions,
              COALESCE(SUM(r.cost) FILTER (WHERE r.status != 'cancelled'), 0)::int AS credits_spent
         FROM shop_items i
         LEFT JOIN redemptions r ON r.shop_item_id = i.id AND r.created_at > $2::timestamptz
        WHERE i.site_id = $1
        GROUP BY i.id, i.name
        ORDER BY redemptions DESC, i.name ASC
        LIMIT 10`,
      [site.id, startDate]
    ),
    query(
      `SELECT totals.status, totals.count::int
         FROM site_credit_aggregates a
         CROSS JOIN LATERAL (
           VALUES
             ('pending', a.redemptions_pending),
             ('fulfilled', a.redemptions_fulfilled),
             ('cancelled', a.redemptions_cancelled)
         ) AS totals(status, count)
        WHERE a.site_id = $1 AND totals.count > 0`,
      [site.id]
    ),
    query(
      `SELECT DATE(cl.created_at) AS day, cl.type, COALESCE(SUM(cl.amount), 0)::int AS total
         FROM credit_ledger cl
         JOIN site_viewers sv ON sv.id = cl.site_viewer_id
        WHERE sv.site_id = $1 AND cl.created_at > $2::timestamptz AND cl.type IN ('earn', 'spend', 'refund', 'revoke')
        GROUP BY DATE(cl.created_at), cl.type
        ORDER BY day ASC`,
      [site.id, startDate]
    ),
  ]);

  return ok({
    days,
    summary: {
      allTimeEarned: allTimeEarned?.total || 0,
      periodEarned: periodEarned?.total || 0,
      allTimeSpent: allTimeSpent?.total || 0,
      periodSpent: periodSpent?.total || 0,
      redemptionsTotal: redemptionSummary?.total || 0,
      redemptionsFulfilled: redemptionSummary?.fulfilled || 0,
      redemptionsPending: redemptionSummary?.pending || 0,
      redemptionsCancelled: redemptionSummary?.cancelled || 0,
      redemptionCreditsSpent: redemptionSummary?.credits_spent || 0,
      viewerBalance: viewerBalance?.total || 0,
    },
    topEarners: topEarners || [],
    topItems: topItems || [],
    redemptionsByStatus: redemptionsByStatus || [],
    creditsByDay: creditsByDay || [],
  });
}

// Streamer-only: add or remove credits from a site viewer with a ledger row.
export async function handleCreditsAdjustBalance(request, env) {
  const { user, res } = await requireUser(request, env);
  if (res) return res;
  const url = new URL(request.url);
  const site = await getSite(env, user, url);
  if (!site) return bad("no site", 404);
  const authorization = await requireSiteCapability(user, site, "canRoleManageCredits");
  if (authorization.res) return authorization.res;
  if (!(await rateLimit(env, `credits:adjust:${user.id}`, 30, 60)).ok) return bad("Too many requests.", 429);

  const urlParts = url.pathname.split("/").filter(Boolean);
  let siteViewerId = routeContext(request).slug;
  if (!siteViewerId) {
    const vIdx = urlParts.indexOf("viewers");
    if (vIdx !== -1 && urlParts[vIdx + 1] && urlParts[vIdx + 1] !== "balance") {
      siteViewerId = urlParts[vIdx + 1];
    } else {
      const last = urlParts[urlParts.length - 1];
      if (last !== "balance" && last !== "tip") siteViewerId = last;
    }
  }

  const body = await readJson(request);
  const delta = Number(body?.delta);
  const reason = String(body?.reason || "").trim();

  if (!Number.isFinite(delta) || delta === 0) return bad("delta must be a non-zero integer");
  if (!reason) return bad("reason is required");

  const result = await withTransaction(async (tx) => {
    let siteViewer = null;
    if (siteViewerId && siteViewerId !== "tip" && siteViewerId !== "by-username") {
      siteViewer = await tx.one(
        `SELECT sv.id, sv.balance, sv.total_earned
           FROM site_viewers sv
          WHERE sv.id = $1 AND sv.site_id = $2
          FOR UPDATE`,
        [siteViewerId, site.id]
      );
    }

    if (!siteViewer) return { error: "viewer not found", status: 404 };

    if (delta > 0) {
      const updated = await tx.one(
        `UPDATE site_viewers
            SET balance = balance + $1,
                total_earned = total_earned + $1,
                updated_at = now()
          WHERE id = $2
          RETURNING id, balance`,
        [delta, siteViewer.id]
      );
      await tx.unsafe(
        `INSERT INTO credit_ledger (site_viewer_id, type, amount, description, metadata)
         VALUES ($1, 'earn', $2, $3, $4)`,
        [siteViewer.id, delta, `Manual credit: ${reason}`, { reason, adjusted_by: user.id, manual: true }]
      );
      return { siteViewerId: siteViewer.id, balance: updated.balance, delta };
    }

    // delta < 0: debit/refund credits.
    const debitAmount = -delta;
    const updated = await tx.one(
      `UPDATE site_viewers
          SET balance = balance - $1,
              total_earned = GREATEST(total_earned - $1, 0),
              updated_at = now()
        WHERE id = $2 AND balance >= $1
        RETURNING id, balance`,
      [debitAmount, siteViewer.id]
    );
    if (!updated) return { error: "insufficient balance to debit", status: 400 };
    await tx.unsafe(
      `INSERT INTO credit_ledger (site_viewer_id, type, amount, description, metadata)
       VALUES ($1, 'refund', $2, $3, $4)`,
      [siteViewer.id, debitAmount, `Manual debit: ${reason}`, { reason, adjusted_by: user.id, manual: true }]
    );
    return { siteViewerId: siteViewer.id, balance: updated.balance, delta };
  });

  if (result.error) return bad(result.error, result.status);
  return ok(result);
}

// Reconcile ledger-derived balance against stored site_viewers.balance.
export async function handleCreditsReconcile(request, env) {
  const { user, res } = await requireUser(request, env);
  if (res) return res;
  const url = new URL(request.url);
  const site = await getSite(env, user, url);
  if (!site) return bad("no site", 404);
  const authorization = await requireSiteCapability(user, site, "canRoleManageCredits");
  if (authorization.res) return authorization.res;
  if (!(await rateLimit(env, `credits:reconcile:${user.id}`, 10, 60)).ok) return bad("Too many requests.", 429);

  const rows = await query(
    `SELECT sv.id, sv.balance, sv.total_earned, sv.total_spent,
            COALESCE(SUM(CASE WHEN cl.type = 'earn' THEN cl.amount
                              WHEN cl.type = 'refund' THEN -cl.amount
                              ELSE 0 END), 0)::int AS ledger_earned,
            COALESCE(SUM(CASE WHEN cl.type = 'spend' THEN cl.amount
                              WHEN cl.type = 'revoke' THEN -cl.amount
                              ELSE 0 END), 0)::int AS ledger_spent
       FROM site_viewers sv
       LEFT JOIN credit_ledger cl ON cl.site_viewer_id = sv.id
      WHERE sv.site_id = $1
      GROUP BY sv.id, sv.balance, sv.total_earned, sv.total_spent`,
    [site.id]
  );

  const mismatches = [];
  for (const row of rows || []) {
    const expectedBalance = (row.ledger_earned || 0) - (row.ledger_spent || 0);
    if (row.balance !== expectedBalance || row.total_earned !== row.ledger_earned || row.total_spent !== row.ledger_spent) {
      mismatches.push({
        siteViewerId: row.id,
        balance: row.balance,
        expectedBalance,
        total_earned: row.total_earned,
        ledger_earned: row.ledger_earned,
        total_spent: row.total_spent,
        ledger_spent: row.ledger_spent,
      });
    }
  }

  return ok({ ok: mismatches.length === 0, mismatches });
}
