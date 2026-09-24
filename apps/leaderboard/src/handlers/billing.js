// Billing handlers: trial activation
import { requireUser, json, bad, rateLimit, rateLimitHeaders } from "../auth.js";
import { activatePro } from "../billing.js";
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
