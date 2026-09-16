import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { handleCreditsAdjustBalance } from "../handlers/credits.js";
import { handleScores } from "../handlers/scores.js";
import { invalidateSiteCache } from "../site.js";
import { withTransaction } from "@yourrank/shared/db";

const databaseUrl = process.env.AUDIT_TEST_DATABASE_URL || "";
const integrationIt = (name, fn) => (databaseUrl ? it : it.skip)(name, fn, 60000);
const ownerId = crypto.randomUUID();
const siteId = crypto.randomUUID();
const otherSiteId = crypto.randomUUID();
const viewerId = crypto.randomUUID();
const membershipId = crypto.randomUUID();
const otherMembershipId = crypto.randomUUID();
const suffix = crypto.randomUUID().replace(/-/g, "");
const triggerName = `audit_score_failure_${suffix}`;
const owner = { id: ownerId, plan: "pro", status: "active", plan_expires_at: Date.now() + 86400000 };
let sql;
let oldUrl;
const site = (id = siteId) => ({ id, user_id: ownerId });
const deps = {
  requireUser: async () => ({ user: owner, res: null }),
  getByUser: async () => site(),
  getBoardById: async (_env, _user, id) => site(id),
  requireSiteCapability: async () => ({ role: "owner", res: null }),
  rateLimit: async () => ({ ok: true }),
  withTransaction,
};
function adjust(operationId, delta = 10, id = siteId, memberId = membershipId, overrides = {}) {
  return handleCreditsAdjustBalance(new Request(`https://yourrank.site/api/credits/viewers/${memberId}/balance?siteId=${id}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ operationId, delta, reason: "audit operation" }),
  }), {}, { ...deps, ...overrides });
}
function scores(id, name = "Alice", score = 10) {
  invalidateSiteCache({}, id, ownerId);
  return handleScores(new Request("https://yourrank.site/api/scores", {
    method: "POST",
    headers: { "x-postback-key": "test-key", "x-postback-signature": "test-signature", "x-postback-site": id },
    body: JSON.stringify({ players: [{ name, score }] }),
  }), {}, {
    rateLimit: async () => ({ ok: true }),
    verifyHmacSha256Hex: async () => true,
    findPostbackOwner: async () => ({ id: "test-key-id", userId: ownerId }),
    logPostbackIntake: () => {},
  });
}

beforeAll(async () => {
  if (!databaseUrl) return;
  const parsed = new URL(databaseUrl);
  if (!['127.0.0.1', 'localhost', '[::1]', 'postgres'].includes(parsed.hostname) || !/test|e2e/.test(parsed.pathname)) throw new Error("A disposable local test database is required");
  sql = postgres(databaseUrl, { max: 4, prepare: false });
  await sql`INSERT INTO users (id, email, display_name, plan, plan_expires_at, status, email_verified)
    VALUES (${ownerId}, ${`audit-${suffix}@yourrank.test`}, 'Audit owner', 'pro', now() + interval '1 day', 'active', true)`;
  await sql`INSERT INTO sites (id, user_id, slug, name, published, is_draft)
    VALUES (${siteId}, ${ownerId}, ${`a-${suffix}`}, 'Audit A', true, false),
           (${otherSiteId}, ${ownerId}, ${`b-${suffix}`}, 'Audit B', true, false)`;
  await sql`INSERT INTO viewers (id, kick_user_id, kick_username, kick_linked_at)
    VALUES (${viewerId}, ${`kick-${suffix}`}, ${`viewer-${suffix}`}, now())`;
  await sql`INSERT INTO site_viewers (id, site_id, viewer_id) VALUES
    (${membershipId}, ${siteId}, ${viewerId}), (${otherMembershipId}, ${otherSiteId}, ${viewerId})`;
  oldUrl = process.env.DATABASE_URL;
  const worker = new URL(databaseUrl);
  worker.username = "yourrank_worker";
  process.env.DATABASE_URL = worker.toString();
});
afterAll(async () => {
  if (!sql) return;
  await sql.unsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON public.players`);
  await sql.unsafe(`DROP FUNCTION IF EXISTS public.${triggerName}()`);
  await sql`DELETE FROM sites WHERE id IN (${siteId}, ${otherSiteId})`;
  await sql`DELETE FROM viewers WHERE id=${viewerId}`;
  await sql`DELETE FROM users WHERE id=${ownerId}`;
  await sql.end({ timeout: 0 });
  if (oldUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = oldUrl;
});

describe("C11 committed credit operation identity", () => {
  integrationIt("racing retries commit one balance change, ledger entry and receipt", async () => {
    const key = crypto.randomUUID();
    const responses = await Promise.all([adjust(key), adjust(key)]);
    const results = await Promise.all(responses.map((res) => res.json()));
    expect(responses.map((res) => res.status)).toEqual([200, 200]);
    expect(results.filter((r) => r.replayed)).toHaveLength(1);
    const [row] = await sql`SELECT sv.balance, (SELECT count(*)::int FROM credit_ledger WHERE site_viewer_id=sv.id) AS entries,
      (SELECT count(*)::int FROM app_private.manual_credit_operations WHERE site_id=${siteId}) AS receipts
      FROM site_viewers sv WHERE id=${membershipId}`;
    expect(row).toEqual({ balance: 10, entries: 1, receipts: 1 });
    expect((await adjust(key, 20)).status).toBe(409);
    expect((await adjust(key, 10, otherSiteId, otherMembershipId)).status).toBe(200);
  });

  integrationIt("rolls back the balance and ledger if receipt persistence fails; retry succeeds", async () => {
    const key = crypto.randomUUID();
    const [before] = await sql`SELECT balance FROM site_viewers WHERE id=${membershipId}`;
    await expect(adjust(key, 7, siteId, membershipId, {
      withTransaction: (fn) => withTransaction((tx) => fn({ ...tx, unsafe: async (text, params) => {
        if (text.includes("INSERT INTO app_private.manual_credit_operations")) throw new Error("receipt write interrupted");
        return tx.unsafe(text, params);
      } })),
    })).rejects.toThrow("receipt write interrupted");
    const [after] = await sql`SELECT balance FROM site_viewers WHERE id=${membershipId}`;
    expect(after.balance).toBe(before.balance);
    expect((await adjust(key, 7)).status).toBe(200);
    expect((await (await adjust(key, 7)).json()).replayed).toBe(true);
  });

  integrationIt("rejects absent identity, fractional deltas and cross-Site membership without receipts", async () => {
    expect((await adjust("")).status).toBe(400);
    expect((await adjust(crypto.randomUUID(), 1.5)).status).toBe(400);
    expect((await adjust(crypto.randomUUID(), 5, siteId, otherMembershipId)).status).toBe(404);
  });
});

describe("C12 transactional Site-scoped score replay", () => {
  integrationIt("keeps identical header-selected Sites independent and prevents a version increment on replay", async () => {
    expect((await scores(siteId)).status).toBe(200);
    expect((await scores(otherSiteId)).status).toBe(200);
    const [before] = await sql`SELECT version FROM players WHERE site_id=${siteId}`;
    expect((await scores(siteId)).status).toBe(409);
    const [after] = await sql`SELECT version FROM players WHERE site_id=${siteId}`;
    expect(after.version).toBe(before.version);
  });

  integrationIt("a failed player write does not consume replay admission", async () => {
    await sql.unsafe(`CREATE FUNCTION public.${triggerName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.site_id = '${siteId}'::uuid AND NEW.name = 'Interrupted' THEN RAISE EXCEPTION 'injected player failure'; END IF;
      RETURN NEW; END $$`);
    await sql.unsafe(`CREATE TRIGGER ${triggerName} BEFORE INSERT OR UPDATE ON public.players FOR EACH ROW EXECUTE FUNCTION public.${triggerName}()`);
    expect((await scores(siteId, "Interrupted", 20)).status).toBe(500);
    await sql.unsafe(`DROP TRIGGER ${triggerName} ON public.players`);
    expect((await scores(siteId, "Interrupted", 20)).status).toBe(200);
    expect((await scores(siteId, "Interrupted", 20)).status).toBe(409);
  });

  integrationIt("two concurrent score retries produce one committed mutation", async () => {
    const responses = await Promise.all([scores(siteId, "Concurrent", 30), scores(siteId, "Concurrent", 30)]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const [row] = await sql`SELECT count(*)::int AS count, max(version) AS version FROM players WHERE site_id=${siteId}`;
    expect(row).toEqual({ count: 1, version: 1 });
  });
});
