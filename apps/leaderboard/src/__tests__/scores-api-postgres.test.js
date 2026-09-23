// Real PostgreSQL coverage for API key board scoping, server-side
// Idempotency-Key reservations, and the concurrent score-patch merge.
// Self-skips in the regular database-free suite; the migration dry-run gate
// supplies AUDIT_TEST_DATABASE_URL after applying the complete migration chain.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import {
  computeIdempotencyRequestHash,
  reserveIdempotencyKey,
  completeIdempotencyKey,
  releaseIdempotencyKey,
} from "@yourrank/shared/api-idempotency";
import { saveSite } from "../site.js";

const url = process.env.AUDIT_TEST_DATABASE_URL || "";
const integrationIt = (name, fn) => (url ? it : it.skip)(name, fn, 60000);
const ownerId = crypto.randomUUID();
const siteId = crypto.randomUUID();
const siteBId = crypto.randomUUID();
let sql;
const run = (text, params = []) => sql.unsafe(text, params);
const one = async (text, params = []) => (await run(text, params))[0] || null;

const identity = (key = "idem-1", endpoint = "PATCH /api/scores") => ({ userId: ownerId, siteId, endpoint, key });
const idemDeps = { execImpl: run, oneImpl: one };

beforeAll(async () => {
  if (!url) return;
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1", "postgres"].includes(parsed.hostname) || !/test|e2e/.test(parsed.pathname)) throw new Error("Disposable local database required");
  sql = postgres(url, { max: 3, prepare: false });
  await sql`INSERT INTO users (id, email, status, email_verified, plan) VALUES (${ownerId}, ${`${ownerId}@test.example`}, 'active', true, 'pro')`;
  await sql`INSERT INTO sites (id, user_id, slug, name, published, is_draft) VALUES
    (${siteId}, ${ownerId}, ${`a-${siteId.slice(0, 30)}`}, 'API Board', true, false),
    (${siteBId}, ${ownerId}, ${`b-${siteBId.slice(0, 30)}`}, 'Other Board', true, false)`;
});

afterAll(async () => {
  if (!sql) return;
  await sql`DELETE FROM sites WHERE id IN (${siteId}, ${siteBId})`;
  await sql`DELETE FROM users WHERE id = ${ownerId}`;
  await sql.end();
});

const saveDeps = (siteRow) => ({
  one,
  query: run,
  withTransaction: (fn) => sql.begin(async (tx) => fn({
    one: async (text, params = []) => (await tx.unsafe(text, params))[0] || null,
    unsafe: (text, params = []) => tx.unsafe(text, params),
  })),
  getBoardById: async () => siteRow,
  getPlayers: async () => run("SELECT name, score, hands, sort AS rank FROM players WHERE site_id=$1", [siteRow.id]),
  invalidateSiteCache: () => {},
  invalidatePublicBoardCache: () => {},
  logAudit: async () => {},
  notifyLiveBoard: async () => {},
  createNotifyQueue: () => ({ send: async () => {}, sendBatch: async () => {} }),
});
const owner = () => ({ id: ownerId, plan: "pro", plan_expires_at: Date.now() + 86_400_000 * 30, status: "active" });
const minimalPayload = { brand: { name: "API Board", period: "Monthly" }, partner: {} };
const playersOf = (id) => sql`SELECT name, score, wagered FROM players WHERE site_id=${id} ORDER BY sort`;

describe("API key scope + idempotency (Postgres)", () => {
  integrationIt("persists a board scope on postback_keys and round-trips it", async () => {
    const [row] = await sql`INSERT INTO postback_keys (user_id, site_id, key_hash, label)
      VALUES (${ownerId}, ${siteId}, ${`hash-${crypto.randomUUID()}`}, 'board')
      RETURNING id, site_id`;
    expect(row.site_id).toBe(siteId);
    const [account] = await sql`INSERT INTO postback_keys (user_id, key_hash, label)
      VALUES (${ownerId}, ${`hash-${crypto.randomUUID()}`}, 'account')
      RETURNING id, site_id`;
    expect(account.site_id).toBeNull();
    await sql`DELETE FROM postback_keys WHERE id IN (${row.id}, ${account.id})`;
  });

  integrationIt("exactly one of two concurrent identical reservations wins", async () => {
    const requestHash = await computeIdempotencyRequestHash({ method: "PATCH", path: "/api/scores", siteId, body: "{}" });
    const [a, b] = await Promise.all([
      reserveIdempotencyKey({ ...identity(), requestHash }, idemDeps),
      reserveIdempotencyKey({ ...identity(), requestHash }, idemDeps),
    ]);
    const states = [a.state, b.state].sort();
    expect(states).toEqual(["in_progress", "reserved"]);
    await releaseIdempotencyKey(identity(), idemDeps);
  });

  integrationIt("an expired reservation can be re-reserved, then completes to a replay", async () => {
    await sql`DELETE FROM api_idempotency_keys WHERE user_id=${ownerId}`;
    await sql`INSERT INTO api_idempotency_keys (user_id, site_id, endpoint, idempotency_key, request_hash, expires_at)
      VALUES (${ownerId}, ${siteId}, 'PATCH /api/scores', 'expired', 'old-hash', now() - interval '1 second')`;
    const re = await reserveIdempotencyKey({ ...identity("expired"), requestHash: "new-hash" }, idemDeps);
    expect(re.state).toBe("reserved");
    await completeIdempotencyKey({ ...identity("expired"), status: 200, body: { ok: true, players: 2 } }, { execImpl: run });
    const replay = await reserveIdempotencyKey({ ...identity("expired"), requestHash: "new-hash" }, idemDeps);
    expect(replay).toMatchObject({ state: "replay", status: 200, body: { ok: true, players: 2 } });
    const mismatch = await reserveIdempotencyKey({ ...identity("expired"), requestHash: "other" }, idemDeps);
    expect(mismatch.state).toBe("mismatch");
    await sql`DELETE FROM api_idempotency_keys WHERE user_id=${ownerId}`;
  });

  integrationIt("two concurrent PATCH merges against one site both land", async () => {
    const siteRow = await one("SELECT * FROM sites WHERE id=$1", [siteId]);
    const [a, b] = await Promise.all([
      saveSite({}, owner(), minimalPayload, siteId, null, { scorePatch: [{ name: "Alpha", score: 10 }], deps: saveDeps(siteRow) }),
      saveSite({}, owner(), minimalPayload, siteId, null, { scorePatch: [{ name: "Beta", score: 20 }], deps: saveDeps(siteRow) }),
    ]);
    expect(a.error).toBeUndefined();
    expect(b.error).toBeUndefined();
    const names = (await playersOf(siteId)).map((p) => p.name);
    expect(names).toContain("Alpha");
    expect(names).toContain("Beta");
    // A third merge updates one player and creates another; totals accumulate.
    const c = await saveSite({}, owner(), minimalPayload, siteId, null, { scorePatch: [{ name: "alpha", score: 99 }, { name: "Gamma", wagered: 5 }], deps: saveDeps(siteRow) });
    expect(c.patch).toEqual({ total: 3, updated: 1, created: 1 });
    const rows = await playersOf(siteId);
    expect(rows).toHaveLength(3);
    expect(Number(rows.find((r) => r.name === "alpha").score)).toBe(99);
    await sql`DELETE FROM players WHERE site_id=${siteId}`;
  });
});
