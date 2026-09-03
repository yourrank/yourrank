// ============================================================================
//  F-050/F-051: DLQ replay leases against a real PostgreSQL.
//
//  FOR UPDATE SKIP LOCKED claims, lease expiry/reclaim, bounded attempts,
//  terminal invalid rows and identity preservation are exercised with real
//  transactions and concurrent callers. Needs the migrated schema
//  (DLQ_TEST_DATABASE_URL); when DLQ_REPLAY_GATE=required the suite FAILS
//  without a database instead of skipping.
// ============================================================================

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { replayDlq } from "../dlq-ops.js";

const DB_URL = process.env.DLQ_TEST_DATABASE_URL;
const gateRequired = process.env.DLQ_REPLAY_GATE === "required";
const describeDb = DB_URL ? describe : describe.skip;
const sql = DB_URL ? postgres(DB_URL, { max: 8, onnotice: () => {} }) : (null as never);

if (gateRequired && !DB_URL) {
  describe("dlq replay gate", () => {
    it("DLQ_REPLAY_GATE=required but DLQ_TEST_DATABASE_URL is missing", () => {
      throw new Error("DLQ_REPLAY_GATE=required but DLQ_TEST_DATABASE_URL is not set; refusing to certify");
    });
  });
}

// Each caller gets its own connection so lease contention is real.
const execFor = (client: ReturnType<typeof postgres>) =>
  async (text: string, params: unknown[] = []) => (await client.unsafe(text, params as never[])).map((r) => ({ ...r }));

const clickPayload = {
  type: "click",
  shortLinkId: "11111111-1111-4111-8111-111111111111",
  ipHash: "a".repeat(64),
  clickRef: "ref-1",
  tgUserId: null,
  timestamp: 1,
};
const envelope = (eventId: string) => ({
  v: 1,
  eventId,
  eventType: "click",
  createdAt: "2026-09-01T00:00:00.000Z",
  correlationId: "req-dlq",
  payload: clickPayload,
});

describeDb("DLQ replay leases (real PostgreSQL)", () => {
  const prefix = `dlq-pg-${Date.now()}`;
  const ids: string[] = [];
  const newRow = async (body: unknown, extra: Record<string, unknown> = {}) => {
    const messageId = `${prefix}-${ids.length}`;
    ids.push(messageId);
    const eventId = body && typeof body === "object" && "eventId" in body ? String((body as { eventId: string }).eventId) : null;
    const correlationId = body && typeof body === "object" && "correlationId" in body
      ? String((body as { correlationId: string }).correlationId) : null;
    await sql`
      INSERT INTO queue_dlq_events ${sql({
        message_id: messageId,
        queue_name: "yourrank-events-dlq",
        event_type: "click",
        body: sql.json(body as never),
        event_id: eventId,
        correlation_id: correlationId,
        ...extra,
      })}`;
    return messageId;
  };
  const rowState = async (id: string) => {
    const [row] = await sql`
      SELECT replay_state, replay_attempts, replay_lease_token, replayed_at IS NOT NULL AS replayed, event_id, correlation_id, body
      FROM queue_dlq_events WHERE message_id = ${id}`;
    return row;
  };

  afterEach(async () => {
    if (ids.length) await sql`DELETE FROM queue_dlq_events WHERE message_id IN ${sql(ids)}`;
    ids.length = 0;
  });
  afterAll(async () => {
    await sql.end({ timeout: 1 });
  });

  it("replays an envelope unchanged, preserving eventId and correlationId end to end", async () => {
    const eventId = crypto.randomUUID();
    const id = await newRow(envelope(eventId));
    const sent: unknown[] = [];
    const result = await replayDlq({ messageIds: [id], sendImpl: async (body) => { sent.push(body); } }, { execImpl: execFor(sql) });
    expect(result.replayed.ids).toEqual([id]);
    expect(sent).toEqual([envelope(eventId)]);
    const row = await rowState(id);
    expect(row).toMatchObject({ replay_state: "replayed", replay_attempts: 1, replay_lease_token: null, replayed: true, event_id: eventId, correlation_id: "req-dlq" });
    expect(row.body.eventId).toBe(eventId);
  });

  it("lets exactly one of two concurrent callers win the lease for a row", async () => {
    const id = await newRow(envelope(crypto.randomUUID()));
    const a = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    const b = postgres(DB_URL!, { max: 1, onnotice: () => {} });
    const sends: string[] = [];
    try {
      const slowSend = (tag: string) => async () => { sends.push(tag); await new Promise((r) => setTimeout(r, 100)); };
      const [ra, rb] = await Promise.all([
        replayDlq({ messageIds: [id], sendImpl: slowSend("a") }, { execImpl: execFor(a) }),
        replayDlq({ messageIds: [id], sendImpl: slowSend("b") }, { execImpl: execFor(b) }),
      ]);
      expect(ra.replayed.count + rb.replayed.count).toBe(1);
      expect(ra.skipped.count + rb.skipped.count).toBe(1);
      expect(sends).toHaveLength(1);
      expect((await rowState(id)).replay_attempts).toBe(1);
    } finally {
      await a.end({ timeout: 1 });
      await b.end({ timeout: 1 });
    }
  });

  it("reclaims an expired lease, re-sends the identical body and completes with the new token only", async () => {
    const eventId = crypto.randomUUID();
    const id = await newRow(envelope(eventId), {
      replay_state: "replaying",
      replay_lease_token: "stale-token",
      replay_lease_expires_at: sql`now() - interval '1 minute'`,
      replay_attempts: 1,
    });
    const sent: unknown[] = [];
    const result = await replayDlq({ messageIds: [id], sendImpl: async (body) => { sent.push(body); } }, { execImpl: execFor(sql) });
    expect(result.reclaimed.ids).toEqual([id]);
    expect(result.replayed.ids).toEqual([id]);
    expect(sent).toEqual([envelope(eventId)]);
    expect(await rowState(id)).toMatchObject({ replay_state: "replayed", replay_attempts: 2, event_id: eventId });
  });

  it("does not reclaim a lease that is still live", async () => {
    const id = await newRow(envelope(crypto.randomUUID()), {
      replay_state: "replaying",
      replay_lease_token: "live-token",
      replay_lease_expires_at: sql`now() + interval '5 minutes'`,
      replay_attempts: 1,
    });
    const result = await replayDlq({ messageIds: [id], sendImpl: async () => { throw new Error("must not send"); } }, { execImpl: execFor(sql) });
    expect(result.skipped.ids).toEqual([id]);
    expect(await rowState(id)).toMatchObject({ replay_state: "replaying", replay_lease_token: "live-token", replay_attempts: 1 });
  });

  it("marks an unparseable body terminal invalid instead of replaying it again", async () => {
    const id = await newRow({ type: "not-a-real-event", junk: true });
    const exec = execFor(sql);
    const first = await replayDlq({ messageIds: [id], sendImpl: async () => { throw new Error("must not send"); } }, { execImpl: exec });
    expect(first.invalid.ids).toEqual([id]);
    expect((await rowState(id)).replay_state).toBe("invalid");
    const second = await replayDlq({ messageIds: [id], sendImpl: async () => { throw new Error("must not send"); } }, { execImpl: exec });
    expect(second.skipped.ids).toEqual([id]);
    expect(second.invalid.count).toBe(0);
  });

  it("enforces max attempts: send failures return to pending until the budget is spent, then terminal failed", async () => {
    const id = await newRow(envelope(crypto.randomUUID()));
    const exec = execFor(sql);
    const failing = { messageIds: [id], maxAttempts: 2, sendImpl: async () => { throw new Error("queue down"); } };
    const r1 = await replayDlq(failing, { execImpl: exec });
    expect(r1.failed.ids).toEqual([id]);
    expect(await rowState(id)).toMatchObject({ replay_state: "pending", replay_attempts: 1 });
    const r2 = await replayDlq(failing, { execImpl: exec });
    expect(r2.failed.ids).toEqual([id]);
    expect(await rowState(id)).toMatchObject({ replay_state: "failed", replay_attempts: 2 });
    const r3 = await replayDlq(failing, { execImpl: exec });
    expect(r3.skipped.ids).toEqual([id]);
    expect((await rowState(id)).replay_attempts).toBe(2);
  });

  it("caps attempts under concurrent reclaim: an exhausted expired lease becomes terminal failed", async () => {
    const id = await newRow(envelope(crypto.randomUUID()), {
      replay_state: "replaying",
      replay_lease_token: "stale",
      replay_lease_expires_at: sql`now() - interval '1 minute'`,
      replay_attempts: 3,
    });
    const clients = [1, 2, 3].map(() => postgres(DB_URL!, { max: 1, onnotice: () => {} }));
    try {
      const results = await Promise.all(clients.map((c) =>
        replayDlq({ messageIds: [id], maxAttempts: 3, sendImpl: async () => { throw new Error("must not send"); } }, { execImpl: execFor(c) })));
      expect(results.reduce((n, r) => n + r.exhausted.count, 0)).toBe(1);
      expect(results.reduce((n, r) => n + r.replayed.count + r.failed.count + r.reclaimed.count, 0)).toBe(0);
      expect(await rowState(id)).toMatchObject({ replay_state: "failed", replay_attempts: 3, replay_lease_token: null });
    } finally {
      await Promise.all(clients.map((c) => c.end({ timeout: 1 })));
    }
  });

  it("replays a legacy flat body unchanged (limited to delivery-level identity)", async () => {
    const id = await newRow(clickPayload);
    const sent: unknown[] = [];
    const result = await replayDlq({ messageIds: [id], sendImpl: async (body) => { sent.push(body); } }, { execImpl: execFor(sql) });
    expect(result.replayed.ids).toEqual([id]);
    expect(sent).toEqual([clickPayload]);
    expect(await rowState(id)).toMatchObject({ replay_state: "replayed", event_id: null });
  });
});
