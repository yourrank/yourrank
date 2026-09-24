// Real-Postgres proof of account_usage_meters: monthly period keying, the
// atomic bounded increment under concurrency, and the allowance-0 path.
// Skips when USAGE_TEST_DATABASE_URL is unset (plain `bun test` job).
import { describe, expect, it, afterAll } from "bun:test";
import postgres from "postgres";

const DB_URL = process.env.USAGE_TEST_DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;
const sql = DB_URL ? postgres(DB_URL, { max: 8, onnotice: () => {} }) : (null as never);

let tryConsumeUsage: typeof import("../usage-meters.js").tryConsumeUsage;
let recordUsage: typeof import("../usage-meters.js").recordUsage;
let getUsage: typeof import("../usage-meters.js").getUsage;
let getUsageSummary: typeof import("../usage-meters.js").getUsageSummary;

if (DB_URL) {
  process.env.DATABASE_URL = DB_URL;
  ({ tryConsumeUsage, recordUsage, getUsage, getUsageSummary } = await import("../usage-meters.js"));
}

const db = { one: (s: string, p?: unknown[]) => sql.unsafe(s, p as never[]).then((r) => r[0] ?? null) };

describeDb("account usage meters (real PostgreSQL)", () => {
  let accountId: string;
  const mkAccount = async () => {
    const [u] = await sql`INSERT INTO users (email, display_name, status) VALUES (${`meter-${crypto.randomUUID()}@yourrank.test`}, 'meter', 'active') RETURNING id`;
    return u.id as string;
  };

  afterAll(async () => {
    await sql.end();
  });

  it("bounded consume allows exactly the allowance under concurrency", async () => {
    accountId = await mkAccount();
    const results = await Promise.all(
      Array.from({ length: 50 }, () => tryConsumeUsage(db, accountId, "telegram_interactions", 1, 30))
    );
    const allowed = results.filter((r) => r.allowed).length;
    expect(allowed).toBe(30);
    expect(await getUsage(db, accountId, "telegram_interactions")).toBe(30);
    const denied = results.find((r) => !r.allowed);
    expect(denied?.used).toBe(30);
    expect(denied?.allowance).toBe(30);
  });

  it("allowance 0 denies without creating a row", async () => {
    const id = await mkAccount();
    const r = await tryConsumeUsage(db, id, "broadcast_deliveries", 1, 0);
    expect(r.allowed).toBe(false);
    const rows = await sql`SELECT count(*)::int AS n FROM account_usage_meters WHERE account_id=${id}`;
    expect(rows[0].n).toBe(0);
  });

  it("recordUsage adds unbounded and getUsageSummary aggregates", async () => {
    const id = await mkAccount();
    expect(await recordUsage(db, id, "broadcast_deliveries", 7)).toBe(7);
    expect(await recordUsage(db, id, "broadcast_deliveries", 3)).toBe(10);
    expect(await tryConsumeUsage(db, id, "telegram_interactions", 5, 100)).toMatchObject({ allowed: true, used: 5 });
    const summary = await getUsageSummary({ one: db.one, exec: (s, p) => sql.unsafe(s, p as never[]) }, id);
    expect(summary.broadcast_deliveries).toBe(10);
    expect(summary.telegram_interactions).toBe(5);
  });

  it("rows are keyed to the first day of the current UTC month", async () => {
    const id = await mkAccount();
    await recordUsage(db, id, "telegram_interactions", 2);
    const [row] = await sql`SELECT period_start FROM account_usage_meters WHERE account_id=${id}`;
    expect(row.period_start.getUTCDate()).toBe(1);
  });
});
