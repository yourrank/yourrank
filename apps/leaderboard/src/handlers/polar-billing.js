import { requireUser as defaultRequireUser, ok, bad } from "../auth.js";
import { logAudit as defaultLogAudit } from "@yourrank/shared/audit";
import { one as defaultOne, withTransaction as defaultTransaction } from "@yourrank/shared/db";
import { polarConfig, polarRequest, polarRedirect, billingReturnUrl, validatePolarProduct, verifyPolarWebhook, isBillingId } from "../polar.js";
import { planChangeFor } from "@yourrank/shared/plan-changes";

const UNAVAILABLE = "Paid checkout is coming soon. Your current plan stays available.";
const depsFor = (deps) => ({ requireUser: defaultRequireUser, one: defaultOne, transaction: defaultTransaction, request: polarRequest, logAudit: defaultLogAudit, ...deps });

export async function getPolarBillingStatus(env, userId, deps = {}) {
  const { one } = depsFor(deps);
  const config = polarConfig(env);
  if (config.error) console.error("[polar.config]", config.error);
  const status = { provider: "polar", options: config.options, recurringCheckoutAvailable: Object.values(config.options).some((p) => Object.values(p).some(Boolean)), portalAvailable: false, hasSubscription: false, message: UNAVAILABLE };
  if (!config.ready) return status;
  const account = await one("SELECT customer_id FROM app_private.polar_accounts WHERE user_id=$1", [userId]);
  const subscription = await one("SELECT plan, billing_interval, status, current_period_end, cancel_at_period_end, pending_plan, pending_interval, pending_applies_at FROM subscriptions WHERE user_id=$1 AND provider='polar' AND status IN ('active','past_due') ORDER BY current_period_end DESC LIMIT 1", [userId]);
  status.portalAvailable = !!account?.customer_id;
  status.hasSubscription = !!subscription;
  status.subscription = subscription ? {
    plan: subscription.plan,
    interval: subscription.billing_interval || null,
    status: subscription.status,
    current_period_end: subscription.current_period_end,
    cancel_at_period_end: !!subscription.cancel_at_period_end,
    pending: subscription.pending_plan && subscription.pending_interval
      ? { plan: subscription.pending_plan, interval: subscription.pending_interval, applies_at: subscription.pending_applies_at }
      : null,
  } : null;
  status.changeAvailable = !!subscription && subscription.status === "active" && !!subscription.billing_interval;
  status.message = subscription?.cancel_at_period_end
    ? `Cancellation scheduled. Access continues until ${new Date(subscription.current_period_end).toLocaleDateString("en-US")}.`
    : subscription?.status === "past_due" ? "Payment needs attention. Update your payment method in Polar."
    : status.subscription?.pending ? `Plan change scheduled for ${new Date(status.subscription.pending.applies_at || subscription.current_period_end).toLocaleDateString("en-US")}.`
    : subscription ? "Manage renewals, payment details, and invoices in Polar."
    : status.recurringCheckoutAvailable ? "Secure checkout with Polar. Your plan activates after payment is confirmed." : UNAVAILABLE;
  return status;
}

export async function handlePolarCheckout(request, env, deps = {}) {
  const d = depsFor(deps);
  const { user, res } = await d.requireUser(request, env);
  if (res) return res;
  if (user.status === "suspended") return bad("This account is suspended.", 403);
  const body = await request.json().catch(() => null);
  if (!["pro", "team"].includes(body?.plan) || !["monthly", "annual"].includes(body?.interval)) return bad("Choose a valid plan and billing interval.", 400);
  try {
    const config = polarConfig(env);
    if (!config.options[body.plan][body.interval]) return bad(UNAVAILABLE, 503);
    const mapping = Object.values(config.products).find((p) => p.plan === body.plan && p.interval === body.interval);
    const attemptId = crypto.randomUUID();
    const result = await d.transaction(async (tx) => {
      // Serializes concurrent clicks, checkout creation, and webhook processing.
      await tx.one("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user.id]);
      const customer = await d.request(env, `/customers/external/${encodeURIComponent(user.id)}/state`, { allowMissing: true });
      if (customer && (customer.external_id !== user.id || customer.organization_id !== env.POLAR_ORGANIZATION_ID)) throw new Error("Billing account mismatch.");
      if (customer?.active_subscriptions?.length) return { conflict: "You already have a subscription. Use Manage subscription to change it." };
      const pending = await tx.one("SELECT * FROM app_private.polar_accounts WHERE user_id=$1 AND checkout_expires_at > now()", [user.id]);
      if (pending?.checkout_url) {
        if (pending.checkout_plan !== body.plan || pending.checkout_interval !== body.interval) return { conflict: "A checkout is already open for another plan. Finish it or wait for it to expire before choosing a different plan." };
        return { url: polarRedirect(pending.checkout_url, env) };
      }
      if (pending?.checkout_attempt_id) return { conflict: "A checkout is being prepared. Refresh Billing shortly. Contact support if it remains unavailable." };
      const product = await d.request(env, `/products/${mapping.id}`);
      validatePolarProduct(product, mapping, env);
      billingReturnUrl(env);
      // A reservation may have expired while its checkout is still open at the
      // provider — reconcile against open checkouts before creating another.
      const open = await d.request(env, "/checkouts/", { query: { external_customer_id: user.id, organization_id: env.POLAR_ORGANIZATION_ID, status: "open", limit: 10 } });
      const openItems = Array.isArray(open?.items) ? open.items : [];
      const live = (c) => Number.isFinite(Date.parse(c?.expires_at)) && Date.parse(c.expires_at) > Date.now() && c.url;
      const usable = openItems.find((c) => (c.product_id === mapping.id || c.products?.[0]?.id === mapping.id) && live(c));
      if (usable) {
        const url = polarRedirect(usable.url, env);
        await tx.unsafe(`INSERT INTO app_private.polar_accounts(user_id,checkout_url,checkout_plan,checkout_interval,checkout_expires_at,checkout_attempt_id)
          VALUES ($1,$2,$3,$4,$5,NULL) ON CONFLICT(user_id) DO UPDATE SET checkout_url=$2,checkout_plan=$3,
          checkout_interval=$4,checkout_expires_at=$5,checkout_attempt_id=NULL,updated_at=now()`, [user.id,url,body.plan,body.interval,usable.expires_at]);
        return { url };
      }
      if (openItems.some(live)) return { conflict: "A checkout is already open for another plan. Finish it or wait for it to expire before choosing a different plan." };
      // Commit a durable reservation BEFORE a non-idempotent provider request.
      // An uncertain response or DB failure must never silently create another checkout.
      await tx.unsafe(`INSERT INTO app_private.polar_accounts(user_id,checkout_attempt_id,checkout_plan,checkout_interval,checkout_expires_at)
        VALUES ($1,$2,$3,$4,now() + interval '15 minutes') ON CONFLICT(user_id) DO UPDATE SET checkout_attempt_id=$2,checkout_url=NULL,
        checkout_plan=$3,checkout_interval=$4,checkout_expires_at=now() + interval '15 minutes',updated_at=now()`, [user.id,attemptId,body.plan,body.interval]);
      return { reserved: true };
    });
    if (result.conflict) return bad(result.conflict, 409);
    if (result.url) return ok(result);
    const returnUrl = billingReturnUrl(env);
    let checkout;
    try {
      checkout = await d.request(env, "/checkouts/", { body: {
        products: [mapping.id], external_customer_id: user.id, customer_email: user.email,
        ...(request.headers.get("CF-Connecting-IP") ? { customer_ip_address: request.headers.get("CF-Connecting-IP") } : {}),
        allow_trial: false, allow_discount_codes: false,
        success_url: `${returnUrl}?billing=return`, return_url: returnUrl,
      } });
    } catch (error) {
      // A definite rejection means no checkout exists — release the reservation.
      if (/^Polar request failed \(4\d\d\)/.test(error.message)) {
        try {
          await d.transaction((tx) => tx.unsafe("UPDATE app_private.polar_accounts SET checkout_attempt_id=NULL,checkout_url=NULL,checkout_expires_at=NULL,updated_at=now() WHERE user_id=$1 AND checkout_attempt_id=$2", [user.id, attemptId]));
        } catch { /* recovery must not mask the provider failure */ }
      }
      throw error;
    }
      const url = polarRedirect(checkout.url, env);
      if (!Number.isFinite(Date.parse(checkout.expires_at))) throw new Error("Invalid checkout expiry.");
      await d.transaction(async (tx) => {
        await tx.unsafe("UPDATE app_private.polar_accounts SET checkout_url=$3,checkout_expires_at=$4,updated_at=now() WHERE user_id=$1 AND checkout_attempt_id=$2", [user.id,attemptId,url,checkout.expires_at]);
      });
    await d.logAudit({ actorId: user.id, action: "billing.checkout_started", entityType: "plan", entityId: body.plan, details: { plan: body.plan, event: "checkout_started" }, request });
    return ok({ url });
  } catch (error) {
    console.error("[polar.checkout]", error.name, error.message?.startsWith("Polar request failed") ? error.message : "checkout_failed");
    return bad("Could not open Polar checkout. Refresh Billing before trying again. Contact support if it remains unavailable.", 502);
  }
}

export async function handlePolarPortal(request, env, deps = {}) {
  const d = depsFor(deps);
  const { user, res } = await d.requireUser(request, env);
  if (res) return res;
  if (user.status === "suspended") return bad("This account is suspended.", 403);
  if (!polarConfig(env).ready) return bad(UNAVAILABLE, 503);
  try {
    const customer = await d.request(env, `/customers/external/${encodeURIComponent(user.id)}/state`);
    if (customer.external_id !== user.id || customer.organization_id !== env.POLAR_ORGANIZATION_ID) throw new Error("Billing account mismatch.");
    const session = await d.request(env, "/customer-sessions/", { body: { customer_id: customer.id, return_url: billingReturnUrl(env) } });
    return ok({ url: polarRedirect(session.customer_portal_url, env) });
  } catch {
    return bad("Could not open subscription management. Please try again.", 502);
  }
}

const LIVE_SUB_STATUSES = ["active", "trialing", "past_due"];

const CHANGE_FAILED = "Could not update your subscription. Refresh Billing to see its current state before trying again.";

/**
 * Semantic plan change for an existing Polar subscriber. The frontend sends
 * `{ plan, interval }` (or `{ plan: "free" }` to cancel, `{ action: "keep" }`
 * to undo a scheduled cancellation/change); the server owns product IDs and
 * proration. Entitlements are never written here — the update is applied at
 * Polar, then reconciled through the same path webhooks use.
 */
export async function handlePolarPlanChange(request, env, deps = {}) {
  const d = depsFor(deps);
  const { user, res } = await d.requireUser(request, env);
  if (res) return res;
  if (user.status === "suspended") return bad("This account is suspended.", 403);
  const body = await request.json().catch(() => null);
  const keep = body?.action === "keep";
  const target = keep ? null : { plan: body?.plan, interval: body?.interval };
  if (!keep) {
    if (target.plan === "free") target.interval = null;
    else if (!["pro", "team"].includes(target.plan) || !["monthly", "annual"].includes(target.interval)) return bad("Choose a valid plan and billing interval.", 400);
  }
  const config = polarConfig(env);
  if (!config.ready) return bad(UNAVAILABLE, 503);
  try {
    const result = await d.transaction(async (tx) => {
      // Serializes concurrent clicks and webhook reconciliation for this account.
      await tx.one("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user.id]);
      const { customer, subscriptions } = await fetchPolarSubscriptions(env, user.id, d.request);
      if (!customer) return { error: "No subscription to change. Start a checkout instead.", status: 409 };
      const live = subscriptions.filter((s) => LIVE_SUB_STATUSES.includes(s.status));
      if (live.length === 0) return { error: "No subscription to change. Start a checkout instead.", status: 409 };
      if (live.length > 1) return { error: "Your account has more than one subscription. Contact support to resolve it before changing plans.", status: 409 };
      const sub = live[0];
      if (!isBillingId(sub.id)) throw new Error("Invalid subscription.");
      if (sub.status === "past_due") return { error: "Payment needs attention. Update your payment method in Polar before changing plans.", status: 409 };
      const mapping = config.products[sub.product_id];
      const current = { plan: mapping.plan, interval: mapping.interval, cancelAtPeriodEnd: !!sub.cancel_at_period_end, pending: pendingChange(sub, config.products) };
      let patch = null;
      let change;
      if (keep) {
        change = { kind: "keep", timing: "none" };
        if (current.cancelAtPeriodEnd) patch = { cancel_at_period_end: false };
        else if (sub.pending_update) patch = { pending_update: null };
      } else {
        change = planChangeFor(current, target);
        if (change.kind === "cancel") {
          if (!current.cancelAtPeriodEnd) patch = { cancel_at_period_end: true };
        } else if (change.kind === "current" || change.kind === "pending") {
          if (change.kind === "current" && sub.pending_update) patch = { pending_update: null };
        } else {
          if (current.cancelAtPeriodEnd) return { error: "Your subscription is scheduled to cancel. Choose Keep current plan first, then change it.", status: 409 };
          if (!config.options[target.plan][target.interval]) return { error: UNAVAILABLE, status: 503 };
          const destination = Object.values(config.products).find((p) => p.plan === target.plan && p.interval === target.interval);
          const product = await d.request(env, `/products/${destination.id}`);
          validatePolarProduct(product, destination, env);
          patch = { product_id: destination.id, proration_behavior: change.proration };
        }
      }
      if (patch) {
        try {
          await d.request(env, `/subscriptions/${sub.id}`, { method: "PATCH", body: patch });
        } catch (error) {
          if (error.status === 402) return { error: "Polar could not charge your payment method for this change. Update it in Polar and try again.", status: 402 };
          if (error.status === 403) return { error: "Your subscription is scheduled to cancel. Choose Keep current plan first, then change it.", status: 409 };
          if (error.status === 409) return { error: "Polar is still applying a previous change to this subscription. Refresh Billing in a moment.", status: 409 };
          throw error;
        }
      }
      // Authoritative state comes back from Polar; the webhook re-runs this idempotently.
      await syncPolarCustomer(tx, env, user.id, d.request);
      return { change, applied: !!patch, from: { plan: current.plan, interval: current.interval }, to: target };
    });
    if (result.error) return bad(result.error, result.status);
    if (result.applied) {
      await d.logAudit({ actorId: user.id, action: "billing.plan_change_requested", entityType: "plan", entityId: result.to?.plan || result.from.plan,
        details: { event: "plan_change_requested", kind: result.change.kind, timing: result.change.timing, from: result.from, to: result.to } , request });
    }
    return ok({ change: result.change.kind, timing: result.change.timing, applied: result.applied, billing: await getPolarBillingStatus(env, user.id, deps) });
  } catch (error) {
    console.error("[polar.plan_change]", error.name, error.message?.startsWith("Polar request failed") ? error.message : "plan_change_failed");
    return bad(CHANGE_FAILED, 502);
  }
}

/** Provider-authoritative customer + subscriptions for one YourRank account (all pages, ownership-checked). */
export async function fetchPolarSubscriptions(env, userId, requestApi = polarRequest) {
  const customer = await requestApi(env, `/customers/external/${encodeURIComponent(userId)}/state`, { allowMissing: true });
  if (customer && (customer.external_id !== userId || customer.organization_id !== env.POLAR_ORGANIZATION_ID)) throw new Error("Invalid customer state.");
  const { products } = polarConfig(env);
  // CustomerState.active_subscriptions only ever carries active|trialing, so
  // past_due/canceled must come from the subscriptions list (all pages).
  const items = [];
  for (let page = 1, maxPage = 1; page <= maxPage; page++) {
    const list = await requestApi(env, "/subscriptions/", { query: { external_customer_id: userId, organization_id: env.POLAR_ORGANIZATION_ID, limit: 100, page } });
    for (const sub of Array.isArray(list?.items) ? list.items : []) {
      if (sub?.customer?.external_id !== userId) throw new Error("Invalid subscription owner.");
      if (customer && sub.customer_id && sub.customer_id !== customer.id) throw new Error("Invalid subscription owner.");
      items.push(sub);
    }
    maxPage = list?.pagination?.max_page ?? 1;
  }
  return { customer, subscriptions: items.filter((s) => products[s.product_id]) };
}

function pendingChange(sub, products) {
  const pending = sub.pending_update;
  if (!pending) return null;
  const target = pending.product_id ? products[pending.product_id] : null;
  if (!target || !Number.isFinite(Date.parse(pending.applies_at))) return null;
  return { plan: target.plan, interval: target.interval, appliesAt: pending.applies_at };
}

export async function syncPolarCustomer(tx, env, userId, requestApi = polarRequest) {
  // Fetch after acquiring the user lock: reordered events cannot restore stale access.
  const { customer, subscriptions } = await fetchPolarSubscriptions(env, userId, requestApi);
  const { products, graceDays } = polarConfig(env);
  await tx.unsafe("UPDATE subscriptions SET status='canceled' WHERE user_id=$1 AND provider='polar'", [userId]);
  for (const sub of subscriptions) {
    if (!LIVE_SUB_STATUSES.includes(sub.status)) continue;
    if (!Number.isFinite(Date.parse(sub.current_period_end))) throw new Error("Unsupported subscription state.");
    const mapping = products[sub.product_id];
    const pending = pendingChange(sub, products);
    const pendingArgs = [mapping.interval, pending?.plan || null, pending?.interval || null, pending?.appliesAt || null];
    if (sub.status === "past_due") {
      // Polar advances current_period_end into the unpaid period during dunning;
      // keep the confirmed period plus the configured grace, anchored to the
      // first locally observed past_due transition so re-syncs cannot extend it.
      await tx.unsafe(`INSERT INTO subscriptions(user_id, plan, status, provider, current_period_end, provider_subscription_id, cancel_at_period_end, past_due_since, billing_interval, pending_plan, pending_interval, pending_applies_at)
        VALUES ($1,$2,'past_due','polar',now() + ($3::int * interval '1 day'),$4,$5,now(),$6,$7,$8,$9) ON CONFLICT(provider_subscription_id) DO UPDATE
        SET plan=$2,status='past_due',past_due_since=COALESCE(subscriptions.past_due_since, now()),
        current_period_end=GREATEST(subscriptions.current_period_end, COALESCE(subscriptions.past_due_since, now()) + ($3::int * interval '1 day')),
        cancel_at_period_end=$5,billing_interval=$6,pending_plan=$7,pending_interval=$8,pending_applies_at=$9 WHERE subscriptions.user_id=$1`,
      [userId, mapping.plan, graceDays, sub.id, !!sub.cancel_at_period_end, ...pendingArgs]);
      continue;
    }
    await tx.unsafe(`INSERT INTO subscriptions(user_id, plan, status, provider, current_period_end, provider_subscription_id, cancel_at_period_end, billing_interval, pending_plan, pending_interval, pending_applies_at)
      VALUES ($1,$2,$3,'polar',$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(provider_subscription_id) DO UPDATE
      SET plan=$2,status=$3,current_period_end=$4,cancel_at_period_end=$6,past_due_since=NULL,billing_interval=$7,pending_plan=$8,pending_interval=$9,pending_applies_at=$10 WHERE subscriptions.user_id=$1`,
    [userId, mapping.plan, sub.status, sub.current_period_end, sub.id, !!sub.cancel_at_period_end, ...pendingArgs]);
  }
  // Preserve valid manual/trial grants. Polar revocation only removes Polar access.
  const entitlement = await tx.one(`SELECT plan, current_period_end FROM subscriptions
    WHERE user_id=$1 AND status IN ('active','trialing','past_due') AND current_period_end > now()
    ORDER BY CASE plan WHEN 'team' THEN 2 WHEN 'pro' THEN 1 ELSE 0 END DESC, current_period_end DESC LIMIT 1`, [userId]);
  await tx.unsafe("UPDATE users SET plan=$2, plan_expires_at=$3, updated_at=now() WHERE id=$1", [userId, entitlement?.plan || "free", entitlement?.current_period_end || null]);
  if (customer) {
    const hasLive = subscriptions.some((s) => LIVE_SUB_STATUSES.includes(s.status));
    await tx.unsafe(`INSERT INTO app_private.polar_accounts(user_id,customer_id) VALUES ($1,$2) ON CONFLICT(user_id)
      DO UPDATE SET customer_id=$2, checkout_url=CASE WHEN $3 THEN NULL ELSE polar_accounts.checkout_url END,
      checkout_expires_at=CASE WHEN $3 THEN NULL ELSE polar_accounts.checkout_expires_at END,
      checkout_attempt_id=CASE WHEN $3 THEN NULL ELSE polar_accounts.checkout_attempt_id END, updated_at=now()`, [userId, customer.id, hasLive]);
  }
  return customer;
}

const WEBHOOK_EVENTS = /^customer\.state_changed$|^customer\.deleted$|^subscription\.|^order\.(paid|refunded)$/;

export async function handlePolarWebhook(request, env, deps = {}) {
  const d = depsFor(deps);
  const config = polarConfig(env);
  if (config.error) console.error("[polar.config]", config.error);
  if (!config.ready) return bad("Billing is not configured.", 503);
  const raw = await request.text();
  if (raw.length > 262144) return bad("Payload too large.", 413);
  let event;
  try { event = await verifyPolarWebhook(raw, request.headers, env.POLAR_WEBHOOK_SECRET); }
  catch { return bad("Invalid webhook signature.", 403); }
  if (!WEBHOOK_EVENTS.test(event.type)) return ok({ ignored: true });
  const userId = event.type.startsWith("customer.") ? event.data?.external_id : event.data?.customer?.external_id;
  if (!isBillingId(userId)) return ok({ ignored: true });
  const requestApi = (requestEnv, path, options = {}) => d.request(requestEnv, path, { timeoutMs: 4000, ...options });
  try {
    await d.transaction(async (tx) => {
      const user = await tx.one("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
      if (!user) return; // Deleted accounts must never be recreated by a callback.
      const duplicate = await tx.one("SELECT id FROM app_private.polar_webhook_events WHERE id=$1", [request.headers.get("webhook-id")]);
      if (duplicate) return;
      await syncPolarCustomer(tx, env, userId, requestApi);
      if (event.type.startsWith("order.")) {
        if (!isBillingId(event.data?.id)) throw new Error("Invalid order.");
        const order = await requestApi(env, `/orders/${event.data.id}`);
        const mapping = config.products[order.product_id];
        if (order.customer?.external_id !== userId || order.customer?.organization_id !== env.POLAR_ORGANIZATION_ID) throw new Error("Order ownership mismatch.");
        if (mapping && order.paid) {
          const refunded = Number(order.refunded_amount) >= Number(order.total_amount);
          await tx.unsafe(`INSERT INTO payments(user_id,provider,amount,currency,status,plan_tier,tx_ref,polar_order_id,payload_json)
            VALUES ($1,'polar',$2,$3,$4,$5,$6,$6,$7) ON CONFLICT(polar_order_id)
            DO UPDATE SET amount=$2,currency=$3,status=$4,payload_json=$7,updated_at=now() WHERE payments.user_id=$1`,
          [userId, Number(order.total_amount) / 100, String(order.currency).toUpperCase(), refunded ? "refunded" : "confirmed", mapping.plan, order.id, { refunded_amount: Number(order.refunded_amount) || 0 }]);
          await defaultLogAudit({ actorId: userId, action: "billing.checkout_completed", entityType: "plan", entityId: mapping.plan, details: { plan: mapping.plan, event: "checkout_completed", order_id: order.id, status: refunded ? "refunded" : "confirmed" } });
        }
      }
      await tx.unsafe("INSERT INTO app_private.polar_webhook_events(id,event_type,user_id) VALUES ($1,$2,$3)", [request.headers.get("webhook-id"), event.type, userId]);
    });
    return ok({ received: true });
  } catch (error) {
    console.error("[polar.webhook]", error.name, "processing_failed");
    return bad("Webhook processing failed. Retry delivery.", 500);
  }
}
