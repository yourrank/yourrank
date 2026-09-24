import { describe, test, expect } from "bun:test";
import { planChangeFor, subscriptionKey, formatPlanPrice } from "@yourrank/shared/plan-changes";
import { PolarRequestError } from "../polar.js";
import { handlePolarPlanChange, syncPolarCustomer, getPolarBillingStatus } from "../handlers/polar-billing.js";
import { shouldRequireCsrf } from "../middleware/csrf.js";

const userId = "00000000-0000-4000-8000-000000000001";
const orgId = "00000000-0000-4000-8000-000000000003";
const P = {
  pro_monthly: "00000000-0000-4000-8000-000000000011",
  pro_annual: "00000000-0000-4000-8000-000000000012",
  team_monthly: "00000000-0000-4000-8000-000000000013",
  team_annual: "00000000-0000-4000-8000-000000000014",
};
const env = {
  POLAR_SERVER: "sandbox", POLAR_ACCESS_TOKEN: "test-token", POLAR_WEBHOOK_SECRET: `whsec_${btoa("local-test-signature-key-32-bytes!")}`, POLAR_ORGANIZATION_ID: orgId,
  POLAR_PRODUCT_PRO_MONTHLY: P.pro_monthly, POLAR_PRODUCT_PRO_ANNUAL: P.pro_annual, POLAR_PRODUCT_TEAM_MONTHLY: P.team_monthly, POLAR_PRODUCT_TEAM_ANNUAL: P.team_annual,
};
const user = { id: userId, email: "test@example.invalid", status: "active" };
const customer = { id: "00000000-0000-4000-8000-000000000004", external_id: userId, organization_id: orgId, active_subscriptions: [] };
const priceFor = { [P.pro_monthly]: [2400, "month"], [P.pro_annual]: [24000, "year"], [P.team_monthly]: [6900, "month"], [P.team_annual]: [69000, "year"] };
const productOf = (id) => ({ id, organization_id: orgId, is_archived: false, is_recurring: true, recurring_interval: priceFor[id][1], prices: [{ amount_type: "fixed", price_currency: "usd", price_amount: priceFor[id][0] }] });
const periodEnd = new Date(Date.now() + 30 * 86400000).toISOString();
const subOf = (key, patch = {}) => ({ id: crypto.randomUUID(), product_id: P[key], status: "active", current_period_end: periodEnd, cancel_at_period_end: false, pending_update: null, customer_id: customer.id, customer: { external_id: userId }, ...patch });
const req = (body) => new Request("https://yourrank.site/api/billing/change", { method: "POST", body: JSON.stringify(body) });
const auth = async () => ({ user });

/** Mocked Polar: records every PATCH, serves list/state/product reads, and lets a test inject failures. */
function fixture({ subs = [], customerState = customer, patchError = null, onPatch = null, entitlement = null } = {}) {
  const patches = [], writes = [], reads = [];
  const tx = {
    one: async (q) => (q.includes("FOR UPDATE") ? { id: userId } : q.includes("plan, current_period_end") ? entitlement : null),
    unsafe: async (q, args) => { writes.push([q, args]); return []; },
  };
  const request = async (_e, path, options = {}) => {
    reads.push(path);
    if (options.method === "PATCH") {
      patches.push({ path, body: options.body });
      if (patchError) throw patchError;
      if (onPatch) onPatch(options.body);
      return {};
    }
    if (path.includes("/state")) return customerState;
    if (path.startsWith("/subscriptions/")) return { items: subs, pagination: { max_page: 1 } };
    if (path.startsWith("/products/")) return productOf(path.slice("/products/".length));
    return null;
  };
  const deps = { requireUser: auth, transaction: (fn) => fn(tx), request, logAudit: async () => {}, one: async () => null };
  return { deps, patches, writes, reads, tx, request };
}

describe("plan change matrix (shared)", () => {
  const cases = [
    ["pro_monthly", "pro_annual", "switch_annual", "invoice", "immediate"],
    ["pro_annual", "pro_monthly", "switch_monthly", "next_period", "period_end"],
    ["team_monthly", "team_annual", "switch_annual", "invoice", "immediate"],
    ["team_annual", "team_monthly", "switch_monthly", "next_period", "period_end"],
    ["pro_monthly", "team_monthly", "upgrade", "invoice", "immediate"],
    ["pro_annual", "team_annual", "upgrade", "invoice", "immediate"],
    ["pro_monthly", "team_annual", "upgrade", "invoice", "immediate"],
    ["pro_annual", "team_monthly", "upgrade", "invoice", "immediate"],
    ["team_monthly", "pro_monthly", "downgrade", "next_period", "period_end"],
    ["team_annual", "pro_annual", "downgrade", "next_period", "period_end"],
    ["team_annual", "pro_monthly", "downgrade", "next_period", "period_end"],
    ["team_monthly", "pro_annual", "downgrade", "next_period", "period_end"],
  ];
  const split = (key) => { const [plan, interval] = key.split("_"); return { plan, interval }; };
  test.each(cases)("%s → %s is %s (%s)", (from, to, kind, proration, timing) => {
    const change = planChangeFor(split(from), split(to));
    expect(change.kind).toBe(kind);
    expect(change.proration).toBe(proration);
    expect(change.timing).toBe(timing);
  });
  test("same tier+interval is current, not just same tier; free is period-end cancel", () => {
    expect(planChangeFor(split("team_monthly"), split("team_monthly")).kind).toBe("current");
    expect(planChangeFor(split("team_monthly"), split("team_annual")).kind).not.toBe("current");
    expect(planChangeFor(split("team_monthly"), { plan: "free", interval: "annual" })).toMatchObject({ kind: "cancel", timing: "period_end", proration: null });
    expect(planChangeFor({ ...split("team_monthly"), pending: split("pro_monthly") }, split("pro_monthly")).kind).toBe("pending");
    expect(subscriptionKey("team", "annual")).toBe("team_annual");
    expect(subscriptionKey("free", "annual")).toBe("free");
  });
  test("labels are concrete actions and annual prices show total plus monthly equivalent", () => {
    expect(planChangeFor(split("pro_monthly"), split("team_monthly")).label).toBe("Upgrade to Team");
    expect(planChangeFor(split("team_monthly"), split("pro_monthly")).label).toBe("Downgrade to Pro");
    expect(planChangeFor(split("pro_monthly"), split("pro_annual")).label).toBe("Switch to annual");
    expect(planChangeFor(split("pro_annual"), split("pro_monthly")).label).toBe("Switch to monthly");
    expect(formatPlanPrice("pro", "monthly")).toBe("$24/month");
    expect(formatPlanPrice("pro", "annual")).toBe("$240/year ($20/mo)");
    expect(formatPlanPrice("team", "annual")).toBe("$690/year ($57.50/mo)");
    expect(formatPlanPrice("free", "annual")).toBe("$0");
  });
});

describe("POST /api/billing/change (mocked Polar)", () => {
  test("requires auth, CSRF, an active account, and a semantic destination", async () => {
    expect(shouldRequireCsrf("POST", "/api/billing/change")).toBe(true);
    expect((await handlePolarPlanChange(req({ plan: "team", interval: "monthly" }), env, { requireUser: async () => ({ res: new Response(null, { status: 401 }) }) })).status).toBe(401);
    expect((await handlePolarPlanChange(req({ plan: "team", interval: "monthly" }), env, { requireUser: async () => ({ user: { ...user, status: "suspended" } }) })).status).toBe(403);
    for (const body of [{ plan: "team" }, { plan: "enterprise", interval: "monthly" }, { plan: "pro", interval: "weekly" }, { product_id: P.team_annual }, null]) {
      const f = fixture({ subs: [subOf("pro_monthly")] });
      expect((await handlePolarPlanChange(req(body), env, f.deps)).status).toBe(400);
      expect(f.reads.length).toBe(0);
    }
    expect((await handlePolarPlanChange(req({ plan: "team", interval: "monthly" }), {}, { requireUser: auth })).status).toBe(503);
  });

  test("upgrade patches the server-owned product with invoice proration; frontend product IDs and prices are ignored", async () => {
    const sub = subOf("pro_monthly");
    const f = fixture({ subs: [sub] });
    const res = await handlePolarPlanChange(req({ plan: "team", interval: "annual", product_id: "00000000-0000-4000-8000-00000000dead", price: 1 }), env, f.deps);
    expect(res.status).toBe(200);
    expect(f.patches).toEqual([{ path: `/subscriptions/${sub.id}`, body: { product_id: P.team_annual, proration_behavior: "invoice" } }]);
    const body = await res.json();
    expect(body).toMatchObject({ change: "upgrade", timing: "immediate", applied: true });
    // Destination catalog is validated before the PATCH.
    expect(f.reads.indexOf(`/products/${P.team_annual}`)).toBeLessThan(f.reads.indexOf(`/subscriptions/${sub.id}`));
  });

  test("downgrade and annual→monthly schedule for next period; monthly→annual is immediate", async () => {
    let f = fixture({ subs: [subOf("team_annual")] });
    expect((await handlePolarPlanChange(req({ plan: "pro", interval: "annual" }), env, f.deps)).status).toBe(200);
    expect(f.patches[0].body).toEqual({ product_id: P.pro_annual, proration_behavior: "next_period" });
    f = fixture({ subs: [subOf("team_annual")] });
    expect((await handlePolarPlanChange(req({ plan: "team", interval: "monthly" }), env, f.deps)).status).toBe(200);
    expect(f.patches[0].body).toEqual({ product_id: P.team_monthly, proration_behavior: "next_period" });
    f = fixture({ subs: [subOf("team_monthly")] });
    expect((await handlePolarPlanChange(req({ plan: "team", interval: "annual" }), env, f.deps)).status).toBe(200);
    expect(f.patches[0].body).toEqual({ product_id: P.team_annual, proration_behavior: "invoice" });
  });

  test("paid → free schedules cancellation at period end; never a Free product or revoke", async () => {
    const sub = subOf("team_monthly");
    const f = fixture({ subs: [sub] });
    const res = await handlePolarPlanChange(req({ plan: "free" }), env, f.deps);
    expect(res.status).toBe(200);
    expect(f.patches).toEqual([{ path: `/subscriptions/${sub.id}`, body: { cancel_at_period_end: true } }]);
    expect(f.reads.some((p) => p.includes("/revoke"))).toBe(false);
    // Idempotent: already scheduled → no second PATCH, still 200.
    const again = fixture({ subs: [subOf("team_monthly", { cancel_at_period_end: true })] });
    expect((await handlePolarPlanChange(req({ plan: "free" }), env, again.deps)).status).toBe(200);
    expect(again.patches.length).toBe(0);
  });

  test("keep current plan uncancels or clears a pending update; current plan is a no-op", async () => {
    let f = fixture({ subs: [subOf("team_monthly", { cancel_at_period_end: true })] });
    expect((await handlePolarPlanChange(req({ action: "keep" }), env, f.deps)).status).toBe(200);
    expect(f.patches[0].body).toEqual({ cancel_at_period_end: false });
    f = fixture({ subs: [subOf("team_monthly", { pending_update: { product_id: P.pro_monthly, applies_at: periodEnd } })] });
    expect((await handlePolarPlanChange(req({ action: "keep" }), env, f.deps)).status).toBe(200);
    expect(f.patches[0].body).toEqual({ pending_update: null });
    // Re-selecting the current tier+interval while a change is pending clears it too.
    f = fixture({ subs: [subOf("team_monthly", { pending_update: { product_id: P.pro_monthly, applies_at: periodEnd } })] });
    expect((await handlePolarPlanChange(req({ plan: "team", interval: "monthly" }), env, f.deps)).status).toBe(200);
    expect(f.patches[0].body).toEqual({ pending_update: null });
    f = fixture({ subs: [subOf("team_monthly")] });
    const res = await handlePolarPlanChange(req({ plan: "team", interval: "monthly" }), env, f.deps);
    expect(res.status).toBe(200);
    expect(f.patches.length).toBe(0);
    expect((await res.json()).applied).toBe(false);
  });

  test("refuses plan changes while cancellation is scheduled, with no live subscription, or with duplicates", async () => {
    let f = fixture({ subs: [subOf("pro_monthly", { cancel_at_period_end: true })] });
    expect((await handlePolarPlanChange(req({ plan: "team", interval: "monthly" }), env, f.deps)).status).toBe(409);
    expect(f.patches.length).toBe(0);
    f = fixture({ subs: [] });
    expect((await handlePolarPlanChange(req({ plan: "team", interval: "monthly" }), env, f.deps)).status).toBe(409);
    f = fixture({ customerState: null, subs: [] });
    expect((await handlePolarPlanChange(req({ plan: "team", interval: "monthly" }), env, f.deps)).status).toBe(409);
    f = fixture({ subs: [subOf("pro_monthly", { status: "canceled" })] });
    expect((await handlePolarPlanChange(req({ plan: "team", interval: "monthly" }), env, f.deps)).status).toBe(409);
    f = fixture({ subs: [subOf("pro_monthly"), subOf("team_monthly")] });
    expect((await handlePolarPlanChange(req({ plan: "team", interval: "annual" }), env, f.deps)).status).toBe(409);
    expect(f.patches.length).toBe(0);
    f = fixture({ subs: [subOf("pro_monthly", { status: "past_due" })] });
    expect((await handlePolarPlanChange(req({ plan: "team", interval: "monthly" }), env, f.deps)).status).toBe(409);
    expect(f.patches.length).toBe(0);
  });

  test("cross-customer subscriptions are rejected before any provider write", async () => {
    let f = fixture({ subs: [subOf("pro_monthly", { customer: { external_id: "00000000-0000-4000-8000-00000000beef" } })] });
    expect((await handlePolarPlanChange(req({ plan: "team", interval: "monthly" }), env, f.deps)).status).toBe(502);
    expect(f.patches.length).toBe(0);
    f = fixture({ subs: [subOf("pro_monthly", { customer_id: "00000000-0000-4000-8000-00000000beef" })] });
    expect((await handlePolarPlanChange(req({ plan: "team", interval: "monthly" }), env, f.deps)).status).toBe(502);
    expect(f.patches.length).toBe(0);
    f = fixture({ customerState: { ...customer, organization_id: userId }, subs: [subOf("pro_monthly")] });
    expect((await handlePolarPlanChange(req({ plan: "team", interval: "monthly" }), env, f.deps)).status).toBe(502);
    expect(f.patches.length).toBe(0);
  });

  test("provider failures map to safe responses and never touch entitlements", async () => {
    const expectStatus = async (error, status) => {
      const f = fixture({ subs: [subOf("pro_monthly")], patchError: error });
      const res = await handlePolarPlanChange(req({ plan: "team", interval: "monthly" }), env, f.deps);
      expect(res.status).toBe(status);
      expect(f.writes.some(([q]) => q.includes("UPDATE users") || q.includes("INSERT INTO subscriptions"))).toBe(false);
      return res;
    };
    await expectStatus(new PolarRequestError(402, { error: "PaymentRequired" }), 402);
    await expectStatus(new PolarRequestError(403, { error: "AlreadyCanceledSubscription" }), 409);
    await expectStatus(new PolarRequestError(409, { error: "SubscriptionLocked" }), 409);
    await expectStatus(new PolarRequestError(500, null), 502);
    await expectStatus(Object.assign(new Error("aborted"), { name: "AbortError" }), 502);
  });

  test("PATCH 403 insufficient_scope (real Sandbox shape) is a provider configuration failure, not a scheduled cancellation", async () => {
    const scopeError = new PolarRequestError(403, { error: "insufficient_scope", error_description: "The request requires higher privileges than provided by the access token." });
    const logged = [];
    const original = console.error;
    console.error = (...args) => logged.push(args.join(" "));
    let res, body;
    try {
      const f = fixture({ subs: [subOf("pro_monthly")], patchError: scopeError });
      res = await handlePolarPlanChange(req({ plan: "team", interval: "monthly" }), env, f.deps);
      body = await res.json();
      expect(f.writes.some(([q]) => q.includes("UPDATE users") || q.includes("INSERT INTO subscriptions"))).toBe(false);
    } finally {
      console.error = original;
    }
    expect(res.status).toBe(502);
    expect(body.error).not.toContain("scheduled to cancel");
    expect(logged.some((l) => l.includes("[polar.plan_change]") && l.includes("status=403") && l.includes("insufficient_scope"))).toBe(true);
    expect(logged.join("\n")).not.toContain(env.POLAR_ACCESS_TOKEN);
    for (const detail of [null, {}, { error: "Forbidden" }]) {
      const f = fixture({ subs: [subOf("pro_monthly")], patchError: new PolarRequestError(403, detail) });
      console.error = () => {};
      try { expect((await handlePolarPlanChange(req({ plan: "team", interval: "monthly" }), env, f.deps)).status).toBe(502); } finally { console.error = original; }
    }
  });

  test("a successful change is reconciled from provider state, not from the request", async () => {
    const sub = subOf("pro_monthly");
    // After Polar applies the PATCH, its list reflects the new product; the
    // handler must read that back rather than assume the destination.
    const f = fixture({ subs: [sub], onPatch: (body) => { if (body.product_id) sub.product_id = body.product_id; }, entitlement: { plan: "pro", current_period_end: periodEnd } });
    const res = await handlePolarPlanChange(req({ plan: "team", interval: "monthly" }), env, f.deps);
    expect(res.status).toBe(200);
    const upsert = f.writes.find(([q]) => q.includes("INSERT INTO subscriptions"));
    expect(upsert[1].slice(0, 2)).toEqual([userId, "team"]);
    expect(upsert[1]).toContain("monthly");
    // users.plan is bound from the entitlement query over subscriptions, never from the request body.
    const userWrites = f.writes.filter(([q]) => q.includes("UPDATE users"));
    expect(userWrites.length).toBe(1);
    expect(userWrites[0][1]).toEqual([userId, "pro", periodEnd]);
  });

  test("concurrent requests serialize on the user row lock and the second sees the first's provider state", async () => {
    const sub = subOf("pro_monthly");
    let locked = false, patchesInFlight = 0, maxInFlight = 0;
    const patches = [];
    const gate = { release: null };
    const tx = {
      one: async (q) => {
        if (!q.includes("FOR UPDATE")) return null;
        if (locked) await new Promise((r) => { gate.release = r; });
        locked = true;
        return { id: userId };
      },
      unsafe: async () => [],
    };
    const transaction = async (fn) => { try { return await fn(tx); } finally { locked = false; gate.release?.(); } };
    const request = async (_e, path, options = {}) => {
      if (options.method === "PATCH") {
        patchesInFlight++; maxInFlight = Math.max(maxInFlight, patchesInFlight);
        patches.push(options.body);
        await new Promise((r) => setTimeout(r, 5));
        if (options.body.product_id) sub.product_id = options.body.product_id;
        patchesInFlight--;
        return {};
      }
      if (path.includes("/state")) return customer;
      if (path.startsWith("/subscriptions/")) return { items: [sub], pagination: { max_page: 1 } };
      if (path.startsWith("/products/")) return productOf(path.slice("/products/".length));
      return null;
    };
    const deps = { requireUser: auth, transaction, request, logAudit: async () => {}, one: async () => null };
    const [a, b] = await Promise.all([
      handlePolarPlanChange(req({ plan: "team", interval: "monthly" }), env, deps),
      handlePolarPlanChange(req({ plan: "team", interval: "monthly" }), env, deps),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(maxInFlight).toBe(1);
    expect(patches.length).toBe(1);
    expect((await b.json()).applied).toBe(false);
  });
});

describe("reconciliation caches interval and pending change from Polar", () => {
  const syncFixture = (subs) => {
    const writes = [];
    const tx = { one: async (q) => (q.includes("FOR UPDATE") ? { id: userId } : null), unsafe: async (q, args) => { writes.push([q, args]); return []; } };
    const request = async (_e, path) => (path.includes("/state") ? customer : path.startsWith("/subscriptions") ? { items: subs, pagination: { max_page: 1 } } : null);
    return { tx, writes, request };
  };
  test("pending_update is stored semantically; unknown or malformed pending state is ignored, not fabricated", async () => {
    let f = syncFixture([subOf("team_annual", { pending_update: { product_id: P.pro_monthly, applies_at: periodEnd } })]);
    await syncPolarCustomer(f.tx, env, userId, f.request);
    let upsert = f.writes.find(([q]) => q.includes("INSERT INTO subscriptions"));
    expect(upsert[1].slice(-4)).toEqual(["annual", "pro", "monthly", periodEnd]);
    f = syncFixture([subOf("team_annual", { pending_update: { product_id: crypto.randomUUID(), applies_at: periodEnd } })]);
    await syncPolarCustomer(f.tx, env, userId, f.request);
    upsert = f.writes.find(([q]) => q.includes("INSERT INTO subscriptions"));
    expect(upsert[1].slice(-4)).toEqual(["annual", null, null, null]);
    f = syncFixture([subOf("team_annual", { pending_update: { product_id: P.pro_monthly, applies_at: "soon" } })]);
    await syncPolarCustomer(f.tx, env, userId, f.request);
    expect(f.writes.find(([q]) => q.includes("INSERT INTO subscriptions"))[1].slice(-3)).toEqual([null, null, null]);
  });
  test("reordered and duplicate webhooks converge: every sync reads the current provider state", async () => {
    const sub = subOf("pro_monthly");
    const f = syncFixture([sub]);
    sub.product_id = P.team_monthly; // the upgrade already applied at Polar
    await syncPolarCustomer(f.tx, env, userId, f.request); // "stale" subscription.updated for the old product
    await syncPolarCustomer(f.tx, env, userId, f.request); // duplicate delivery
    const upserts = f.writes.filter(([q]) => q.includes("INSERT INTO subscriptions"));
    expect(upserts.length).toBe(2);
    for (const [, args] of upserts) expect(args.slice(0, 2)).toEqual([userId, "team"]);
  });
  test("billing status exposes exact tier+interval, cancellation, and pending change for the UI", async () => {
    const row = { plan: "team", billing_interval: "monthly", status: "active", current_period_end: periodEnd, cancel_at_period_end: false, pending_plan: "pro", pending_interval: "annual", pending_applies_at: periodEnd };
    const status = await getPolarBillingStatus(env, userId, { one: async (q) => (q.includes("FROM subscriptions") ? row : { customer_id: customer.id }) });
    expect(status.subscription).toEqual({ plan: "team", interval: "monthly", status: "active", current_period_end: periodEnd, cancel_at_period_end: false, pending: { plan: "pro", interval: "annual", applies_at: periodEnd } });
    expect(status.changeAvailable).toBe(true);
    expect(status.message).toContain("Plan change scheduled");
    const legacy = await getPolarBillingStatus(env, userId, { one: async (q) => (q.includes("FROM subscriptions") ? { ...row, billing_interval: null, pending_plan: null, pending_interval: null } : null) });
    expect(legacy.subscription.interval).toBeNull();
    expect(legacy.changeAvailable).toBe(false);
  });
});
