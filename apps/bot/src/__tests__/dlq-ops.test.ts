import { afterEach, describe, expect, it } from "bun:test";
import { buildHonoApp } from "../hono-app.js";
import { dlqSql, replayDlq, type DlqReplayResult } from "../dlq-ops.js";

const validEvent = {
  type: "click",
  shortLinkId: "link-1",
  ipHash: "a".repeat(64),
  tgUserId: null,
  clickRef: "click-1",
  timestamp: 1,
};

const envelope = {
  v: 1,
  eventId: "11111111-1111-4111-8111-111111111111",
  eventType: "click",
  createdAt: "2026-09-01T00:00:00.000Z",
  correlationId: "req-abc",
  payload: validEvent,
};

const row = (body: unknown = validEvent, extra: Record<string, unknown> = {}) => ({
  message_id: "message-1",
  queue_name: "yourrank-events",
  event_type: "click",
  body,
  replay_attempts: 1,
  event_id: null,
  correlation_id: null,
  reclaimed: false,
  ...extra,
});

const empty = (over: Partial<DlqReplayResult> = {}): DlqReplayResult => ({
  replayed: { count: 0, ids: [] },
  invalid: { count: 0, ids: [] },
  skipped: { count: 0, ids: [] },
  failed: { count: 0, ids: [] },
  reclaimed: { count: 0, ids: [] },
  exhausted: { count: 0, ids: [] },
  ...over,
});

// Routes exec calls by statement so tests assert the state machine rather
// than a positional call sequence.
function fakeDb(handlers: Partial<Record<keyof typeof dlqSql, (params?: unknown[]) => unknown[]>>) {
  const calls: { sql: keyof typeof dlqSql; params?: unknown[] }[] = [];
  const execImpl = async (text: string, params?: unknown[]) => {
    const key = (Object.keys(dlqSql) as (keyof typeof dlqSql)[]).find((k) => dlqSql[k] === text);
    if (!key) throw new Error(`unexpected SQL: ${text.slice(0, 60)}`);
    calls.push({ sql: key, params });
    return handlers[key]?.(params) ?? [];
  };
  return { calls, execImpl };
}

function captureErrors() {
  const logs: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args) => { logs.push(args); };
  return { logs, restore: () => { console.error = originalError; } };
}

afterEach(() => {
  delete process.env.ADMIN_API_KEY;
});

describe("DLQ replay operations", () => {
  it("claims with an exclusive lease, re-sends the body verbatim and completes via compare-and-set", async () => {
    const db = fakeDb({
      claimOldest: () => [row()],
      markReplayed: (p) => [{ message_id: p?.[0] }],
    });
    const sent: unknown[] = [];
    const result = await replayDlq({
      leaseToken: "lease-1",
      sendImpl: async (body) => { sent.push(body); },
    }, db);

    expect(result).toEqual(empty({ replayed: { count: 1, ids: ["message-1"] } }));
    expect(sent).toEqual([validEvent]);
    expect(db.calls.map((c) => c.sql)).toEqual(["expireExhausted", "claimOldest", "markReplayed"]);
    expect(db.calls[1].params).toEqual([3, 10, "lease-1"]);
    expect(db.calls[2].params).toEqual(["message-1", "lease-1"]);
    expect(dlqSql.claimOldest).toContain("FOR UPDATE SKIP LOCKED");
    expect(dlqSql.markReplayed).toContain("replay_lease_token = $2");
  });

  it("preserves the envelope eventId/correlationId on replay and logs identity only", async () => {
    const db = fakeDb({
      claimOldest: () => [row(envelope, { event_id: envelope.eventId, correlation_id: "req-abc" })],
      markReplayed: (p) => [{ message_id: p?.[0] }],
    });
    const sent: unknown[] = [];
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (line) => { logs.push(String(line)); };
    try {
      await replayDlq({ sendImpl: async (body) => { sent.push(body); } }, db);
    } finally {
      console.log = originalLog;
    }
    expect(sent).toEqual([envelope]);
    const replayed = logs.map((l) => JSON.parse(l)).find((l) => l.outcome === "replayed");
    expect(replayed).toMatchObject({ event_id: envelope.eventId, correlation_id: "req-abc", event_type: "click" });
    expect(JSON.stringify(replayed)).not.toContain(validEvent.ipHash);
  });

  it("marks invalid bodies terminal without sending them", async () => {
    const db = fakeDb({
      claimOldest: () => [row({ type: "not-a-queue-event" })],
      markInvalid: (p) => [{ message_id: p?.[0] }],
    });
    const sent: unknown[] = [];
    const cap = captureErrors();
    let result;
    try {
      result = await replayDlq({ leaseToken: "lease-1", sendImpl: async (body) => { sent.push(body); } }, db);
    } finally {
      cap.restore();
    }

    expect(result).toEqual(empty({ invalid: { count: 1, ids: ["message-1"] } }));
    expect(sent).toEqual([]);
    expect(db.calls.map((c) => c.sql)).toEqual(["expireExhausted", "claimOldest", "markInvalid"]);
    expect(db.calls[2].params?.slice(0, 2)).toEqual(["message-1", "lease-1"]);
    expect(dlqSql.markInvalid).toContain("replay_state = 'invalid'");
    const invalidLog = cap.logs.map((l) => JSON.parse(String(l[0]))).find((l) => l.outcome === "terminal_invalid");
    expect(invalidLog).toMatchObject({ ctx: "dlq-replay", message_id: "message-1" });
  });

  it("only claims pending or lease-expired rows below maxAttempts", async () => {
    const db = fakeDb({});
    const result = await replayDlq({ limit: 10, maxAttempts: 3, sendImpl: async () => {} }, db);

    expect(result).toEqual(empty());
    expect(dlqSql.claimOldest).toContain("replay_attempts < $1");
    expect(dlqSql.claimOldest).toContain("COALESCE(replay_state, 'pending') = 'pending'");
    expect(dlqSql.claimOldest).toContain("replay_lease_expires_at < now()");
    expect(db.calls[0]).toMatchObject({ sql: "expireExhausted", params: [3] });
    expect(db.calls[1].params?.slice(0, 2)).toEqual([3, 10]);
  });

  it("reports rows another caller holds as skipped", async () => {
    const db = fakeDb({ claimByIds: () => [] });
    const sent: unknown[] = [];
    const result = await replayDlq({
      messageIds: ["message-1"],
      sendImpl: async (body) => { sent.push(body); },
    }, db);

    expect(result).toEqual(empty({ skipped: { count: 1, ids: ["message-1"] } }));
    expect(sent).toEqual([]);
    expect(db.calls[1]).toMatchObject({ sql: "claimByIds" });
    expect(db.calls[1].params?.[3]).toEqual(["message-1"]);
  });

  it("returns a failed send to pending while attempts remain", async () => {
    const db = fakeDb({
      claimOldest: () => [row()],
      markSendFailed: () => [{ replay_state: "pending" }],
    });
    const cap = captureErrors();
    let result;
    try {
      result = await replayDlq({ sendImpl: async () => { throw new Error("queue unavailable"); } }, db);
    } finally {
      cap.restore();
    }

    expect(result).toEqual(empty({ failed: { count: 1, ids: ["message-1"] } }));
    expect(db.calls.map((c) => c.sql)).toEqual(["expireExhausted", "claimOldest", "markSendFailed"]);
    expect(dlqSql.markSendFailed).toContain("THEN 'failed' ELSE 'pending'");
    const failedLog = cap.logs.map((l) => JSON.parse(String(l[0]))).find((l) => l.outcome === "failed");
    expect(failedLog).toMatchObject({ ctx: "dlq-replay", message_id: "message-1", error: "queue unavailable" });
  });

  it("makes exhausted attempts terminal", async () => {
    const db = fakeDb({
      expireExhausted: () => [{ message_id: "stale-1" }],
      claimOldest: () => [row(validEvent, { replay_attempts: 3 })],
      markSendFailed: () => [{ replay_state: "failed" }],
    });
    const cap = captureErrors();
    let result;
    try {
      result = await replayDlq({ maxAttempts: 3, sendImpl: async () => { throw new Error("still broken"); } }, db);
    } finally {
      cap.restore();
    }
    expect(result).toEqual(empty({
      failed: { count: 1, ids: ["message-1"] },
      exhausted: { count: 1, ids: ["stale-1"] },
    }));
    const outcomes = cap.logs.map((l) => JSON.parse(String(l[0])).outcome);
    expect(outcomes.filter((o) => o === "terminal_failed")).toHaveLength(2);
  });

  it("reclaims an expired lease and reports a lost lease after send as skipped", async () => {
    const db = fakeDb({
      claimOldest: () => [row(envelope, { reclaimed: true, event_id: envelope.eventId })],
      markReplayed: () => [],
    });
    const cap = captureErrors();
    let result;
    try {
      result = await replayDlq({ sendImpl: async () => {} }, db);
    } finally {
      cap.restore();
    }
    expect(result).toEqual(empty({
      reclaimed: { count: 1, ids: ["message-1"] },
      skipped: { count: 1, ids: ["message-1"] },
    }));
    const outcomes = cap.logs.map((l) => JSON.parse(String(l[0])).outcome);
    expect(outcomes).toContain("lease_reclaimed");
    expect(outcomes).toContain("lease_lost_after_send");
  });

  it("serves replay through the authenticated admin route", async () => {
    process.env.ADMIN_API_KEY = "test-admin-key";
    const sent: unknown[] = [];
    const db = fakeDb({
      claimOldest: () => [row()],
      markReplayed: (p) => [{ message_id: p?.[0] }],
    });
    const app = buildHonoApp({ dlqDb: { execImpl: db.execImpl } });
    const response = await app.request("https://bot.example/api/dlq/replay", {
      method: "POST",
      headers: {
        "x-api-key": "test-admin-key",
        "content-type": "application/json",
      },
      body: JSON.stringify({ limit: 1 }),
    }, {
      RL_FAIL_OPEN: "true",
      EVENTS_QUEUE: { send: async (body) => { sent.push(body); } },
    });

    expect(response.status).toBe(200);
    expect(await response.json() as any).toEqual(empty({ replayed: { count: 1, ids: ["message-1"] } }));
    expect(sent).toEqual([validEvent]);
  });
});
