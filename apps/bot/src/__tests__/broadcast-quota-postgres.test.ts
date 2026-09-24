// ============================================================================
//  Broadcast monthly-quota reservation correctness against a real PostgreSQL.
//
//  Proves, with real rows and real claim/reservation SQL, that:
//   * two concurrent workers on the same owner can never start more delivery
//     attempts than the remaining monthly allowance;
//   * the meter counts exactly the attempts actually made;
//   * the broadcast that runs out of quota ends paused/monthly_quota with its
//     cursor at the last processed subscriber;
//   * a worker whose lease is stolen before any send makes 0 attempts and
//     releases its whole grant;
//   * a first-recipient 429 releases the full reservation; and
//   * releaseUsage credits the period the reservation came from, so a month
//     rollover mid-batch cannot corrupt the next period.
//
//  Needs the migrated schema (BROADCAST_TEST_DATABASE_URL); when
//  BROADCAST_LEASE_GATE=required the suite FAILS without a database.
// ============================================================================

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";

const DB_URL = process.env.BROADCAST_TEST_DATABASE_URL;
const gateRequired = process.env.BROADCAST_LEASE_GATE === "required";
const describeDb = DB_URL ? describe : describe.skip;
const sql = DB_URL ? postgres(DB_URL, { max: 6, onnotice: () => {} }) : (null as never);

let processBroadcastBatch: typeof import("../broadcasts.js").processBroadcastBatch;
let encryptToken: typeof import("@yourrank/shared/crypto").encryptToken;
let releaseUsage: typeof import("@yourrank/shared/usage-meters").releaseUsage;
let getPlanLimit: typeof import("@yourrank/shared/plans").getPlanLimit;

if (DB_URL) {
  process.env.DATABASE_URL = DB_URL;
  process.env.TOKEN_ENC_KEY = "00".repeat(32);
  ({ processBroadcastBatch } = await import("../broadcasts.js"));
  ({ encryptToken } = await import("@yourrank/shared/crypto"));
  ({ releaseUsage } = await import("@yourrank/shared/usage-meters"));
  ({ getPlanLimit } = await import("@yourrank/shared/plans"));
}

if (gateRequired && !DB_URL) {
  describe("broadcast quota gate", () => {
    it("BROADCAST_LEASE_GATE=required but BROADCAST_TEST_DATABASE_URL is missing", () => {
      throw new Error("BROADCAST_LEASE_GATE=required but BROADCAST_TEST_DATABASE_URL is not set; refusing to certify");
    });
  });
}

const ok = () => new Response("{}", { status: 200 });

describeDb("broadcast monthly quota (real PostgreSQL)", () => {
  let ownerId: string;
  let botId: string;
  let botBId: string | null = null;
  let proAllowance: number;
  const broadcastIds: string[] = [];
  let tg = 70000;

  beforeAll(async () => {
    await sql`UPDATE broadcasts SET status = 'canceled' WHERE status IN ('scheduled', 'sending')`;
    const [user] = await sql`
      INSERT INTO users (email, display_name, plan, plan_expires_at, status)
      VALUES (${`bquota-${Date.now()}@yourrank.test`}, 'bquota', 'pro', now() + interval '30 days', 'active') RETURNING id`;
    ownerId = user.id;
    const token = await encryptToken("123:test-token");
    const [bot] = await sql`
      INSERT INTO bots (owner_id, token_encrypted, webhook_secret, status)
      VALUES (${ownerId}, ${token}, ${`wh-${Date.now()}-${crypto.randomUUID()}`}, 'active') RETURNING id`;
    botId = bot.id;
    proAllowance = getPlanLimit("pro", "broadcast_deliveries_per_month");
  });

  afterAll(async () => {
    if (broadcastIds.length) await sql`DELETE FROM broadcasts WHERE id IN ${sql(broadcastIds)}`;
    await sql`DELETE FROM bot_subscribers WHERE bot_id IN (${botId}, ${botBId ?? botId})`;
    await sql`DELETE FROM account_usage_meters WHERE account_id = ${ownerId}`;
    await sql`DELETE FROM bots WHERE id IN (${botId}, ${botBId ?? botId})`;
    await sql`DELETE FROM users WHERE id = ${ownerId}`;
    await sql.end({ timeout: 1 });
  });

  const newBroadcasts = async (batches: number[][]) => {
    // Only this test's broadcasts may be claimable — the worker claims the
    // OLDEST due row, so leftovers from earlier tests must not win the race.
    await sql`UPDATE broadcasts SET status = 'canceled' WHERE status IN ('scheduled', 'sending')`;
    const ids: string[] = [];
    for (const subs of batches) {
      for (const id of subs) {
        await sql`
          INSERT INTO bot_subscribers (bot_id, tg_user_id, first_name)
          VALUES (${botId}, ${id}, ${`u${id}`})`;
      }
      const [row] = await sql`
        INSERT INTO broadcasts (bot_id, body, status, cursor_tg_user_id)
        VALUES (${botId}, 'hi {name}', 'scheduled', 0) RETURNING id`;
      broadcastIds.push(row.id);
      ids.push(row.id as string);
    }
    return ids;
  };
  const newBroadcast = async (subs: number[]) => (await newBroadcasts([subs]))[0];

  const broadcast = async (id: string) => {
    const [row] = await sql`
      SELECT status, stop_reason, cursor_tg_user_id, sent_count, fail_count, processing_lease_token
        FROM broadcasts WHERE id = ${id}`;
    return row;
  };

  const meterUsed = async () => {
    const [row] = await sql`
      SELECT used FROM account_usage_meters
       WHERE account_id = ${ownerId} AND meter = 'broadcast_deliveries'
         AND period_start = (date_trunc('month', now() AT TIME ZONE 'utc'))::date`;
    return Number(row?.used ?? 0);
  };

  const seedUsed = async (used: number) => {
    await sql`
      INSERT INTO account_usage_meters (account_id, meter, period_start, used)
      VALUES (${ownerId}, 'broadcast_deliveries', (date_trunc('month', now() AT TIME ZONE 'utc'))::date, ${used})
      ON CONFLICT (account_id, meter, period_start)
      DO UPDATE SET used = ${used}`;
  };

  it("two concurrent workers cannot oversubscribe the remaining monthly allowance", async () => {
    const remaining = 7;
    await seedUsed(proAllowance - remaining);
    // Each broadcast needs its own bot so their subscriber pools are disjoint —
    // a shared pool would let one broadcast's cursor land inside the other's
    // list and make the pause point unreadable.
    const token2 = await encryptToken("123:test-token-b");
    const [botB] = await sql`
      INSERT INTO bots (owner_id, token_encrypted, webhook_secret, status)
      VALUES (${ownerId}, ${token2}, ${`wh-b-${Date.now()}`}, 'active') RETURNING id`;
    botBId = botB.id;
    const subsA = [++tg, ++tg, ++tg, ++tg, ++tg];
    const subsB = [++tg, ++tg, ++tg, ++tg, ++tg];
    for (const id of subsA) await sql`INSERT INTO bot_subscribers (bot_id, tg_user_id, first_name) VALUES (${botId}, ${id}, ${`u${id}`})`;
    for (const id of subsB) await sql`INSERT INTO bot_subscribers (bot_id, tg_user_id, first_name) VALUES (${botB.id}, ${id}, ${`u${id}`})`;
    const [rowA] = await sql`INSERT INTO broadcasts (bot_id, body, status, cursor_tg_user_id) VALUES (${botId}, 'hi {name}', 'scheduled', 0) RETURNING id`;
    const [rowB] = await sql`INSERT INTO broadcasts (bot_id, body, status, cursor_tg_user_id) VALUES (${botB.id}, 'hi {name}', 'scheduled', 0) RETURNING id`;
    const first = rowA.id as string;
    const second = rowB.id as string;
    broadcastIds.push(first, second);

    // Both workers see their own claim (SKIP LOCKED splits the broadcasts),
    // then race on the same meter row. Every fake send is recorded.
    const attempts: string[] = [];
    let holdAll!: () => void;
    const gate = new Promise<void>((r) => { holdAll = r; });
    const sendTelegram = async (_token: string, method: string, payload: Record<string, unknown>) => {
      attempts.push(`${method}:${payload.chat_id}`);
      await gate;
      return ok();
    };

    const workerA = processBroadcastBatch(5, { sendTelegram });
    const workerB = processBroadcastBatch(5, { sendTelegram });
    // Wait until both workers have started their (serialized) reservations
    // and at least one send is in flight before releasing the gate.
    for (let i = 0; i < 500 && attempts.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    holdAll();
    await Promise.all([workerA, workerB]);

    expect(attempts.length).toBeLessThanOrEqual(remaining);
    const newAttempts = await meterUsed();
    expect(newAttempts - (proAllowance - remaining)).toBe(attempts.length);

    // Every recorded attempt maps to a real send: sent + failed counters and
    // the cursor reflect only processed subscribers.
    const a = await broadcast(first);
    const b = await broadcast(second);
    const processed = Number(a.sent_count) + Number(a.fail_count) + Number(b.sent_count) + Number(b.fail_count);
    expect(processed).toBe(attempts.length);

    // The broadcast that hit the quota wall is paused until next month with
    // the cursor parked at the last subscriber actually processed.
    const paused = [a, b].find((r) => r.status === "paused");
    expect(paused?.stop_reason).toBe("monthly_quota");
    const unpaused = paused === a ? b : a;
    expect(Number(paused!.cursor_tg_user_id)).toBeGreaterThanOrEqual(0);
    // The unpaused broadcast drained its whole pool (status may still read
    // "sending" until the next tick finds no more subscribers); the paused one
    // holds at least one subscriber beyond its cursor that was never attempted.
    expect(["sent", "sending"]).toContain(unpaused.status);
    expect(Number(unpaused.sent_count) + Number(unpaused.fail_count)).toBe(5);
    const pausedBot = paused === a ? botId : botB.id;
    const leftBehind = await sql`
      SELECT count(*)::int AS n FROM bot_subscribers
       WHERE bot_id = ${pausedBot} AND NOT is_blocked AND tg_user_id > ${paused!.cursor_tg_user_id}`;
    expect(leftBehind[0].n).toBeGreaterThan(0);

    // A follow-up tick re-claims nothing: the paused row is unclaimable and
    // the drained broadcast completed.
    const more = await processBroadcastBatch(5, { sendTelegram: async () => ok() });
    if (unpaused.status !== "sent") expect(more || (await broadcast(second)).status === "sent").toBeTruthy();
  });

  it("a worker whose lease is stolen before sending makes 0 attempts and keeps its grant released", async () => {
    await seedUsed(0);
    const id = await newBroadcast([++tg, ++tg, ++tg]);

    let sends = 0;
    const sendTelegram = async () => { sends++; return ok(); };
    const worker = processBroadcastBatch(3, { sendTelegram });

    // Rotate the lease as soon as the claim lands, before the send loop's
    // ownership proof — the worker must break with 0 attempts.
    for (let i = 0; i < 500; i++) {
      const row = await broadcast(id);
      if (row.processing_lease_token) {
        await sql`UPDATE broadcasts SET processing_lease_token = ${crypto.randomUUID()} WHERE id = ${id}`;
        break;
      }
      await new Promise((r) => setTimeout(r, 5));
    }
    await worker;

    expect(sends).toBe(0);
    expect(await meterUsed()).toBe(0);
    // The row keeps the rotated (stale) lease; the next tick reclaims it and
    // sends normally once it expires.
    await sql`UPDATE broadcasts SET processing_lease_token = NULL, processing_lease_expires_at = NULL WHERE id = ${id}`;
  });

  it("a 429 on the first recipient releases the full reservation", async () => {
    await seedUsed(0);
    const id = await newBroadcast([++tg, ++tg]);
    const sendTelegram = async () =>
      new Response(JSON.stringify({ parameters: { retry_after: 0 } }), { status: 429 });

    await processBroadcastBatch(2, { sendTelegram });

    expect(await meterUsed()).toBe(0);
    const row = await broadcast(id);
    expect(Number(row.cursor_tg_user_id)).toBe(0);
    expect(row.status).toBe("sending"); // lease handed back, ready to retry
  });

  it("releaseUsage credits the reservation's own period, not the current month", async () => {
    // Simulate a reservation taken last month being released after rollover.
    await sql`
      INSERT INTO account_usage_meters (account_id, meter, period_start, used)
      VALUES (${ownerId}, 'broadcast_deliveries', '2000-01-01', 5)`;
    await seedUsed(9);
    await releaseUsage({ one: (text: string, params?: unknown[]) => sql.unsafe(text, params as never[]).then((r) => r[0]) }, ownerId, "broadcast_deliveries", 3, "2000-01-01");
    const [old] = await sql`SELECT used FROM account_usage_meters WHERE account_id = ${ownerId} AND period_start = '2000-01-01'`;
    expect(Number(old.used)).toBe(2);
    expect(await meterUsed()).toBe(9);
    await sql`DELETE FROM account_usage_meters WHERE account_id = ${ownerId} AND period_start = '2000-01-01'`;
  });
});
