// ============================================================================
//  F-037/F-038/F-054: queue event ledger against a real PostgreSQL.
//
//  Proves, with real locks and transactions, that the same logical event id
//  mutates analytics counters exactly once (sequential and concurrent), that
//  distinct ids apply independently, and that notification delivery is
//  at-most-once with ambiguous/failed states persisted rather than retried
//  blindly. Needs the migrated schema (QUEUE_TEST_DATABASE_URL); when
//  QUEUE_LEDGER_GATE=required the suite FAILS without a database — a skipped
//  idempotency gate is never a pass.
// ============================================================================

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";

const DB_URL = process.env.QUEUE_TEST_DATABASE_URL;
const gateRequired = process.env.QUEUE_LEDGER_GATE === "required";
const describeDb = DB_URL ? describe : describe.skip;
const sql = DB_URL ? postgres(DB_URL, { max: 8, onnotice: () => {} }) : (null as never);

let applyBumpOnce: typeof import("../queue-effects").applyBumpOnce;
let deliverNotifyOnce: typeof import("../queue-effects").deliverNotifyOnce;
let runOnceWithLease: typeof import("../queue-ledger").runOnceWithLease;
let DeliveryError: typeof import("../notifications").DeliveryError;

if (DB_URL) {
  process.env.DATABASE_URL = DB_URL;
  ({ applyBumpOnce, deliverNotifyOnce } = await import("../queue-effects"));
  ({ runOnceWithLease } = await import("../queue-ledger"));
  ({ DeliveryError } = await import("../notifications"));
}

if (gateRequired && !DB_URL) {
  describe("queue ledger gate", () => {
    it("QUEUE_LEDGER_GATE=required but QUEUE_TEST_DATABASE_URL is missing", () => {
      throw new Error("QUEUE_LEDGER_GATE=required but QUEUE_TEST_DATABASE_URL is not set; refusing to certify");
    });
  });
}

const identity = (eventId: string, eventType = "bump", correlationId: string | null = "req-ledger") => ({
  eventId,
  eventType,
  correlationId,
  identitySource: "envelope" as const,
});

describeDb("queue event ledger (real PostgreSQL)", () => {
  let userId: string;
  let siteId: string;
  const eventIds: string[] = [];
  const newId = () => {
    const id = crypto.randomUUID();
    eventIds.push(id);
    return id;
  };

  beforeAll(async () => {
    const [user] = await sql`
      INSERT INTO users (email, display_name, status)
      VALUES (${`ledger-${Date.now()}@yourrank.test`}, 'ledger', 'active') RETURNING id`;
    userId = user.id;
    const [site] = await sql`
      INSERT INTO sites (user_id, slug, name, board_order)
      VALUES (${userId}, ${`ledger-${Date.now()}`}, 'ledger', 1) RETURNING id`;
    siteId = site.id;
  });

  afterAll(async () => {
    if (eventIds.length) await sql`DELETE FROM queue_event_ledger WHERE event_id IN ${sql(eventIds)}`;
    await sql`DELETE FROM sites WHERE id = ${siteId}`;
    await sql`DELETE FROM users WHERE id = ${userId}`;
    await sql.end({ timeout: 1 });
  });

  const views = async () => {
    const [row] = await sql`SELECT coalesce(sum(views), 0)::int AS views FROM site_stats WHERE site_id = ${siteId}`;
    return row.views as number;
  };
  const bump = { type: "bump" as const, siteId: "", field: "views" as const, referer: null, visitorHash: null, timestamp: 1 };

  it("applies the same bump event id once across a retry and records correlation", async () => {
    const before = await views();
    const id = newId();
    const first = await applyBumpOnce(identity(id), { ...bump, siteId });
    const second = await applyBumpOnce(identity(id), { ...bump, siteId });
    expect(first).toEqual({ outcome: "applied" });
    expect(second).toEqual({ outcome: "duplicate", state: "completed" });
    expect(await views()).toBe(before + 1);
    const [row] = await sql`SELECT state, attempts, correlation_id, event_type FROM queue_event_ledger WHERE event_id = ${id}`;
    expect(row).toMatchObject({ state: "completed", attempts: 1, correlation_id: "req-ledger", event_type: "bump" });
  });

  it("applies two different bump event ids twice", async () => {
    const before = await views();
    await applyBumpOnce(identity(newId()), { ...bump, siteId });
    await applyBumpOnce(identity(newId()), { ...bump, siteId });
    expect(await views()).toBe(before + 2);
  });

  it("collapses concurrent duplicate processing of one event id into one increment", async () => {
    const before = await views();
    const id = newId();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => applyBumpOnce(identity(id), { ...bump, siteId })),
    );
    expect(results.filter((r) => r.outcome === "applied")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "duplicate")).toHaveLength(5);
    expect(await views()).toBe(before + 1);
  });

  it("rolls the ledger claim back with the side effect so a failed attempt can be retried", async () => {
    const before = await views();
    const id = newId();
    const { runOnceInTransaction } = await import("../queue-ledger");
    await expect(runOnceInTransaction(identity(id), async () => {
      throw new Error("handler exploded");
    })).rejects.toThrow("handler exploded");
    const [none] = await sql`SELECT 1 FROM queue_event_ledger WHERE event_id = ${id}`;
    expect(none).toBeUndefined();
    expect(await applyBumpOnce(identity(id), { ...bump, siteId })).toEqual({ outcome: "applied" });
    expect(await views()).toBe(before + 1);
  });

  const notify = (name: string) => ({
    type: "notify" as const,
    kind: "top3" as const,
    siteId: "",
    siteName: "ledger",
    changes: [{ name, rank: 1, wagered: 1 }],
  });

  it("delivers a notification once and suppresses the duplicate without calling the provider again", async () => {
    const id = newId();
    let dispatches = 0;
    const dispatchImpl = async () => { dispatches++; };
    const first = await deliverNotifyOnce(identity(id, "notify"), { ...notify("1"), siteId }, {}, new Map(), { dispatchImpl });
    const second = await deliverNotifyOnce(identity(id, "notify"), { ...notify("1"), siteId }, {}, new Map(), { dispatchImpl });
    expect(first).toEqual({ outcome: "applied" });
    expect(second).toEqual({ outcome: "duplicate", state: "completed" });
    expect(dispatches).toBe(1);
  });

  it("marks a no-response provider failure ambiguous and never blindly redelivers it", async () => {
    const id = newId();
    let dispatches = 0;
    const dispatchImpl = async () => {
      dispatches++;
      throw new DeliveryError("telegram", { ok: false, error: "socket hang up", ambiguous: true });
    };
    const first = await deliverNotifyOnce(identity(id, "notify"), { ...notify("2"), siteId }, {}, new Map(), { dispatchImpl });
    expect(first).toEqual({ outcome: "ambiguous", reason: "provider_no_response" });
    const retry = await deliverNotifyOnce(identity(id, "notify"), { ...notify("2"), siteId }, {}, new Map(), { dispatchImpl });
    expect(retry).toEqual({ outcome: "duplicate", state: "ambiguous" });
    expect(dispatches).toBe(1);
    const [row] = await sql`SELECT state, last_error FROM queue_event_ledger WHERE event_id = ${id}`;
    expect(row.state).toBe("ambiguous");
    expect(row.last_error).toContain("socket hang up");
  });

  it("keeps a clear provider rejection retryable and completes on the retry", async () => {
    const id = newId();
    let calls = 0;
    const dispatchImpl = async () => {
      calls++;
      if (calls === 1) throw new DeliveryError("telegram", { ok: false, error: "HTTP 500 from provider" });
    };
    await expect(deliverNotifyOnce(identity(id, "notify"), { ...notify("3"), siteId }, {}, new Map(), { dispatchImpl }))
      .rejects.toThrow("HTTP 500");
    const [failed] = await sql`SELECT state, attempts FROM queue_event_ledger WHERE event_id = ${id}`;
    expect(failed).toMatchObject({ state: "failed", attempts: 1 });
    const retry = await deliverNotifyOnce(identity(id, "notify"), { ...notify("3"), siteId }, {}, new Map(), { dispatchImpl });
    expect(retry).toEqual({ outcome: "applied" });
    const [done] = await sql`SELECT state, attempts FROM queue_event_ledger WHERE event_id = ${id}`;
    expect(done).toMatchObject({ state: "completed", attempts: 2 });
    expect(calls).toBe(2);
  });

  it("turns an expired in-flight lease into ambiguous instead of a second delivery", async () => {
    const id = newId();
    await sql`
      INSERT INTO queue_event_ledger (event_id, event_type, correlation_id, identity_source, state, attempts, lease_expires_at)
      VALUES (${id}, 'notify', NULL, 'envelope', 'processing', 1, now() - interval '1 minute')`;
    let called = 0;
    const result = await runOnceWithLease(identity(id, "notify", null), async () => { called++; });
    expect(result).toEqual({ outcome: "ambiguous", reason: "lease_expired" });
    expect(called).toBe(0);
    const [row] = await sql`SELECT state FROM queue_event_ledger WHERE event_id = ${id}`;
    expect(row.state).toBe("ambiguous");
  });

  it("gives exactly one concurrent notification caller the lease", async () => {
    const id = newId();
    let dispatches = 0;
    const dispatchImpl = async () => {
      dispatches++;
      await new Promise((r) => setTimeout(r, 50));
    };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => deliverNotifyOnce(identity(id, "notify"), { ...notify("4"), siteId }, {}, new Map(), { dispatchImpl })),
    );
    expect(results.filter((r) => r.outcome === "applied")).toHaveLength(1);
    expect(results.filter((r) => r.outcome === "duplicate")).toHaveLength(4);
    expect(dispatches).toBe(1);
  });
});
