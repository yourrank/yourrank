import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { handleEndPlanAccess } from "../handlers/billing.js";
import { shouldRequireCsrf } from "../middleware/csrf.js";

const REPO_ROOT = path.resolve(import.meta.dir, "../../../..");
const siteSource = readFileSync(
  path.join(REPO_ROOT, "apps/leaderboard/src/assets/dashboard/site.js"),
  "utf8",
);
const routesSource = readFileSync(
  path.join(REPO_ROOT, "apps/leaderboard/src/routes.js"),
  "utf8",
);

const USER_ID = "00000000-0000-4000-8000-000000000001";
const request = new Request("https://yourrank.site/api/billing/end-access", { method: "POST" });

function fixture({ user = { id: USER_ID, status: "active" }, row = null, polarSubscription = null } = {}) {
  const calls = [];
  const audits = [];
  let transactionCalls = 0;
  const tx = {
    async one(sql, params = []) {
      calls.push({ method: "one", sql, params });
      if (sql.includes("FROM users")) return row;
      if (sql.includes("FROM subscriptions")) return polarSubscription;
      return null;
    },
    async unsafe(sql, params = []) {
      calls.push({ method: "unsafe", sql, params });
      return [];
    },
  };
  const deps = {
    requireUserImpl: async () => ({ user }),
    transactionImpl: async (fn) => {
      transactionCalls++;
      return fn(tx);
    },
    logAuditImpl: async (entry) => audits.push(entry),
  };
  return {
    calls,
    audits,
    deps,
    get transactionCalls() { return transactionCalls; },
  };
}

describe("POST /api/billing/end-access", () => {
  test("returns 403 for suspended users without opening a transaction", async () => {
    const f = fixture({ user: { id: USER_ID, status: "suspended" } });

    const response = await handleEndPlanAccess(request, {}, f.deps);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "This account is suspended." });
    expect(f.transactionCalls).toBe(0);
  });

  test.each([
    ["free plan", { id: USER_ID, plan: "free", status: "active", plan_expires_at: null }],
    ["expired Pro grant", { id: USER_ID, plan: "pro", status: "active", plan_expires_at: Date.now() - 1_000 }],
  ])("returns 409 for an effective Free plan (%s) without updates", async (_label, row) => {
    const f = fixture({ row });

    const response = await handleEndPlanAccess(request, {}, f.deps);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "You're already on Free." });
    expect(f.calls.some((call) => call.method === "unsafe")).toBe(false);
  });

  test.each(["active", "past_due"])("refuses a live Polar subscription (%s) without updates", async (status) => {
    const f = fixture({
      row: { id: USER_ID, plan: "pro", status: "active", plan_expires_at: Date.now() + 86_400_000 },
      polarSubscription: { id: "polar-subscription", status },
    });

    const response = await handleEndPlanAccess(request, {}, f.deps);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "Your plan is a Polar subscription. Cancel it from Billing instead.",
    });
    expect(f.calls.some((call) => call.method === "unsafe")).toBe(false);
  });

  test("ends a Pro trial and audits the previous plan after committing", async () => {
    const f = fixture({
      row: { id: USER_ID, plan: "pro", status: "active", plan_expires_at: Date.now() + 86_400_000 },
    });

    const response = await handleEndPlanAccess(request, {}, f.deps);
    const updates = f.calls.filter((call) => call.method === "unsafe");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, plan: "free" });
    expect(updates).toHaveLength(2);
    expect(updates[0].sql).toMatch(/UPDATE users SET plan='free', plan_expires_at=NULL, updated_at=now\(\) WHERE id=\$1/);
    expect(updates[1].sql).toMatch(/UPDATE subscriptions SET status='canceled'[\s\S]*provider <> 'polar'[\s\S]*status IN \('active','trialing'\)/);
    expect(updates.map((call) => call.params)).toEqual([[USER_ID], [USER_ID]]);
    expect(f.audits).toHaveLength(1);
    expect(f.audits[0]).toMatchObject({
      actorId: USER_ID,
      action: "billing.plan_access_ended",
      entityType: "plan",
      entityId: "pro",
      details: { from: "pro" },
      request,
    });
  });

  test("ends a no-expiry Team grant", async () => {
    const f = fixture({
      row: { id: USER_ID, plan: "team", status: "active", plan_expires_at: null },
    });

    const response = await handleEndPlanAccess(request, {}, f.deps);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, plan: "free" });
    expect(f.calls.filter((call) => call.method === "unsafe")).toHaveLength(2);
    expect(f.audits[0]).toMatchObject({ entityId: "team", details: { from: "team" } });
  });

  test("exposes the Free action and registers a CSRF-protected route", () => {
    expect(siteSource).toContain("Switch to Free now");
    expect(siteSource).toContain("/api/billing/end-access");
    expect(routesSource).toContain(
      '{ path: "/api/billing/end-access", method: "POST", handler: withHandler(handleEndPlanAccess) }',
    );
    expect(shouldRequireCsrf("POST", "/api/billing/end-access")).toBe(true);
  });
});
