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
