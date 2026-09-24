import { requireUser as defaultRequireUser, ok, bad } from "../auth.js";
import { one as defaultOne, withTransaction as defaultTransaction } from "@yourrank/shared/db";
import { polarConfig, polarRequest, polarRedirect, billingReturnUrl, validatePolarProduct, verifyPolarWebhook, isBillingId } from "../polar.js";

const UNAVAILABLE = "Paid checkout is coming soon. Your current plan stays available.";
const depsFor = (deps) => ({ requireUser: defaultRequireUser, one: defaultOne, transaction: defaultTransaction, request: polarRequest, ...deps });

export async function getPolarBillingStatus(env, userId, deps = {}) {
  const { one } = depsFor(deps);
  const config = polarConfig(env);
  if (config.error) console.error("[polar.config]", config.error);
  const status = { provider: "polar", options: config.options, recurringCheckoutAvailable: Object.values(config.options).some((p) => Object.values(p).some(Boolean)), portalAvailable: false, hasSubscription: false, message: UNAVAILABLE };
  if (!config.ready) return status;
  const account = await one("SELECT customer_id FROM app_private.polar_accounts WHERE user_id=$1", [userId]);
  const subscription = await one("SELECT status, current_period_end, cancel_at_period_end FROM subscriptions WHERE user_id=$1 AND provider='polar' AND status IN ('active','past_due') ORDER BY current_period_end DESC LIMIT 1", [userId]);
  status.portalAvailable = !!account?.customer_id;
  status.hasSubscription = !!subscription;
  status.subscription = subscription || null;
  status.message = subscription?.cancel_at_period_end
    ? `Cancellation scheduled. Access continues until ${new Date(subscription.current_period_end).toLocaleDateString("en-US")}.`
    : subscription?.status === "past_due" ? "Payment needs attention. Update your payment method in Polar."
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

export async function syncPolarCustomer(tx, env, userId, requestApi = polarRequest) {
  // Fetch after acquiring the user lock: reordered events cannot restore stale access.
  const customer = await requestApi(env, `/customers/external/${encodeURIComponent(userId)}/state`, { allowMissing: true });
  if (customer && (customer.external_id !== userId || customer.organization_id !== env.POLAR_ORGANIZATION_ID)) throw new Error("Invalid customer state.");
  const { products, graceDays } = polarConfig(env);
  // CustomerState.active_subscriptions only ever carries active|trialing, so
  // past_due/canceled must come from the subscriptions list (all pages).
  const items = [];
  for (let page = 1, maxPage = 1; page <= maxPage; page++) {
    const list = await requestApi(env, "/subscriptions/", { query: { external_customer_id: userId, organization_id: env.POLAR_ORGANIZATION_ID, limit: 100, page } });
    for (const sub of Array.isArray(list?.items) ? list.items : []) {
      if (sub?.customer?.external_id !== userId) throw new Error("Invalid subscription owner.");
      items.push(sub);
    }
    maxPage = list?.pagination?.max_page ?? 1;
  }
  const subscriptions = items.filter((s) => products[s.product_id]);
  await tx.unsafe("UPDATE subscriptions SET status='canceled' WHERE user_id=$1 AND provider='polar'", [userId]);
  for (const sub of subscriptions) {
    if (!LIVE_SUB_STATUSES.includes(sub.status)) continue;
    if (!Number.isFinite(Date.parse(sub.current_period_end))) throw new Error("Unsupported subscription state.");
    const mapping = products[sub.product_id];
    if (sub.status === "past_due") {
      // Polar advances current_period_end into the unpaid period during dunning;
      // keep the confirmed period plus the configured grace, anchored to the
      // first locally observed past_due transition so re-syncs cannot extend it.
      await tx.unsafe(`INSERT INTO subscriptions(user_id, plan, status, provider, current_period_end, provider_subscription_id, cancel_at_period_end, past_due_since)
        VALUES ($1,$2,'past_due','polar',now() + ($3::int * interval '1 day'),$4,$5,now()) ON CONFLICT(provider_subscription_id) DO UPDATE
        SET plan=$2,status='past_due',past_due_since=COALESCE(subscriptions.past_due_since, now()),
        current_period_end=GREATEST(subscriptions.current_period_end, COALESCE(subscriptions.past_due_since, now()) + ($3::int * interval '1 day')),
        cancel_at_period_end=$5 WHERE subscriptions.user_id=$1`,
      [userId, mapping.plan, graceDays, sub.id, !!sub.cancel_at_period_end]);
      continue;
    }
    await tx.unsafe(`INSERT INTO subscriptions(user_id, plan, status, provider, current_period_end, provider_subscription_id, cancel_at_period_end)
      VALUES ($1,$2,$3,'polar',$4,$5,$6) ON CONFLICT(provider_subscription_id) DO UPDATE
      SET plan=$2,status=$3,current_period_end=$4,cancel_at_period_end=$6,past_due_since=NULL WHERE subscriptions.user_id=$1`,
    [userId, mapping.plan, sub.status, sub.current_period_end, sub.id, !!sub.cancel_at_period_end]);
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
