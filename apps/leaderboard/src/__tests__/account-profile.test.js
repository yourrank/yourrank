import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { handleAccountProfile } from "../handlers/account.js";
import { shouldRequireCsrf } from "../middleware/csrf.js";

const REPO_ROOT = path.resolve(import.meta.dir, "../../../..");
const routesSource = readFileSync(path.join(REPO_ROOT, "apps/leaderboard/src/routes.js"), "utf8");
const USER_ID = "00000000-0000-4000-8000-000000000001";
const request = (displayName) => new Request("https://yourrank.site/api/account/profile", {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ displayName }),
});

function fixture({ auth = { user: { id: USER_ID }, res: null } } = {}) {
  const calls = [];
  const audits = [];
  const deps = {
    requireUserImpl: async () => auth,
    queryImpl: async (sql, params) => { calls.push({ sql, params }); return []; },
    logAuditImpl: async (entry) => audits.push(entry),
  };
  return { calls, audits, deps };
}

describe("PATCH /api/account/profile", () => {
  test("rejects an empty name", async () => {
    const f = fixture();

    const response = await handleAccountProfile(request("   "), {}, f.deps);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Enter a name." });
    expect(f.calls).toHaveLength(0);
  });

  test("rejects names over 40 characters", async () => {
    const f = fixture();

    const response = await handleAccountProfile(request("A".repeat(41)), {}, f.deps);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Use 40 characters or fewer." });
    expect(f.calls).toHaveLength(0);
  });

  test("accepts a name of exactly 40 characters", async () => {
    const f = fixture();
    const displayName = "A".repeat(40);

    const response = await handleAccountProfile(request(displayName), {}, f.deps);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, displayName });
    expect(f.calls[0].params).toEqual([displayName, USER_ID]);
  });

  test("rejects control characters", async () => {
    const f = fixture();

    const response = await handleAccountProfile(request("Name\u0007Here"), {}, f.deps);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Name cannot contain control characters." });
    expect(f.calls).toHaveLength(0);
  });

  test("normalizes, updates, and audits the account name", async () => {
    const f = fixture();

    const response = await handleAccountProfile(request("  Atlas   Owner  "), {}, f.deps);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, displayName: "Atlas Owner" });
    expect(f.calls).toEqual([{
      sql: "UPDATE users SET display_name=$1, updated_at=now() WHERE id=$2",
      params: ["Atlas Owner", USER_ID],
    }]);
    expect(f.audits).toEqual([expect.objectContaining({
      actorId: USER_ID,
      action: "account.profile_updated",
      entityType: "user",
      entityId: USER_ID,
      details: { display_name: "Atlas Owner" },
    })]);
  });

  test("returns the unauthenticated response without querying", async () => {
    const unauthorized = new Response(JSON.stringify({ ok: false, error: "auth" }), { status: 401 });
    const f = fixture({ auth: { user: null, res: unauthorized } });

    const response = await handleAccountProfile(request("Atlas Owner"), {}, f.deps);

    expect(response).toBe(unauthorized);
    expect(f.calls).toHaveLength(0);
    expect(f.audits).toHaveLength(0);
  });

  test("registers the CSRF-protected profile route", () => {
    expect(routesSource).toContain(
      '{ path: "/api/account/profile", method: "PATCH", handler: withHandler(handleAccountProfile) }',
    );
    expect(shouldRequireCsrf("PATCH", "/api/account/profile")).toBe(true);
  });
});
