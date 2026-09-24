// Entitlement grants, payment history, and account usage. Polar recurring
// billing is owned by handlers/polar-billing.js and enabled by configuration.
import { json, bad, ok, requireUser } from "./auth.js";
import { one, query, withTransaction } from "@yourrank/shared/db";

import {
  getPlanLimit,
  PLAN_PRICES as _PP,
  PLAN_PRICING as _PRICING,
  PLAN_META as _PM,
  CREDITS_PENDING_REDEMPTIONS_LIMITS as _CPRL,
  CREDITS_REDEMPTIONS_PER_30D_LIMITS as _CR30L,
  effectivePlan as _effectivePlan,
  priceUsd as _priceUsd,
  isPlanTier,
} from "@yourrank/shared/plans";
import { reconcileAccountActiveViewerUsage } from "@yourrank/shared/plan-usage";
import { PLAN_FEATURES } from "@yourrank/shared/plans";
import { getUsageSummary } from "@yourrank/shared/usage-meters";
import { getPolarBillingStatus } from "./handlers/polar-billing.js";

export const PLAN_PRICES = _PP;
export const PLAN_PRICING = _PRICING;
export const PLAN_META = _PM;
export const effectivePlan = _effectivePlan;
export const priceUsd = _priceUsd;
export const PRO_DAYS = 30;

const GRANT_PROVIDERS = new Set(["manual", "trial"]);
const MAX_GRANT_DAYS = 365;

/**
 * Create an explicitly authorized, fixed-duration entitlement grant.
 * This is for audited admin grants and the one-time trial only; it is not a
 * purchase path and cannot grant open-ended access.
 */
export async function activatePlan(_env, userId, plan, days = PRO_DAYS, {
  provider = "manual",
  amountUsd = 0,
  consumeTrial = false,
} = {}) {
  if (!isPlanTier(plan) || plan === "free") return false;
  if (!GRANT_PROVIDERS.has(provider)) return false;
  const grantDays = Math.trunc(Number(days));
  if (!Number.isFinite(grantDays) || grantDays < 1 || grantDays > MAX_GRANT_DAYS) return false;

  return withTransaction(async (tx) => {
    const user = await tx.one(
      `SELECT id, plan::text AS plan, has_trial,
              (EXTRACT(EPOCH FROM plan_expires_at) * 1000)::double precision AS plan_expires_at
         FROM users WHERE id=$1 FOR UPDATE`,
      [userId],
    );
    if (!user || (consumeTrial && user.has_trial)) return false;

    const current = effectivePlan(user);
    const currentExpiry = Number(user.plan_expires_at) || 0;
    const startMs = current === plan && currentExpiry > Date.now() ? currentExpiry : Date.now();
    const expiresMs = startMs + grantDays * 86_400_000;
    const updated = await tx.unsafe(
      `UPDATE users
          SET plan=$1,
              plan_expires_at=to_timestamp($2 / 1000.0),
              active_viewer_grace_started_at=NULL,
              updated_at=now()
              ${consumeTrial ? ", has_trial=TRUE" : ""}
        WHERE id=$3 ${consumeTrial ? "AND has_trial=FALSE" : ""}
        RETURNING id`,
      [plan, expiresMs, userId],
    );
    if (!updated.length) return false;

    await tx.unsafe(
      `INSERT INTO subscriptions (user_id, plan, status, provider, current_period_end)
       VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0))`,
      [userId, plan, provider === "trial" ? "trialing" : "active", provider, expiresMs],
    );
    if (provider === "manual") {
      await tx.unsafe(
        `INSERT INTO payments (user_id, provider, amount, currency, status, plan_tier)
         VALUES ($1, 'manual', $2, 'USD', 'manual', $3)`,
        [userId, Number(amountUsd) || 0, plan],
      );
    }
    return true;
  });
}

export const activatePro = (env, userId, days, options) =>
  activatePlan(env, userId, "pro", days, options);

export async function handleUserPayments(request, env) {
  const { user, res } = await requireUser(request, env);
  if (res) return res;
  try {
    const rows = await query(
      `SELECT id, provider, amount, currency, status, plan_tier, tx_ref, created_at, updated_at
         FROM payments
        WHERE user_id=$1
        ORDER BY created_at DESC
        LIMIT 100`,
      [user.id],
    );
    return json({ ok: true, payments: rows || [] });
  } catch (error) {
    console.error("[handleUserPayments] failed:", error);
    return bad("Could not load payment history. Try again later.", 500);
  }
}

export async function handleAccountUsage(request, env) {
  const { user, res } = await requireUser(request, env);
  if (res) return res;
  const plan = effectivePlan(user);
  try {
    const sites = await query("SELECT id FROM sites WHERE user_id=$1", [user.id]);
    const siteIds = (sites || []).map((site) => site.id);
    const activeSite = await one(
      `SELECT id, name FROM sites WHERE user_id=$1
        ORDER BY CASE WHEN id=(SELECT active_site_id FROM users WHERE id=$1) THEN 0 ELSE 1 END,
                 board_order ASC, id ASC
        LIMIT 1`,
      [user.id],
    );
    const [playerMax, creditsUsage, activeViewers, telegramUsage, telegramAssets, seatCount] = await Promise.all([
      siteIds.length
        ? one("SELECT COALESCE(max(c),0)::int AS count FROM (SELECT count(*) AS c FROM players WHERE site_id=ANY($1::uuid[]) GROUP BY site_id) t", [siteIds])
        : { count: 0 },
      activeSite ? getSiteCreditsUsage(activeSite.id) : null,
      reconcileAccountActiveViewerUsage(user.id),
      getUsageSummary({ one, exec: (sql, params) => query(sql, params) }, user.id).catch(() => ({})),
      Promise.all([
        one("SELECT count(*)::int AS count FROM bots WHERE owner_id=$1 AND status<>'revoked'", [user.id]),
        one("SELECT count(*)::int AS count FROM offers WHERE owner_id=$1", [user.id]),
      ]),
      one("SELECT count(DISTINCT user_id)::int AS count FROM site_members WHERE site_id IN (SELECT id FROM sites WHERE user_id=$1)", [user.id]),
    ]);
    const [botsUsed, offersUsed] = telegramAssets || [{}, {}];

    const now = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
    const limitEntry = (used, allowance, extra = {}) => ({ used: Number(used) || 0, allowance, ...extra });
    const limitBlocks = {
      sites: limitEntry(siteIds.length, getPlanLimit(plan, "sites")),
      players_per_site: limitEntry(playerMax?.count || 0, getPlanLimit(plan, "players_per_site")),
      active_viewers_30d: limitEntry(activeViewers?.activeViewers || 0, getPlanLimit(plan, "active_viewers_30d"), { level: activeViewers?.level || "normal" }),
      reward_mappings: limitEntry(creditsUsage?.rewardMappings || 0, getPlanLimit(plan, "reward_mappings")),
      shop_items: limitEntry(creditsUsage?.shopItems || 0, getPlanLimit(plan, "shop_items")),
      telegram_bots: limitEntry(botsUsed?.count || 0, getPlanLimit(plan, "telegram_bots")),
      telegram_offers: limitEntry(offersUsed?.count || 0, getPlanLimit(plan, "telegram_offers")),
      telegram_interactions_per_month: limitEntry(telegramUsage.telegram_interactions || 0, getPlanLimit(plan, "telegram_interactions_per_month"), { period_start: periodStart }),
      broadcast_deliveries_per_month: limitEntry(telegramUsage.broadcast_deliveries || 0, getPlanLimit(plan, "broadcast_deliveries_per_month"), { period_start: periodStart }),
      operator_seats: limitEntry(seatCount?.count || 0, getPlanLimit(plan, "operator_seats")),
    };
    const overLimit = Object.keys(limitBlocks).filter((k) => limitBlocks[k].used >= limitBlocks[k].allowance && limitBlocks[k].allowance >= 0);

    return ok({
      plan,
      planExpiresAt: user.plan_expires_at,
      pricing: _PRICING,
      site: activeSite ? { id: activeSite.id, name: activeSite.name } : null,
      activeViewers: activeViewers ? {
        ...activeViewers,
        upgradeAllowance: plan === "free" ? getPlanLimit("pro", "active_viewers_30d") : null,
      } : null,
      features: PLAN_FEATURES[plan] || [],
      overLimit,
      leaderboard: {
        sites: usageValue(siteIds.length, getPlanLimit(plan, "sites")),
        players: usageValue(playerMax?.count || 0, getPlanLimit(plan, "players_per_site")),
      },
      credits: activeSite && creditsUsage ? {
        rewardMappings: usageValue(creditsUsage.rewardMappings, getPlanLimit(plan, "reward_mappings")),
        shopItems: usageValue(creditsUsage.shopItems, getPlanLimit(plan, "shop_items")),
        pendingRedemptions: usageValue(creditsUsage.pendingRedemptions, _CPRL[plan]),
        redemptionsPer30Days: usageValue(creditsUsage.redemptionsPer30Days, _CR30L[plan]),
      } : null,
      limits: limitBlocks,
      billing: await getPolarBillingStatus(env, user.id),
    });
  } catch (error) {
    console.error("[handleAccountUsage] failed:", error);
    return bad("Could not load usage. Try again later.", 500);
  }
}

function usageValue(used, limit) {
  return {
    used: Number(used) || 0,
    limit,
    isLimitReached: (Number(used) || 0) >= limit,
    pct: Math.round(((Number(used) || 0) / (limit || 1)) * 100),
  };
}

async function getSiteCreditsUsage(siteId) {
  const [rewardMappings, shopItems, pendingRedemptions, redemptions30d] = await Promise.all([
    one("SELECT count(*)::int AS count FROM credit_reward_mappings WHERE site_id=$1 AND active=true", [siteId]),
    one("SELECT count(*)::int AS count FROM shop_items WHERE site_id=$1 AND active=true", [siteId]),
    one(
      `SELECT count(*)::int AS count FROM redemptions r
         JOIN site_viewers sv ON sv.id=r.site_viewer_id
        WHERE sv.site_id=$1 AND r.status='pending'`,
      [siteId],
    ),
    one(
      `SELECT count(*)::int AS count FROM redemptions r
         JOIN site_viewers sv ON sv.id=r.site_viewer_id
        WHERE sv.site_id=$1 AND r.status='fulfilled'
          AND r.created_at > now() - interval '30 days'`,
      [siteId],
    ),
  ]);
  return {
    rewardMappings: rewardMappings?.count || 0,
    shopItems: shopItems?.count || 0,
    pendingRedemptions: pendingRedemptions?.count || 0,
    redemptionsPer30Days: redemptions30d?.count || 0,
  };
}
