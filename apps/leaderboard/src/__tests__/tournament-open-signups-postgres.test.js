// One-open-tournament-per-site migration against a real Postgres: the
// lock-table backfill picks the newest open tournament per site and the
// normalization UPDATE locks every other live open tournament on that site.
// The real migration file is replayed inside a rolled-back transaction per
// case (its DDL is IF NOT EXISTS + ON CONFLICT DO NOTHING, so it is
// idempotent). Connects as a superuser-equivalent role because the migration
// needs DDL rights. Skips when TOURNAMENT_TEST_DATABASE_URL (or
// AUDIT_TEST_DATABASE_URL) is unset.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import postgres from "postgres";

const databaseUrl = process.env.TOURNAMENT_TEST_DATABASE_URL || process.env.AUDIT_TEST_DATABASE_URL || "";
const integrationIt = (name, fn) => (databaseUrl ? it : it.skip)(name, fn, 60000);
const receiptsMigration = readFileSync(
  new URL("../../../../supabase/migrations/20261003000000_provider_webhook_receipts.sql", import.meta.url),
  "utf8",
);
const normalizeMigration = readFileSync(
  new URL("../../../../supabase/migrations/20261003000100_lock_non_holder_open_tournaments.sql", import.meta.url),
  "utf8",
);
const applyMigrations = async (tx) => {
  await tx.unsafe(receiptsMigration);
  await tx.unsafe(normalizeMigration);
};

const ROLLBACK = new Error("rollback");
const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 12);

async function inCase(fn) {
  const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await sql.begin(async (tx) => {
      const ownerId = crypto.randomUUID();
      const siteId = crypto.randomUUID();
      await tx`INSERT INTO users (id, email, display_name, status, email_verified)
        VALUES (${ownerId}, ${`tos-${suffix}-${ownerId.slice(0, 8)}@yourrank.test`}, 'Owner', 'active', true)`;
      await tx`INSERT INTO sites (id, user_id, slug, name, published, is_draft)
        VALUES (${siteId}, ${ownerId}, ${`tos-${suffix}-${siteId.slice(0, 8)}`}, 'Site', true, false)`;
      await fn(tx, siteId);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  } finally {
    await sql.end({ timeout: 0 });
  }
}

const addTournament = (tx, { siteId, signupState = "open", status = "active", createdAt }) =>
  tx`INSERT INTO tournaments (id, site_id, title, status, signup_state, created_at)
       VALUES (${crypto.randomUUID()}, ${siteId}, 'Cup', ${status}, ${signupState},
               ${createdAt || new Date().toISOString()}) RETURNING id`.then((rows) => rows[0].id);

const holder = async (tx, siteId) =>
  (await tx`SELECT tournament_id FROM tournament_open_signups WHERE site_id = ${siteId}`)[0];
const states = async (tx, ids) =>
  Object.fromEntries(
    (await tx`SELECT id, signup_state FROM tournaments WHERE id IN ${tx(ids)}`).map((r) => [r.id, r.signup_state]),
  );

describe("one open tournament per site migration (Postgres)", () => {
  it("normalization migration carries the expand marker and the locking UPDATE", () => {
    expect(normalizeMigration).toContain("yourrank:migration-phase: expand");
    expect(normalizeMigration).toContain("NOT EXISTS (");
    expect(normalizeMigration).toContain("SET signup_state = 'locked'");
    expect(receiptsMigration).toContain("tournament_open_signups");
  });

  integrationIt("newest of three open tournaments becomes the holder; the rest are locked", async () => {
    await inCase(async (tx, siteId) => {
      const t0 = await addTournament(tx, { siteId, createdAt: "2026-09-01T00:00:00Z" });
      const t1 = await addTournament(tx, { siteId, createdAt: "2026-09-02T00:00:00Z" });
      const t2 = await addTournament(tx, { siteId, createdAt: "2026-09-03T00:00:00Z" });
      await applyMigrations(tx);

      expect((await holder(tx, siteId))?.tournament_id).toBe(t2);
      expect(await states(tx, [t0, t1, t2])).toEqual({ [t0]: "locked", [t1]: "locked", [t2]: "open" });
      const open = await tx`SELECT count(*)::int AS n FROM tournaments
        WHERE site_id = ${siteId} AND signup_state = 'open'`;
      expect(open[0].n).toBe(1);
    });
  });

  integrationIt("a single open tournament remains open and is the holder", async () => {
    await inCase(async (tx, siteId) => {
      const t = await addTournament(tx, { siteId });
      await applyMigrations(tx);

      expect((await holder(tx, siteId))?.tournament_id).toBe(t);
      expect(await states(tx, [t])).toEqual({ [t]: "open" });
    });
  });

  integrationIt("no open tournaments leaves no holder and unchanged states", async () => {
    await inCase(async (tx, siteId) => {
      const closed = await addTournament(tx, { siteId, signupState: "closed" });
      const locked = await addTournament(tx, { siteId, signupState: "locked" });
      await applyMigrations(tx);

      expect(await holder(tx, siteId)).toBeUndefined();
      expect(await states(tx, [closed, locked])).toEqual({ [closed]: "closed", [locked]: "locked" });
    });
  });

  integrationIt("completed/cancelled open rows are never holders and keep signup_state 'open'", async () => {
    await inCase(async (tx, siteId) => {
      const completed = await addTournament(tx, { siteId, status: "completed", createdAt: "2026-09-01T00:00:00Z" });
      const cancelled = await addTournament(tx, { siteId, status: "cancelled", createdAt: "2026-09-02T00:00:00Z" });
      const live = await addTournament(tx, { siteId, createdAt: "2026-09-03T00:00:00Z" });
      await applyMigrations(tx);

      expect((await holder(tx, siteId))?.tournament_id).toBe(live);
      expect(await states(tx, [completed, cancelled, live])).toEqual({
        [completed]: "open",
        [cancelled]: "open",
        [live]: "open",
      });
    });
  });
});
