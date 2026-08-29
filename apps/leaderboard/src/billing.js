// Billing Phase 2A: entitlement grants, payment history, and account usage.
// Recurring checkout is intentionally absent until a provider is operationally
// available to the project's legal/deployment entity.
import { json, bad, ok, requireUser } from "./auth.js";
import { one, query, withTransaction } from "@yourrank/shared/db";
import { logAudit } from "@yourrank/shared/audit";
import {
  PLAN_LIMITS as _PL,
  BOARD_LIMITS as _BL,
  PLAN_PRICES as _PP,
  PLAN_PRICING as _PRICING,
  PLAN_META as _PM,
  CREDITS_REWARD_LIMITS as _CRL,
  CREDITS_SHOP_LIMITS as _CSL,
  CREDITS_PENDING_REDEMPTIONS_LIMITS as _CPRL,
  CREDITS_REDEMPTIONS_PER_30D_LIMITS as _CR30L,
  ACTIVE_VIEWER_LIMITS as _AVL,
  effectivePlan as _effectivePlan,
  priceUsd as _priceUsd,
  isPlanTier,
} from "@yourrank/shared/plans";
import { reconcileAccountActiveViewerUsage } from "@yourrank/shared/plan-usage";

export const PLAN_LIMITS = _PL;
export const BOARD_LIMITS = _BL;
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
      `SELECT id FROM sites WHERE user_id=$1
        ORDER BY CASE WHEN id=(SELECT active_site_id FROM users WHERE id=$1) THEN 0 ELSE 1 END,
                 board_order ASC, id ASC
        LIMIT 1`,
      [user.id],
    );
    const [playerCount, creditsUsage, activeViewers] = await Promise.all([
      siteIds.length
        ? one("SELECT count(*)::int AS count FROM players WHERE site_id = ANY($1)", [siteIds])
        : { count: 0 },
      activeSite ? getSiteCreditsUsage(activeSite.id) : null,
      reconcileAccountActiveViewerUsage(user.id),
    ]);

    return ok({
      plan,
      pricing: _PRICING,
      activeViewers: activeViewers ? {
        ...activeViewers,
        upgradeAllowance: plan === "free" ? _AVL.pro : null,
      } : null,
      leaderboard: {
        sites: usageValue(siteIds.length, _BL[plan]),
        players: usageValue(playerCount?.count || 0, _PL[plan]),
      },
      credits: activeSite && creditsUsage ? {
        rewardMappings: usageValue(creditsUsage.rewardMappings, _CRL[plan]),
        shopItems: usageValue(creditsUsage.shopItems, _CSL[plan]),
        pendingRedemptions: usageValue(creditsUsage.pendingRedemptions, _CPRL[plan]),
        redemptionsPer30Days: usageValue(creditsUsage.redemptionsPer30Days, _CR30L[plan]),
      } : null,
      limits: {
        sites: _BL[plan],
        playersPerSite: _PL[plan],
        activeViewers: _AVL[plan],
        rewardMappings: _CRL[plan],
        shopItems: _CSL[plan],
      },
      billing: {
        recurringCheckoutAvailable: false,
        message: "Recurring card billing is not available yet.",
      },
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

/** A removed purchase endpoint must remain unmistakably unavailable if called by stale clients. */
export async function handleBillingUnavailable(request, env) {
  const { user, res } = await requireUser(request, env);
  if (res) return res;
  await logAudit({
    actorId: user.id,
    action: "billing_unavailable",
    entityType: "billing",
    entityId: "recurring_checkout",
    request,
    details: { reason: "provider_unavailable" },
  }).catch(() => {});
  return bad("Recurring card billing is not available yet.", 503);
}
