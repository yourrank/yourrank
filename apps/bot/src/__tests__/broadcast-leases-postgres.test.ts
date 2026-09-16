// ============================================================================
//  C13/C14 (F12/F13): broadcast batch leases and cursor correctness against a
//  real PostgreSQL.
//
//  Proves, with real rows and real claim SQL, that:
//   * a live lease makes a second concurrent worker find nothing to claim;
//   * the lease is released by the end-of-batch write, so the next tick
//     continues the SAME broadcast immediately (no lease-expiry stall) and a
//     drained broadcast completes on the following tick;
//   * an expired lease is reclaimable;
//   * progress writes are ownership-checked: a worker whose lease was stolen
//     mid-batch cannot move the cursor, the counters, the completion, or the
//     failure of the broadcast another worker owns;
//   * a 429 on the FIRST recipient of a batch leaves the cursor untouched and
//     only hands the lease back, so that recipient is retried next tick.
//
//  Needs the migrated schema (BROADCAST_TEST_DATABASE_URL); when
//  BROADCAST_LEASE_GATE=required the suite FAILS without a database.
// ============================================================================

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";

const DB_URL = process.env.BROADCAST_TEST_DATABASE_URL;
const gateRequired = process.env.BROADCAST_LEASE_GATE === "required";
const describeDb = DB_URL ? describe : describe.skip;
const sql = DB_URL ? postgres(DB_URL, { max: 4, onnotice: () => {} }) : (null as never);

let processBroadcastBatch: typeof import("../broadcasts.js").processBroadcastBatch;
let encryptToken: typeof import("@yourrank/shared/crypto").encryptToken;

if (DB_URL) {
  process.env.DATABASE_URL = DB_URL;
  process.env.TOKEN_ENC_KEY = "00".repeat(32);
  ({ processBroadcastBatch } = await import("../broadcasts.js"));
  ({ encryptToken } = await import("@yourrank/shared/crypto"));
}

if (gateRequired && !DB_URL) {
  describe("broadcast lease gate", () => {
    it("BROADCAST_LEASE_GATE=required but BROADCAST_TEST_DATABASE_URL is missing", () => {
      throw new Error("BROADCAST_LEASE_GATE=required but BROADCAST_TEST_DATABASE_URL is not set; refusing to certify");
    });
  });
}

describeDb("broadcast delivery leases (real PostgreSQL)", () => {
  let ownerId: string;
  let botId: string;
  const broadcastIds: string[] = [];

  beforeAll(async () => {
    // Cancel any due broadcasts left over from earlier (crashed) runs so
    // claim-scoped assertions see only this suite's rows.
    await sql`UPDATE broadcasts SET status = 'canceled' WHERE status IN ('scheduled', 'sending')`;
    const [user] = await sql`
      INSERT INTO users (email, display_name, status)
      VALUES (${`bcast-${Date.now()}@yourrank.test`}, 'bcast', 'active') RETURNING id`;
    ownerId = user.id;
    const token = await encryptToken("123:test-token");
    const [bot] = await sql`
      INSERT INTO bots (owner_id, token_encrypted, webhook_secret, status)
      VALUES (${ownerId}, ${token}, ${`wh-${Date.now()}-${crypto.randomUUID()}`}, 'active') RETURNING id`;
    botId = bot.id;
  });

  afterAll(async () => {
    if (broadcastIds.length) await sql`DELETE FROM broadcasts WHERE id IN ${sql(broadcastIds)}`;
    await sql`DELETE FROM bots WHERE id = ${botId}`;
    await sql`DELETE FROM users WHERE id = ${ownerId}`;
    await sql.end({ timeout: 1 });
  });

  const newBroadcast = async (cursor = 0, subs: number[] = []) => {
    // Subscribers belong to the bot, not a broadcast. Keep each scenario's
    // recipient set isolated so a prior test cannot become a later batch.
    await sql`DELETE FROM bot_subscribers WHERE bot_id = ${botId}`;
    const [row] = await sql`
      INSERT INTO broadcasts (bot_id, body, status, cursor_tg_user_id)
      VALUES (${botId}, 'hi {name}', 'scheduled', ${cursor}) RETURNING id`;
    broadcastIds.push(row.id);
    for (const tg of subs) {
      await sql`
        INSERT INTO bot_subscribers (bot_id, tg_user_id, first_name)
        VALUES (${botId}, ${tg}, ${`u${tg}`})`;
    }
    return row.id as string;
  };

  const state = async (id: string) => {
    const [row] = await sql`
      SELECT status, cursor_tg_user_id, sent_count, fail_count, processing_lease_token, processing_lease_expires_at
        FROM broadcasts WHERE id = ${id}`;
    return row;
  };

  const realFetch = globalThis.fetch;
  afterAll(() => { globalThis.fetch = realFetch; });

  it("holds an exclusive lease while a batch is in flight, then releases it so the next tick continues", async () => {
    const id = await newBroadcast(0, [501, 502]);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let sends = 0;
    globalThis.fetch = (async () => {
      sends++;
      if (sends === 1) await gate; // hold worker A inside its batch
      return new Response("{}", { status: 200 });
    }) as any;

    const workerA = processBroadcastBatch();
    let claimed = false;
    for (let i = 0; i < 100 && sends === 0; i++) {
      claimed = Boolean((await state(id)).processing_lease_token);
      if (sends === 0) await new Promise((r) => setTimeout(r, 20));
    }
    expect(claimed).toBe(true);
    expect(sends).toBe(1); // worker A is held inside the provider call

    // Worker B runs a full tick while A holds the lease: nothing claimable.
    expect(await processBroadcastBatch()).toBe(false);
    expect(sends).toBe(1); // only A's in-flight send

    release();
    await workerA;
    let after = await state(id);
    expect(after.status).toBe("sending"); // batch done, broadcast not drained yet
    expect(Number(after.cursor_tg_user_id)).toBe(502);
    expect(after.sent_count).toBe(2);
    expect(after.processing_lease_token).toBeNull(); // lease RELEASED at end of batch

    // Because the lease was released (not left to expire), the very next
    // tick finishes the broadcast instead of stalling ~10 minutes.
    expect(await processBroadcastBatch()).toBe(true);
    after = await state(id);
    expect(after.status).toBe("sent");
    expect(Number(after.cursor_tg_user_id)).toBe(502);
    expect(after.sent_count).toBe(2);
    expect(sends).toBe(2); // B and the completing tick sent nothing
    globalThis.fetch = realFetch;
  });

  it("reclaims a broadcast whose lease expired and completes it on the following tick", async () => {
    const id = await newBroadcast(0, [601]);
    globalThis.fetch = (async () => new Response("{}", { status: 200 })) as any;
    // Simulate a dead worker: lease taken, then expired in the past.
    await sql`
      UPDATE broadcasts
         SET status = 'sending', processing_lease_token = 'dead-worker',
             processing_lease_expires_at = now() - interval '1 minute'
       WHERE id = ${id}`;
    expect(await processBroadcastBatch()).toBe(true); // reclaims with a fresh token
    let after = await state(id);
    expect(after.processing_lease_token).not.toBe("dead-worker");
    expect(Number(after.cursor_tg_user_id)).toBe(601);
    expect(after.sent_count).toBe(1);
    expect(await processBroadcastBatch()).toBe(true); // drained -> completes
    after = await state(id);
    expect(after.status).toBe("sent");
    expect(after.processing_lease_token).toBeNull();
    globalThis.fetch = realFetch;
  });

  it("stops external sends and discards progress after its lease is stolen mid-batch", async () => {
    const id = await newBroadcast(600, [601, 602]);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let sends = 0;
    globalThis.fetch = (async () => {
      sends++;
      // Steal the lease during the first send, exactly like an expiry
      // reclaim by another tick would.
      await sql`
        UPDATE broadcasts
           SET processing_lease_token = 'new-owner', processing_lease_expires_at = now() + interval '5 minutes'
         WHERE id = ${id}`;
      await gate;
      return new Response("{}", { status: 200 });
    }) as any;

    const worker = processBroadcastBatch();
    let stolen = false;
    for (let i = 0; i < 100 && !stolen; i++) {
      stolen = (await state(id)).processing_lease_token === "new-owner";
      if (!stolen) await new Promise((r) => setTimeout(r, 20));
    }
    expect(stolen).toBe(true);
    release();
    await worker;

    // Recipient 601 was already in flight when ownership changed. The worker
    // must prove/renew ownership before 602, see that it is stale, and stop.
    // Every closing write is also discarded: cursor, counters and ownership
    // stay with the new owner's state.
    const after = await state(id);
    expect(sends).toBe(1);
    expect(after.processing_lease_token).toBe("new-owner");
    expect(Number(after.cursor_tg_user_id)).toBe(600);
    expect(after.sent_count).toBe(0);
    expect(after.fail_count).toBe(0);
    expect(after.status).toBe("sending");
    globalThis.fetch = realFetch;
  });

  it("leaves the cursor untouched when the FIRST recipient of a batch hits a 429", async () => {
    const id = await newBroadcast(700, [701, 702, 703]);
    let sends = 0;
    globalThis.fetch = (async () => {
      sends++;
      return new Response(JSON.stringify({ parameters: { retry_after: 0 } }), { status: 429 });
    }) as any;

    expect(await processBroadcastBatch()).toBe(true);
    expect(sends).toBe(1); // stopped immediately at the rate limit
    const after = await state(id);
    expect(Number(after.cursor_tg_user_id)).toBe(700); // NOT advanced past 701
    expect(after.sent_count).toBe(0);
    expect(after.fail_count).toBe(0);
    expect(after.status).toBe("sending");
    expect(after.processing_lease_token).toBeNull(); // claimable again next tick
    globalThis.fetch = realFetch;
  });
});
