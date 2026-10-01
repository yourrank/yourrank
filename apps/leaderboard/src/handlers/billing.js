// Billing handlers: trial activation
import { requireUser, json, ok, bad, rateLimit, rateLimitHeaders } from "../auth.js";
import { activatePro } from "../billing.js";
import { withTransaction } from "@yourrank/shared/db";
import { effectivePlan } from "@yourrank/shared/plans";
import { logAudit } from "@yourrank/shared/audit";

// POST /api/billing/trial — start a free 7-day Pro trial (one-time per user).
export async function handleTrial(request, env) {
  try {
    const { user, res } = await requireUser(request, env);
    if (res) return res;
    if (user.status === "suspended") return bad("This account is suspended.", 403);

    // Gate: one trial ever
    if (user.has_trial) return bad("You've already used your free trial.", 400);

    // Don't allow trial if already on a paid plan
    const current = effectivePlan(user);
    if (current !== "free") return bad("You're already on a paid plan.", 400);

    // Activate 7-day Pro trial and consume the trial flag in the same
    // transaction. If the transaction fails, the user can retry because
    // has_trial was not committed separately first.
    const activated = await activatePro(env, user.id, 7, { provider: "trial", consumeTrial: true });
    if (!activated) return bad("You've already used your free trial or the activation failed.", 400);

    await logAudit({
      actorId: user.id,
      action: "trial_activate",
      entityType: "subscription",
      entityId: user.id,
      request,
      details: { plan: "pro", days: 7, provider: "trial" },
    });

    // Calculate expiry for the response
    const expiresMs = Date.now() + 7 * 86400000;
    const expiresAt = new Date(expiresMs).toISOString();

    return json({ ok: true, expiresAt, days: 7 });
  } catch (e) {
    console.error("trial failed:", String(e?.message || e));
    return bad("Couldn't start trial. Try again.", 500);
  }
}

export async function handleEndPlanAccess(request, env, {
  requireUserImpl = requireUser,
  transactionImpl = withTransaction,
  logAuditImpl = logAudit,
} = {}) {
  try {
    const { user, res } = await requireUserImpl(request, env);
    if (res) return res;
    if (user.status === "suspended") return bad("This account is suspended.", 403);

    const result = await transactionImpl(async (tx) => {
      const row = await tx.one(
        `SELECT id, plan::text AS plan, status,
                (EXTRACT(EPOCH FROM plan_expires_at) * 1000)::double precision AS plan_expires_at
           FROM users WHERE id=$1 FOR UPDATE`,
        [user.id],
      );
      if (!row) throw new Error("Plan access user was not found.");
      if (row.status === "suspended") return { conflict: "suspended" };

      const previousPlan = effectivePlan(row);
      if (previousPlan === "free") return { conflict: "free" };

      const polarSubscription = await tx.one(
        `SELECT id FROM subscriptions
          WHERE user_id=$1 AND provider='polar' AND status IN ('active','past_due')
          LIMIT 1`,
        [user.id],
      );
      if (polarSubscription) return { conflict: "polar" };

      await tx.unsafe(
        `UPDATE users SET plan='free', plan_expires_at=NULL, updated_at=now() WHERE id=$1`,
        [user.id],
      );
      await tx.unsafe(
        `UPDATE subscriptions SET status='canceled'
          WHERE user_id=$1 AND provider <> 'polar' AND status IN ('active','trialing')`,
        [user.id],
      );
      return { previousPlan };
    });

    if (result.conflict === "suspended") return bad("This account is suspended.", 403);
    if (result.conflict === "free") return bad("You're already on Free.", 409);
    if (result.conflict === "polar") return bad("Your plan is a Polar subscription. Cancel it from Billing instead.", 409);

    await logAuditImpl({
      actorId: user.id,
      action: "billing.plan_access_ended",
      entityType: "plan",
      entityId: result.previousPlan,
      details: { from: result.previousPlan },
      request,
    });
    return ok({ plan: "free" });
  } catch (error) {
    console.error("[handleEndPlanAccess] failed:", String(error?.message || error));
    return bad("Couldn't switch to Free. Try again.", 500);
  }
}

const FUNNEL_EVENTS = new Set(["paywall_viewed", "upgrade_clicked"]);

// POST /api/billing/funnel — allowlisted client-side billing funnel events.
// Accepts {event, feature?, limit?}; rejects anything else. Rate limited so a
// noisy client cannot flood the audit log.
export async function handleBillingFunnel(request, env, {
  requireUserImpl = requireUser,
  rateLimitImpl = rateLimit,
  logAuditImpl = logAudit,
} = {}) {
  const { user, res } = await requireUserImpl(request, env);
  if (res) return res;
  const rl = await rateLimitImpl(env, `billing-funnel:${user.id}`, 60, 60);
  if (!rl.ok) return bad("Too many requests.", 429, rateLimitHeaders(rl));
  const body = await request.json().catch(() => null);
  const event = typeof body?.event === "string" ? body.event : null;
  if (!event || !FUNNEL_EVENTS.has(event)) return bad("Unknown funnel event.", 400);
  const details = { event };
  if (typeof body.feature === "string" && body.feature.length <= 64) details.feature = body.feature;
  if (typeof body.limit === "string" && body.limit.length <= 64) details.limit = body.limit;
  await logAuditImpl({
    actorId: user.id,
    action: `billing.${event}`,
    entityType: "plan",
    request,
    details,
  });
  return json({ ok: true });
}
