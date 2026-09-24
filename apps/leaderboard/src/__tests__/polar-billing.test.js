import { describe, test, expect } from "bun:test";
import { polarConfig, polarRequest, PolarRequestError, polarRedirect, validatePolarProduct, verifyPolarWebhook, assertPolarDeletionAllowed } from "../polar.js";
import { handlePolarCheckout, handlePolarPortal, handlePolarWebhook, getPolarBillingStatus, syncPolarCustomer } from "../handlers/polar-billing.js";
import { shouldRequireCsrf } from "../middleware/csrf.js";

const userId = "00000000-0000-4000-8000-000000000001";
const productId = "00000000-0000-4000-8000-000000000002";
const orgId = "00000000-0000-4000-8000-000000000003";
const secret = `whsec_${btoa("local-test-signature-key-32-bytes!")}`;
const env = { POLAR_SERVER: "sandbox", POLAR_ACCESS_TOKEN: "test-token", POLAR_WEBHOOK_SECRET: secret, POLAR_ORGANIZATION_ID: orgId, POLAR_PRODUCT_PRO_MONTHLY: productId };
const user = { id: userId, email: "test@example.invalid", status: "active" };
const customer = { id: "00000000-0000-4000-8000-000000000004", external_id: userId, organization_id: orgId, active_subscriptions: [] };
const product = { id: productId, organization_id: orgId, is_archived: false, is_recurring: true, recurring_interval: "month", prices: [{ amount_type: "fixed", price_currency: "usd", price_amount: 2400 }] };
const req = (body = { plan: "pro", interval: "monthly" }) => new Request("https://yourrank.site/api/billing/checkout", { method: "POST", body: JSON.stringify(body) });
const auth = async () => ({ user });

// keyForm "raw" signs with the UTF-8 secret bytes (official SDK form);
// "whsec" signs with the base64-decoded whsec_ remainder (Standard Webhooks).
export async function signedRequest(event, { id = crypto.randomUUID(), timestamp = Math.floor(Date.now() / 1000), signingSecret = secret, keyForm = "whsec" } = {}) {
  const raw = JSON.stringify(event);
  const bytes = keyForm === "raw" ? new TextEncoder().encode(signingSecret) : Uint8Array.from(atob(signingSecret.replace(/^whsec_/, "")), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${raw}`));
  return new Request("https://yourrank.site/api/billing/webhook/polar", { method: "POST", body: raw, headers: { "webhook-id": id, "webhook-timestamp": String(timestamp), "webhook-signature": `v1,${btoa(String.fromCharCode(...new Uint8Array(signature)))}` } });
}

describe("Polar boundary", () => {
  test("account deletion requires cancelled billing and no open checkout", async () => {
    const tx = { one: async () => null };
    await expect(assertPolarDeletionAllowed(tx, env, userId, async () => ({ ...customer, active_subscriptions: [{ cancel_at_period_end: false }] }))).rejects.toThrow("Cancel your subscription");
    await expect(assertPolarDeletionAllowed(tx, env, userId, async () => ({ ...customer, active_subscriptions: [{ cancel_at_period_end: true }] }))).resolves.toBeUndefined();
    await expect(assertPolarDeletionAllowed({ one: async () => ({ id: userId }) }, {}, userId)).rejects.toThrow("Billing is temporarily unavailable");
  });
  test("unconfigured billing stays usable and never offers a charge", async () => {
    const status = await getPolarBillingStatus({}, userId, { one: () => { throw new Error("DB must not be needed"); } });
    expect(status.recurringCheckoutAvailable).toBe(false);
    expect((await handlePolarCheckout(req(), {}, { requireUser: auth })).status).toBe(503);
  });
  test("maps only configured products and rejects ambiguous mappings", () => {
    expect(polarConfig(env).options.pro.monthly).toBe(true);
    expect(polarConfig(env).options.pro.annual).toBe(false);
    expect(() => polarConfig({ ...env, POLAR_PRODUCT_TEAM_ANNUAL: productId })).toThrow();
    expect(polarConfig({ ...env, POLAR_SERVER: "typo" }).ready).toBe(false);
  });
  test("checks catalog price, currency, interval, organization, and archive state", () => {
    const mapping = polarConfig(env).products[productId];
    expect(() => validatePolarProduct(product, mapping, env)).not.toThrow();
    for (const patch of [{ organization_id: userId }, { is_archived: true }, { recurring_interval: "year" }, { prices: [] }, { recurring_interval_count: 2 }]) expect(() => validatePolarProduct({ ...product, ...patch }, mapping, env)).toThrow();
  });
  test("rejects redirect injection and wrong environment", () => {
    expect(polarRedirect("https://sandbox.polar.sh/checkout/test", env)).toContain("sandbox.polar.sh");
    for (const url of ["https://evil.invalid", "javascript:alert(1)", "https://polar.sh/checkout/test", "https://sandbox.polar.sh.evil.invalid", "https://user@sandbox.polar.sh/"]) expect(() => polarRedirect(url, env)).toThrow();
  });
  test("auth, suspended accounts, and invalid plans fail before provider access", async () => {
    expect((await handlePolarCheckout(req(), env, { requireUser: async () => ({ res: new Response(null, { status: 401 }) }) })).status).toBe(401);
    expect((await handlePolarCheckout(req(), env, { requireUser: async () => ({ user: { ...user, status: "suspended" } }) })).status).toBe(403);
    expect((await handlePolarCheckout(req({ plan: "lifetime", interval: "monthly" }), env, { requireUser: auth })).status).toBe(400);
    expect(shouldRequireCsrf("POST", "/api/billing/checkout")).toBe(true);
    expect(shouldRequireCsrf("POST", "/api/billing/portal")).toBe(true);
    expect(shouldRequireCsrf("POST", "/api/billing/webhook/polar")).toBe(false);
  });
  test("checkout binds the authenticated account and creates no entitlement", async () => {
    const calls = [], writes = [];
    const response = await handlePolarCheckout(req({ plan: "pro", interval: "monthly", userId: "attacker", success_url: "https://evil.invalid" }), env, {
      requireUser: auth, transaction: fn => fn({ one: async () => null, unsafe: async (...args) => { writes.push(args); } }),
      request: async (_env, path, options) => { calls.push({ path, options }); return path.includes("/state") ? null : path.includes("/products/") ? product : path === "/checkouts/" && !options?.body ? { items: [] } : { url: "https://sandbox.polar.sh/checkout/test", expires_at: "2099-01-01T00:00:00Z" }; },
    });
    expect(response.status).toBe(200);
    const create = calls.find((c) => c.options?.body);
    expect(create.options.body.external_customer_id).toBe(userId);
    expect(create.options.body.success_url).toBe("https://yourrank.site/dashboard/settings/billing?billing=return");
    expect(create.options.body.allow_trial).toBe(false);
    expect(writes.every(([sql]) => !sql.includes("UPDATE users") && !sql.includes("INSERT INTO subscriptions"))).toBe(true);
  });
  test("existing subscribers must use their own customer portal", async () => {
    let creations = 0;
    const response = await handlePolarCheckout(req(), env, { requireUser: auth, transaction: fn => fn({ one: async () => user }), request: async () => ({ ...customer, active_subscriptions: [{}] }) });
    expect(response.status).toBe(409);
    const portal = await handlePolarPortal(req(), env, { requireUser: auth, request: async (_env, path, options) => {
      if (path.includes("/state")) return customer;
      creations++;
      expect(options.body.customer_id).toBe(customer.id);
      return { customer_portal_url: "https://sandbox.polar.sh/portal/test" };
    } });
    expect(portal.status).toBe(200);
    expect(creations).toBe(1);
  });
  test("reuses an unexpired checkout instead of creating duplicates", async () => {
    const response = await handlePolarCheckout(req(), env, {
      requireUser: auth,
      transaction: fn => fn({ one: async sql => sql.includes("polar_accounts") ? { checkout_url: "https://sandbox.polar.sh/checkout/pending", checkout_plan: "pro", checkout_interval: "monthly" } : user }),
      request: async (_env, path) => { expect(path).toContain("/state"); return null; },
    });
    expect((await response.json()).url).toContain("pending");
  });
  test("uncertain checkout reservation prevents a second provider creation", async () => {
    let creations = 0;
    const response = await handlePolarCheckout(req(), env, {
      requireUser: auth,
      transaction: fn => fn({ one: async sql => sql.includes("polar_accounts") ? { checkout_attempt_id: userId } : user }),
      request: async (_env, path) => { if (path.includes("checkouts")) creations++; return null; },
    });
    expect(response.status).toBe(409);
    expect(creations).toBe(0);
  });
  test("provider errors are bounded, not retried, and do not leak provider data", async () => {
    let calls = 0;
    await expect(polarRequest(env, "/checkouts/", { body: {}, fetchFn: async (_url, init) => { calls++; expect(init.signal).toBeDefined(); return new Response("private-provider-error", { status: 503 }); } })).rejects.toThrow("Polar request failed (503).");
    expect(calls).toBe(1);
  });
  test("validates both secret derivations and rejects tampering, missing headers, stale and future deliveries", async () => {
    const event = { type: "customer.state_changed", data: customer };
    const request = await signedRequest(event);
    const raw = await request.text();
    expect(await verifyPolarWebhook(raw, request.headers, secret)).toEqual(event);
    const rawSigned = await signedRequest(event, { keyForm: "raw" });
    expect(await verifyPolarWebhook(await rawSigned.text(), rawSigned.headers, secret)).toEqual(event);
    await expect(verifyPolarWebhook(raw + " ", request.headers, secret)).rejects.toThrow();
    await expect(verifyPolarWebhook(raw, new Headers(), secret)).rejects.toThrow();
    const forged = await signedRequest(event, { signingSecret: `whsec_${btoa("wrong-test-signature-key-32bytes!!")}` });
    expect((await handlePolarWebhook(forged, env)).status).toBe(403);
    for (const delta of [-600, 600]) {
      const expired = await signedRequest(event, { timestamp: Math.floor(Date.now() / 1000) + delta });
      expect((await handlePolarWebhook(expired, env)).status).toBe(403);
    }
  });
  test("invalid signature cannot reach storage; duplicate deliveries do not repeat work", async () => {
    expect((await handlePolarWebhook(req(), env, { transaction: () => { throw new Error("must not run"); } })).status).toBe(403);
    const response = await handlePolarWebhook(await signedRequest({ type: "customer.state_changed", data: customer }), env, { transaction: fn => fn({ one: async () => ({ id: userId }) }), request: () => { throw new Error("duplicate must not fetch"); } });
    expect(response.status).toBe(200);
  });
});

// Mocked-API lifecycle: tx records writes; request fakes the Polar reads.
const subOf = (patch) => ({ id: crypto.randomUUID(), product_id: productId, status: "active", current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(), cancel_at_period_end: false, ...patch });
const syncFixture = ({ customerState = customer, remoteSubs = [], entitlement = null } = {}) => {
  const writes = [];
  const tx = {
    one: async (q) => (q.includes("FOR UPDATE") ? { id: userId } : q.includes("polar_webhook_events") ? null : q.includes("plan, current_period_end") ? entitlement : null),
    unsafe: async (q, args) => { writes.push([q, args]); return []; },
  };
  const request = async (_e, path) => {
    if (path.includes("/state")) return customerState;
    if (path.startsWith("/subscriptions")) return { items: remoteSubs.map((s) => ({ customer: { external_id: userId }, ...s })), pagination: { max_page: 1 } };
    return null;
  };
  return { tx, writes, request };
};
const insertFor = (writes, status) => writes.find(([q]) => q.includes("INSERT INTO subscriptions") && q.includes(`'${status}'`));

describe("Polar lifecycle (mocked API)", () => {
  test("past_due keeps the confirmed period plus grace, never Polar's advanced period", async () => {
    const env7 = { ...env, POLAR_PAST_DUE_GRACE_DAYS: "7" };
    const remote = subOf({ status: "past_due", current_period_end: new Date(Date.now() + 60 * 86400000).toISOString() });
    const { tx, writes, request } = syncFixture({ remoteSubs: [remote] });
    await syncPolarCustomer(tx, env7, userId, request);
    const write = insertFor(writes, "past_due");
    expect(write).toBeDefined();
    expect(write[0]).toContain("COALESCE(subscriptions.past_due_since, now())");
    expect(write[0]).toContain("GREATEST(");
    expect(write[1]).toEqual([userId, "pro", 7, remote.id, false, "monthly", null, null, null]);
    // The grace end is anchored in SQL — no JS-computed timestamp may be bound.
    expect(write[1].some((p) => typeof p === "string" && Number.isFinite(Date.parse(p)))).toBe(false);
    const active = syncFixture({ remoteSubs: [subOf({})] });
    await syncPolarCustomer(active.tx, env, userId, active.request);
    const activeWrite = active.writes.find(([q]) => q.includes("INSERT INTO subscriptions") && !q.includes("'past_due'"));
    expect(activeWrite[0]).toContain("past_due_since=NULL");
  });
  test("active and trialing upsert; canceled/paused/unpaid leave no access", async () => {
    const { tx, writes, request } = syncFixture({ remoteSubs: [subOf({}), subOf({ status: "trialing" }), subOf({ status: "canceled" }), subOf({ status: "paused" }), subOf({ status: "unpaid" })] });
    await syncPolarCustomer(tx, env, userId, request);
    expect(insertFor(writes, "past_due")).toBeUndefined();
    expect(writes.filter(([q]) => q.includes("INSERT INTO subscriptions")).length).toBe(2);
    expect(writes[0][0]).toContain("status='canceled'");
  });
  test("unmapped products are ignored; missing customer revokes without crash and skips the account upsert", async () => {
    const unmapped = subOf({ product_id: crypto.randomUUID() });
    let f = syncFixture({ remoteSubs: [unmapped] });
    await syncPolarCustomer(f.tx, env, userId, f.request);
    expect(f.writes.filter(([q]) => q.includes("INSERT INTO subscriptions")).length).toBe(0);
    f = syncFixture({ customerState: null });
    await expect(syncPolarCustomer(f.tx, env, userId, f.request)).resolves.toBeNull();
    expect(f.writes.some(([q]) => q.includes("polar_accounts"))).toBe(false);
    expect(f.writes[0][0]).toContain("status='canceled'");
  });
  test("webhook resolves subscription.* and customer.deleted payloads; unknown events ignored", async () => {
    const deps = () => {
      const f = syncFixture({});
      return { transaction: (fn) => fn(f.tx), request: f.request, writes: f.writes };
    };
    let d = deps();
    const res = await handlePolarWebhook(await signedRequest({ type: "subscription.updated", data: { customer: { external_id: userId } } }), env, d);
    expect(res.status).toBe(200);
    expect(d.writes.some(([q]) => q.includes("polar_webhook_events"))).toBe(true);
    d = deps();
    expect((await handlePolarWebhook(await signedRequest({ type: "customer.deleted", data: { external_id: userId } }), env, d)).status).toBe(200);
    d = deps();
    expect((await handlePolarWebhook(await signedRequest({ type: "product.updated", data: {} }), env, d)).status).toBe(200);
    expect(d.writes.length).toBe(0);
  });
  test("webhook returns retryable 500 and logs provider status when the token lacks subscriptions:read (Sandbox 2026-09-24)", async () => {
    // Real staging failure: customer state succeeded, then GET /subscriptions/ answered 403 insufficient_scope.
    const scopeError = new PolarRequestError(403, { error: "insufficient_scope", error_description: "The request requires higher privileges than provided by the access token." });
    const f = syncFixture({});
    const request = async (e, path, options) => { if (path.startsWith("/subscriptions")) throw scopeError; return f.request(e, path, options); };
    const logged = [];
    const original = console.error;
    console.error = (...args) => logged.push(args.join(" "));
    try {
      for (const type of ["subscription.created", "subscription.active", "customer.state_changed"]) {
        const data = type.startsWith("customer.") ? customer : { id: crypto.randomUUID(), customer: { external_id: userId } };
        const res = await handlePolarWebhook(await signedRequest({ type, data }), env, { transaction: (fn) => fn(f.tx), request });
        expect(res.status).toBe(500);
      }
    } finally {
      console.error = original;
    }
    expect(f.writes.some(([q]) => q.includes("UPDATE users") || q.includes("INSERT INTO subscriptions") || q.includes("polar_webhook_events"))).toBe(false);
    expect(logged.filter((l) => l.includes("[polar.webhook]") && l.includes("status=403") && l.includes("insufficient_scope")).length).toBe(3);
    expect(logged.join("\n")).not.toContain(env.POLAR_ACCESS_TOKEN);
  });
  test("environment mismatch and invalid grace fail closed", async () => {
    const stagingEnv = { ...env, ENVIRONMENT: "staging", PUBLIC_BASE_URL: "https://staging.yourrank.site" };
    expect(polarConfig(stagingEnv).ready).toBe(true);
    const mismatch = { ...stagingEnv, POLAR_SERVER: "production" };
    expect(polarConfig(mismatch).ready).toBe(false);
    expect(polarConfig(mismatch).error).toBe("polar_environment_mismatch");
    expect((await handlePolarWebhook(req(), mismatch)).status).toBe(503);
    expect((await handlePolarCheckout(req(), mismatch, { requireUser: auth })).status).toBe(503);
    const prodMismatch = { ...env, ENVIRONMENT: "production", PUBLIC_BASE_URL: "https://staging.yourrank.site", POLAR_SERVER: "production" };
    expect(polarConfig(prodMismatch).ready).toBe(false);
    expect(polarConfig({ ...env, POLAR_PAST_DUE_GRACE_DAYS: "3" }).ready).toBe(false);
    expect(polarConfig({ ...env, POLAR_PAST_DUE_GRACE_DAYS: "21" }).ready).toBe(true);
  });
  test("expired reservation reconciles via the open-checkout list instead of duplicating", async () => {
    const open = { items: [{ product_id: productId, url: "https://sandbox.polar.sh/checkout/open", expires_at: "2099-01-01T00:00:00Z" }] };
    const writes = [];
    const response = await handlePolarCheckout(req(), env, {
      requireUser: auth,
      transaction: (fn) => fn({ one: async (q) => (q.includes("polar_accounts") ? null : user), unsafe: async (...a) => { writes.push(a); } }),
      request: async (_e, path, o) => (path.includes("/state") ? customer : path.includes("/products/") ? product : path === "/checkouts/" && !o?.body ? open : null),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).url).toContain("/checkout/open");
  });
  test("definite 4xx clears the reservation; uncertain errors keep it", async () => {
    const run = async (fail) => {
      const writes = [];
      const tx = () => ({ one: async (q) => (q.includes("polar_accounts") ? null : user), unsafe: async (...a) => { writes.push(a); } });
      const response = await handlePolarCheckout(req(), env, {
        requireUser: auth, transaction: (fn) => fn(tx()),
        request: async (_e, path, o) => (path.includes("/state") ? customer : path.includes("/products/") ? product : path === "/checkouts/" && !o?.body ? { items: [] } : Promise.reject(fail)),
      });
      return { response, writes };
    };
    let r = await run(new Error("Polar request failed (400)."));
    expect(r.response.status).toBe(502);
    expect(r.writes.some(([q]) => q.includes("checkout_attempt_id=NULL"))).toBe(true);
    r = await run(new Error("Polar request failed (500)."));
    expect(r.response.status).toBe(502);
    expect(r.writes.some(([q]) => q.includes("checkout_attempt_id=NULL"))).toBe(false);
    r = await run(new Error("network unreachable"));
    expect(r.writes.some(([q]) => q.includes("checkout_attempt_id=NULL"))).toBe(false);
  });
  test("partial refund stays confirmed; full refund marks refunded", async () => {
    const run = async (refunded_amount) => {
      const order = { id: crypto.randomUUID(), customer: { external_id: userId, organization_id: orgId }, product_id: productId, paid: true, total_amount: 2400, currency: "usd", refunded_amount };
      const f = syncFixture({});
      await handlePolarWebhook(await signedRequest({ type: "order.refunded", data: { id: order.id, customer: { external_id: userId } } }), env, {
        transaction: (fn) => fn(f.tx),
        request: async (_e, path, o) => (path.includes("/orders/") ? order : f.request(_e, path, o)),
      });
      return f.writes.find(([q]) => q.includes("INSERT INTO payments"))?.[1]?.[3];
    };
    expect(await run(1200)).toBe("confirmed");
    expect(await run(2400)).toBe("refunded");
  });
});

// Real SQL lifecycle check, opt-in to an isolated local database only.
const dbUrl = process.env.POLAR_TEST_DATABASE_URL;
test.skipIf(!dbUrl)("SQL: paid activation, duplicate, past_due grace, renewal, cancellation, revocation, preserved grant, rollback", async () => {
  const target = new URL(dbUrl);
  if (!["localhost", "127.0.0.1"].includes(target.hostname) || !/^\/(yourrank_test|yourrank_ui_test_)/.test(target.pathname)) throw new Error("Polar SQL tests require an isolated localhost test database.");
  const { default: postgres } = await import("postgres");
  const db = postgres(dbUrl, { max: 2 });
  const fixtureId = crypto.randomUUID();
  const subscriptionId = crypto.randomUUID();
  const env7 = { ...env, POLAR_PAST_DUE_GRACE_DAYS: "7" };
  let remoteCustomer = { ...customer, external_id: fixtureId, id: crypto.randomUUID() };
  let subs = [];
  const end = new Date(Date.now() + 30 * 86400000).toISOString();
  const transaction = fn => db.begin(sql => fn({ one: async (q, args) => (await sql.unsafe(q, args))[0], unsafe: (q, args) => sql.unsafe(q, args) }));
  const request = async (_env, path) => {
    if (path.includes("/state")) return remoteCustomer ? { ...remoteCustomer, active_subscriptions: subs.filter((s) => ["active", "trialing"].includes(s.status)) } : null;
    if (path.startsWith("/subscriptions")) return { items: subs.map((s) => ({ ...s, customer: { external_id: fixtureId } })), pagination: { max_page: 1, total_count: subs.length } };
    return null;
  };
  const deps = { transaction, request };
  const send = async (id = crypto.randomUUID()) => handlePolarWebhook(await signedRequest({ type: "customer.state_changed", data: { external_id: fixtureId } }, { id }), env7, deps);
  try {
    await db.unsafe("INSERT INTO users(id,email) VALUES ($1,$2)", [fixtureId, `${fixtureId}@example.invalid`]);
    subs = [{ id: subscriptionId, product_id: productId, status: "active", current_period_end: end, cancel_at_period_end: false }];
    const eventId = crypto.randomUUID();
    expect((await send(eventId)).status).toBe(200);
    expect((await send(eventId)).status).toBe(200);
    expect((await db.unsafe("SELECT plan FROM users WHERE id=$1", [fixtureId]))[0].plan).toBe("pro");
    expect((await db.unsafe("SELECT count(*)::int n FROM subscriptions WHERE user_id=$1", [fixtureId]))[0].n).toBe(1);
    // Failed renewal: Polar advances the period into the unpaid one; we keep the
    // confirmed period, extended only by the 7-day grace from the first locally
    // observed past_due transition (shorter than the confirmed period here).
    subs[0].status = "past_due";
    subs[0].current_period_end = new Date(Date.now() + 60 * 86400000).toISOString();
    expect((await send()).status).toBe(200);
    const polarSub = (await db.unsafe("SELECT status, past_due_since FROM subscriptions WHERE user_id=$1 AND provider='polar'", [fixtureId]))[0];
    expect(polarSub.status).toBe("past_due");
    expect(polarSub.past_due_since).not.toBeNull();
    expect(new Date((await db.unsafe("SELECT plan_expires_at FROM users WHERE id=$1", [fixtureId]))[0].plan_expires_at).toISOString()).toBe(end);
    subs[0].status = "active";
    subs[0].current_period_end = new Date(Date.now() + 60 * 86400000).toISOString();
    expect((await send()).status).toBe(200);
    subs[0].cancel_at_period_end = true;
    expect((await send()).status).toBe(200);
    expect((await db.unsafe("SELECT plan FROM users WHERE id=$1", [fixtureId]))[0].plan).toBe("pro");
    const orderId = crypto.randomUUID();
    const order = { id: orderId, customer: { external_id: fixtureId, organization_id: orgId }, product_id: productId, paid: true, total_amount: 2400, currency: "usd", refunded_amount: 0 };
    const orderDeps = { transaction, request: async (_env, path) => path.includes("/orders/") ? order : request(_env, path) };
    const pay = async type => handlePolarWebhook(await signedRequest({ type, data: { id: orderId, customer: { external_id: fixtureId } } }), env7, orderDeps);
    expect((await pay("order.paid")).status).toBe(200);
    expect((await pay("order.paid")).status).toBe(200);
    expect((await db.unsafe("SELECT count(*)::int n FROM payments WHERE user_id=$1", [fixtureId]))[0].n).toBe(1);
    order.refunded_amount = 1200;
    expect((await pay("order.refunded")).status).toBe(200);
    expect((await db.unsafe("SELECT status FROM payments WHERE user_id=$1", [fixtureId]))[0].status).toBe("confirmed");
    order.refunded_amount = 2400;
    expect((await pay("order.refunded")).status).toBe(200);
    expect((await db.unsafe("SELECT status FROM payments WHERE user_id=$1", [fixtureId]))[0].status).toBe("refunded");
    subs = [];
    expect((await send()).status).toBe(200);
    expect((await db.unsafe("SELECT plan FROM users WHERE id=$1", [fixtureId]))[0].plan).toBe("free");
    await db.unsafe("INSERT INTO subscriptions(user_id,plan,status,provider,current_period_end) VALUES ($1,'team','active','manual',$2)", [fixtureId,end]);
    expect((await send()).status).toBe(200);
    expect((await db.unsafe("SELECT plan FROM users WHERE id=$1", [fixtureId]))[0].plan).toBe("team");
    remoteCustomer = { ...remoteCustomer, organization_id: userId };
    const failedId = crypto.randomUUID();
    expect((await send(failedId)).status).toBe(500);
    expect((await db.unsafe("SELECT id FROM app_private.polar_webhook_events WHERE id=$1", [failedId])).length).toBe(0);
    expect((await db.unsafe("SELECT plan FROM users WHERE id=$1", [fixtureId]))[0].plan).toBe("team");
  } finally {
    await db.unsafe("DELETE FROM app_private.polar_webhook_events WHERE user_id=$1", [fixtureId]);
    await db.unsafe("DELETE FROM users WHERE id=$1", [fixtureId]);
    await db.end();
  }
}, 20000);

test.skipIf(!dbUrl)("SQL: repeated past_due reconciliation never extends the grace window", async () => {
  const target = new URL(dbUrl);
  if (!["localhost", "127.0.0.1"].includes(target.hostname) || !/^\/(yourrank_test|yourrank_ui_test_)/.test(target.pathname)) throw new Error("Polar SQL tests require an isolated localhost test database.");
  const { default: postgres } = await import("postgres");
  const db = postgres(dbUrl, { max: 2 });
  const fixtureId = crypto.randomUUID();
  const subscriptionId = crypto.randomUUID();
  const env7 = { ...env, POLAR_PAST_DUE_GRACE_DAYS: "7" };
  const remoteCustomer = { ...customer, external_id: fixtureId, id: crypto.randomUUID() };
  let subs = [];
  const transaction = fn => db.begin(sql => fn({ one: async (q, args) => (await sql.unsafe(q, args))[0], unsafe: (q, args) => sql.unsafe(q, args) }));
  const request = async (_env, path) => {
    if (path.includes("/state")) return { ...remoteCustomer, active_subscriptions: subs.filter((s) => ["active", "trialing"].includes(s.status)) };
    if (path.startsWith("/subscriptions")) return { items: subs.map((s) => ({ ...s, customer: { external_id: fixtureId } })), pagination: { max_page: 1, total_count: subs.length } };
    return null;
  };
  const deps = { transaction, request };
  const send = async (id = crypto.randomUUID()) => handlePolarWebhook(await signedRequest({ type: "customer.state_changed", data: { external_id: fixtureId } }, { id }), env7, deps);
  const sub = async () => (await db.unsafe("SELECT status, current_period_end, past_due_since FROM subscriptions WHERE provider_subscription_id=$1", [subscriptionId]))[0];
  const usr = async () => (await db.unsafe("SELECT plan, plan_expires_at FROM users WHERE id=$1", [fixtureId]))[0];
  try {
    await db.unsafe("INSERT INTO users(id,email) VALUES ($1,$2)", [fixtureId, `${fixtureId}@example.invalid`]);
    // An already-expired paid period grants nothing (current_period_end > now required).
    subs = [{ id: subscriptionId, product_id: productId, status: "active", current_period_end: new Date(Date.now() - 3600000).toISOString(), cancel_at_period_end: false }];
    expect((await send()).status).toBe(200);
    expect((await usr()).plan).toBe("free");
    // First past_due observation anchors the grace window.
    subs[0].status = "past_due";
    subs[0].current_period_end = new Date(Date.now() + 30 * 86400000).toISOString();
    const eventA = crypto.randomUUID();
    expect((await send(eventA)).status).toBe(200);
    let s = await sub();
    const E1 = new Date(s.current_period_end).getTime();
    const P1 = new Date(s.past_due_since).getTime();
    expect(Number.isFinite(P1)).toBe(true);
    expect((await db.unsafe("SELECT (current_period_end = past_due_since + interval '7 days') ok FROM subscriptions WHERE provider_subscription_id=$1", [subscriptionId]))[0].ok).toBe(true);
    let u = await usr();
    expect(u.plan).toBe("pro");
    expect(new Date(u.plan_expires_at).getTime()).toBe(E1);
    expect(E1 - Date.now()).toBeGreaterThan(7 * 86400000 - 60000);
    expect(E1 - Date.now()).toBeLessThan(7 * 86400000 + 60000);
    // Duplicate delivery, a fresh event while still past_due, and manual
    // reconciliation must all leave the anchored window untouched.
    expect((await send(eventA)).status).toBe(200);
    expect((await send()).status).toBe(200);
    await transaction((tx) => syncPolarCustomer(tx, env7, fixtureId, request));
    s = await sub();
    expect(new Date(s.current_period_end).getTime()).toBe(E1);
    expect(new Date(s.past_due_since).getTime()).toBe(P1);
    // Time passage: backdate the anchor as if 3 days elapsed; Polar keeps
    // advancing its own period (now +90d). Re-syncs must not re-anchor.
    await db.unsafe("UPDATE subscriptions SET past_due_since = past_due_since - interval '3 days', current_period_end = current_period_end - interval '3 days' WHERE provider_subscription_id=$1", [subscriptionId]);
    subs[0].current_period_end = new Date(Date.now() + 90 * 86400000).toISOString();
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    s = await sub();
    const E2 = new Date(s.current_period_end).getTime();
    const P2 = new Date(s.past_due_since).getTime();
    expect(E2).toBe(P2 + 7 * 86400000);
    // Anchored to 3 days ago: ≈ now+4d. Old code would re-anchor to ≈ now+7d.
    expect(E2).toBeLessThan(Date.now() + 5 * 86400000);
    expect(new Date((await usr()).plan_expires_at).getTime()).toBe(E2);
    // Recovery clears the anchor and takes Polar's confirmed period.
    subs[0].status = "active";
    const end60 = new Date(Date.now() + 60 * 86400000).toISOString();
    subs[0].current_period_end = end60;
    expect((await send()).status).toBe(200);
    s = await sub();
    expect(s.past_due_since).toBeNull();
    expect(new Date(s.current_period_end).toISOString()).toBe(end60);
    expect((await usr()).plan).toBe("pro");
    // A later past_due starts a fresh window; the confirmed period still wins.
    subs[0].status = "past_due";
    expect((await send()).status).toBe(200);
    s = await sub();
    expect(s.past_due_since).not.toBeNull();
    expect(new Date(s.past_due_since).getTime()).toBeGreaterThan(P1);
    expect(new Date(s.current_period_end).toISOString()).toBe(end60);
    // Unpaid then canceled revoke access entirely.
    subs[0].status = "unpaid";
    expect((await send()).status).toBe(200);
    u = await usr();
    expect(u.plan).toBe("free");
    expect(u.plan_expires_at).toBeNull();
    subs[0].status = "canceled";
    expect((await send()).status).toBe(200);
    expect((await usr()).plan).toBe("free");
  } finally {
    await db.unsafe("DELETE FROM app_private.polar_webhook_events WHERE user_id=$1", [fixtureId]);
    await db.unsafe("DELETE FROM users WHERE id=$1", [fixtureId]);
    await db.end();
  }
}, 20000);
