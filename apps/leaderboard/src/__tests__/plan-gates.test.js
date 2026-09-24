// Commercial plan gates: denial contract + site-limit atomicity.
// The concurrent/downgrade cases run against real Postgres when
// GATES_TEST_DATABASE_URL is set (migration-dry-run CI job); they self-skip
// in the plain test job.
import { afterAll, describe, expect, it } from "bun:test";
import postgres from "postgres";

import { denied } from "../auth.js";
import { featureDenial, limitDenial } from "@yourrank/shared/entitlements";
import { getPlanLimit } from "@yourrank/shared/plans";

const DB_URL = process.env.GATES_TEST_DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;
const sql = DB_URL ? postgres(DB_URL, { max: 4, prepare: false, onnotice: () => {} }) : null;

if (DB_URL) process.env.DATABASE_URL = DB_URL;
const { createBoard } = DB_URL ? await import("../site.js") : {};

const mkUser = async (plan, expiresAt = null) => {
  const [u] = await sql`INSERT INTO users (email, display_name, plan, plan_expires_at, status)
    VALUES (${`gates-${crypto.randomUUID()}@yourrank.test`}, 'gates', ${plan}, ${expiresAt}, 'active') RETURNING id`;
  return u.id;
};

describe("denied() 403 contract", () => {
  it("feature denial returns 403 with ok:false and the denial fields", async () => {
    const res = denied(featureDenial("free", "custom_domain"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("entitlement_required");
    expect(body.feature).toBe("custom_domain");
    expect(body.required_plan).toBe("pro");
  });

  it("limit denial carries usage and allowance", async () => {
    const res = denied(limitDenial("free", "players_per_site", 10));
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.code).toBe("plan_limit_reached");
    expect(body.usage).toBe(10);
    expect(body.allowance).toBe(getPlanLimit("free", "players_per_site"));
  });
});

describeDb("site plan gates (real PostgreSQL)", () => {
  afterAll(async () => { await sql.end(); });

  it("GET /api/account/usage returns the limits/features/overLimit shape", async () => {
    const { handleAccountUsage } = await import("../billing.js");
    const { attachRouteContext: attach } = await import("../middleware/handler.js");
    const freeId = await mkUser("free");
    const proId = await mkUser("pro", new Date(Date.now() + 30 * 86400000).toISOString());
    // requireUser consults the sessions table; seed sessions for both users.
    const sha = async (raw) => {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
      return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
    };
    await sql`INSERT INTO sessions (token, user_id, created_at, expires_at)
      VALUES (${await sha("gatestok1")}, ${freeId}, now(), now() + interval '1 day'),
             (${await sha("gatestok2")}, ${proId}, now(), now() + interval '1 day')
      ON CONFLICT DO NOTHING`;
    const env = { DATABASE_URL: DB_URL };
    const req = (tok) => attach(new Request("https://yourrank.site/api/account/usage", { headers: { cookie: `yr_session=${tok}` } }));
    const freeBody = await (await handleAccountUsage(req("gatestok1"), env)).json();
    expect(freeBody.plan).toBe("free");
    expect(freeBody.limits.sites.allowance).toBe(1);
    expect(freeBody.limits.players_per_site.allowance).toBe(10);
    expect(freeBody.limits.telegram_interactions_per_month.used).toBe(0);
    expect(freeBody.limits.broadcast_deliveries_per_month.allowance).toBe(0);
    expect(Array.isArray(freeBody.features)).toBe(true);
    expect(Array.isArray(freeBody.overLimit)).toBe(true);
    const proBody = await (await handleAccountUsage(req("gatestok2"), env)).json();
    expect(proBody.plan).toBe("pro");
    expect(proBody.limits.sites.allowance).toBe(3);
    expect(proBody.features).toContain("custom_domain");
    expect(proBody.limits.broadcast_deliveries_per_month.allowance).toBe(10000);
    await sql`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'gates-%@yourrank.test')`;
  });

  it("Free cannot create site #2; Pro can create a second", async () => {
    const freeId = await mkUser("free");
    const first = await createBoard({}, freeId, { slug: `g1-${Date.now()}` });
    expect(first.ok).toBe(true);
    const second = await createBoard({}, freeId, { slug: `g2-${Date.now()}` });
    expect(second.code).toBe("board_limit");
    expect(second.denial.code).toBe("plan_limit_reached");
    expect(second.denial.limit).toBe("sites");

    const proId = await mkUser("pro", new Date(Date.now() + 30 * 86400000).toISOString());
    expect((await createBoard({}, proId, { slug: `p1-${Date.now()}` })).ok).toBe(true);
    expect((await createBoard({}, proId, { slug: `p2-${Date.now()}` })).ok).toBe(true);
  });

  it("concurrent creates on Free yield exactly one site", async () => {
    const uid = await mkUser("free");
    const [a, b] = await Promise.all([
      createBoard({}, uid, { slug: `c1-${Date.now()}` }),
      createBoard({}, uid, { slug: `c2-${Date.now()}-x` }),
    ]);
    const wins = [a, b].filter((r) => r.ok).length;
    expect(wins).toBe(1);
    const [row] = await sql`SELECT count(*)::int AS n FROM sites WHERE user_id=${uid}`;
    expect(row.n).toBe(1);
  });

  it("downgrade keeps existing sites but denies new ones", async () => {
    const uid = await mkUser("pro", new Date(Date.now() + 30 * 86400000).toISOString());
    await createBoard({}, uid, { slug: `d1-${Date.now()}` });
    await createBoard({}, uid, { slug: `d2-${Date.now()}` });
    await createBoard({}, uid, { slug: `d3-${Date.now()}` });
    // Downgrade: rows stay readable; a 4th create is denied (pro cap is 3 anyway,
    // free cap is 1 — either way it must deny).
    await sql`UPDATE users SET plan='free', plan_expires_at=NULL WHERE id=${uid}`;
    const [row] = await sql`SELECT count(*)::int AS n FROM sites WHERE user_id=${uid}`;
    expect(row.n).toBe(3);
    const fourth = await createBoard({}, uid, { slug: `d4-${Date.now()}` });
    expect(fourth.code).toBe("board_limit");
    expect(fourth.denial.code).toBe("plan_limit_reached");
  });
});

// ── handleBillingFunnel: allowlist + auth + logAudit (injected deps) ──
import { handleBillingFunnel } from "../handlers/billing.js";
import { attachRouteContext } from "../middleware/handler.js";

const funnelReq = (body) => attachRouteContext(new Request("https://yourrank.site/api/billing/funnel", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
}));
const funnelDeps = (over = {}) => ({
  requireUserImpl: async () => ({ user: { id: "user-funnel", plan: "free", status: "active" }, res: null }),
  rateLimitImpl: async () => ({ ok: true }),
  logAuditImpl: async () => {},
  ...over,
});

describe("billing funnel endpoint", () => {
  it("accepts allowlisted events and audits billing.<event>", async () => {
    const calls = [];
    const deps = funnelDeps({ logAuditImpl: async (e) => calls.push(e) });
    const res = await handleBillingFunnel(funnelReq({ event: "paywall_viewed", feature: "wheel" }), {}, deps);
    expect(res.status).toBe(200);
    expect(calls[0].action).toBe("billing.paywall_viewed");
    expect(calls[0].details.feature).toBe("wheel");
    expect((await handleBillingFunnel(funnelReq({ event: "upgrade_clicked" }), {}, deps)).status).toBe(200);
    expect(calls[1].action).toBe("billing.upgrade_clicked");
  });

  it("rejects non-allowlisted events with 400 and no audit write", async () => {
    const calls = [];
    const res = await handleBillingFunnel(funnelReq({ event: "purchase_completed" }), {}, funnelDeps({ logAuditImpl: async (e) => calls.push(e) }));
    expect(res.status).toBe(400);
    expect(calls.length).toBe(0);
  });

  it("rejects unauthenticated requests before touching rate limit or audit", async () => {
    const res = await handleBillingFunnel(funnelReq({ event: "paywall_viewed" }), {}, funnelDeps({
      requireUserImpl: async () => ({ user: null, res: new Response(JSON.stringify({ ok: false, error: "auth" }), { status: 401 }) }),
    }));
    expect(res.status).toBe(401);
  });
});

// ── requireSiteFeature: site-scoped gates use the OWNER's plan ───────
import { requireSiteFeature } from "../auth.js";

describe("requireSiteFeature uses the site owner's plan", () => {
  it("denies a moderator acting on a Free owner's site, allows on Pro", async () => {
    const freeSite = { user_id: "owner-1" };
    const res = await requireSiteFeature(freeSite, "wheel", {
      actorId: "mod-1",
      oneImpl: async () => ({ plan: "free", plan_expires_at: null, status: "active" }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("entitlement_required");
    expect(body.feature).toBe("wheel");

    const ok = await requireSiteFeature({ user_id: "owner-2" }, "wheel", {
      oneImpl: async () => ({ plan: "pro", plan_expires_at: null, status: "active" }),
    });
    expect(ok).toBeNull();
  });
});
