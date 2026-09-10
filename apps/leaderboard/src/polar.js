// Polar REST boundary. Product IDs and customer identity are server-owned.
// Contract: https://polar.sh/docs/api-reference/2026-04/introduction
import { PLAN_PRICING } from "@yourrank/shared/plans";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isBillingId = (id) => typeof id === "string" && UUID.test(id);
export function polarConfig(env) {
  const products = {};
  const options = { pro: {}, team: {} };
  const ready = ["sandbox", "production"].includes(env.POLAR_SERVER) && !!env.POLAR_ACCESS_TOKEN && !!env.POLAR_WEBHOOK_SECRET && isBillingId(env.POLAR_ORGANIZATION_ID);
  for (const plan of ["pro", "team"]) for (const interval of ["monthly", "annual"]) {
    const id = env[`POLAR_PRODUCT_${plan.toUpperCase()}_${interval.toUpperCase()}`];
    options[plan][interval] = ready && isBillingId(id);
    if (isBillingId(id)) {
      if (products[id]) throw new Error("Polar products must have distinct IDs.");
      products[id] = { plan, interval, id };
    }
  }
  return { ready, products, options, server: env.POLAR_SERVER,
    base: env.POLAR_SERVER === "production" ? "https://api.polar.sh" : "https://sandbox-api.polar.sh" };
}

export async function polarRequest(env, path, { body, fetchFn = fetch, allowMissing = false } = {}) {
  const config = polarConfig(env);
  if (!config.ready) throw new Error("Billing is not connected yet.");
  const response = await fetchFn(`${config.base}/v1${path}`, {
    method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(7000),
    headers: { Authorization: `Bearer ${env.POLAR_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (allowMissing && response.status === 404) return null;
  if (!response.ok) throw new Error(`Polar request failed (${response.status}).`);
  return response.json();
}

export function billingReturnUrl(env) {
  const url = new URL(env.PUBLIC_BASE_URL || "https://yourrank.site");
  if (url.protocol !== "https:" && !(env.POLAR_SERVER === "sandbox" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("Invalid public billing URL.");
  return `${url.origin}/dashboard/settings/billing`;
}

export function polarRedirect(url, env) {
  const parsed = new URL(url);
  const host = env.POLAR_SERVER === "production" ? "polar.sh" : "sandbox.polar.sh";
  if (parsed.protocol !== "https:" || parsed.hostname !== host || parsed.username || parsed.password) throw new Error("Invalid Polar redirect.");
  return parsed.href;
}

export function validatePolarProduct(product, mapping, env) {
  const amount = PLAN_PRICING[mapping.plan][mapping.interval === "annual" ? "annualUsd" : "monthlyUsd"] * 100;
  const interval = mapping.interval === "annual" ? "year" : "month";
  const price = product.prices?.length === 1 && product.prices.find((p) => p.amount_type === "fixed" && p.price_currency === "usd" && p.price_amount === amount);
  if (product.id !== mapping.id || product.organization_id !== env.POLAR_ORGANIZATION_ID || product.is_archived || !product.is_recurring || product.recurring_interval !== interval || (product.recurring_interval_count ?? 1) !== 1 || !price) {
    throw new Error("The billing product does not match this plan. Contact support.");
  }
}

export async function assertPolarDeletionAllowed(tx, env, userId, requestApi = polarRequest) {
  const existing = await tx.one("SELECT id FROM subscriptions WHERE user_id=$1 AND provider::text='polar' LIMIT 1", [userId]);
  if (!polarConfig(env).ready) {
    if (existing) throw Object.assign(new Error("Billing is temporarily unavailable. Contact support before deleting an account with a Polar subscription."), { code: "BILLING_ACTIVE" });
    return;
  }
  const customer = await requestApi(env, `/customers/external/${encodeURIComponent(userId)}/state`, { allowMissing: true });
  if (customer && (customer.external_id !== userId || customer.organization_id !== env.POLAR_ORGANIZATION_ID)) throw new Error("Billing account mismatch.");
  if (customer?.active_subscriptions?.some((sub) => !sub.cancel_at_period_end)) throw Object.assign(new Error("Cancel your subscription in Settings → Billing before deleting your account."), { code: "BILLING_ACTIVE" });
  const pending = await tx.one("SELECT user_id FROM app_private.polar_accounts WHERE user_id=$1 AND checkout_expires_at > now()", [userId]);
  if (pending) throw Object.assign(new Error("A payment checkout is still open. Wait for it to expire before deleting your account."), { code: "BILLING_ACTIVE" });
}

// Standard Webhooks: authenticated ID + timestamp + raw body; Web Crypto does
// the constant-time HMAC comparison. New Polar secrets use this scheme.
// Explicit legacy mode supports secrets created before 2026-09-08.
export async function verifyPolarWebhook(raw, headers, secret, { now = Date.now(), legacy = false } = {}) {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatures = headers.get("webhook-signature") || "";
  if (!secret || !id || id.length > 200 || !/^\d+$/.test(timestamp || "") || Math.abs(now / 1000 - Number(timestamp)) > 300) throw new Error("Invalid webhook.");
  const encode = new TextEncoder();
  const keyBytes = legacy ? encode.encode(secret) : Uint8Array.from(atob(secret.replace(/^whsec_/, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  for (const signature of signatures.split(" ")) {
    const [version, value] = signature.split(",");
    if (version !== "v1" || !value) continue;
    let bytes;
    try { bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0)); } catch { continue; }
    if (await crypto.subtle.verify("HMAC", key, bytes, encode.encode(`${id}.${timestamp}.${raw}`))) return JSON.parse(raw);
  }
  throw new Error("Invalid webhook signature.");
}
