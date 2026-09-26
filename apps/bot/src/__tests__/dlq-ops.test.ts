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

  it("tracks resolution columns instead of replayed_at for actionable state", async () => {
    for (const sql of Object.values(dlqSql)) {
      expect(sql).not.toContain("replayed_at IS NULL");
    }
    for (const key of ["claimOldest", "claimByIds", "expireExhausted"] as const) {
      expect(dlqSql[key]).toContain("resolved_at IS NULL");
    }
    expect(dlqSql.markReplayed).toContain("resolved_at = now(), resolution = 'replayed'");
    expect(dlqSql.markInvalid).toContain("resolved_at = now(), resolution = 'invalid'");
    expect(dlqSql.markSendFailed).toContain("resolution = CASE WHEN replay_attempts >= $4 THEN 'exhausted' END");
    expect(dlqSql.expireExhausted).toContain("resolution = 'exhausted'");
    expect(dlqSql.summary).toContain("resolution IS DISTINCT FROM 'replayed'");
    expect(dlqSql.page).toContain("resolved_at IS NULL");
    expect(dlqSql.pageTerminal).toContain("resolution IS DISTINCT FROM 'replayed'");
  });

  it("serves the page and summary through the admin route, with include_terminal switching the page", async () => {
    process.env.ADMIN_API_KEY = "test-admin-key";
    const queries: string[] = [];
    const queryImpl = async (text: string) => {
      queries.push(text);
      return [];
    };
    const app = buildHonoApp({ dlqDb: { queryImpl } });
    const get = (path: string) => app.request(`https://bot.example${path}`, {
      headers: { "x-api-key": "test-admin-key" },
    }, { RL_FAIL_OPEN: "true" });

    let response = await get("/api/dlq");
    expect(response.status).toBe(200);
    expect(queries[1]).toBe(dlqSql.page);

    queries.length = 0;
    response = await get("/api/dlq?include_terminal=1");
    expect(response.status).toBe(200);
    expect(queries[1]).toBe(dlqSql.pageTerminal);
    expect(queries[1]).not.toBe(dlqSql.page);
  });

  it("acknowledges actionable rows via a single atomic guarded statement", async () => {
    const sql = dlqSql.acknowledge;
    expect(sql).toContain("resolution = 'acknowledged'");
    expect(sql).toContain("resolved_at = now()");
    expect(sql).toContain("replay_state_changed_at = now()");
    expect(sql).toContain("replay_lease_token = NULL");
    expect(sql).toContain("replay_lease_expires_at = NULL");
    expect(sql).toContain("ack_reason = left($2");
    expect(sql).toContain("q.resolved_at IS NULL");
    expect(sql).toContain("q.replay_lease_expires_at < now()");
    // Resolution-only disposition: replay/delivery fields are never written.
    const setBlock = sql.slice(sql.indexOf("SET"), sql.indexOf("WHERE q.message_id"));
    expect(setBlock).not.toContain("replayed_at");
    expect(setBlock).not.toContain("last_replay_error");
    expect(setBlock).not.toContain("replay_attempts");
    expect(setBlock).not.toContain("body");
    expect(setBlock).not.toContain("replay_state =");
    expect(dlqSql.summary).toContain("resolution = 'acknowledged'");
  });

  it("validates acknowledge input without echoing ids", async () => {
    const { acknowledgeDlq, DlqAcknowledgeInputError } = await import("../dlq-ops.js");
    const db = { queryImpl: async () => [{ acknowledged: 1, already_acknowledged: 0, skipped_resolved: 0, skipped_leased: 0, unknown: 0 }] };
    const ids = Array.from({ length: 201 }, (_, i) => `id-${i}`);
    await expect(acknowledgeDlq({ messageIds: ids, reason: "ok_reason" }, db)).rejects.toBeInstanceOf(DlqAcknowledgeInputError);
    await expect(acknowledgeDlq({ messageIds: [], reason: "ok_reason" }, db)).rejects.toBeInstanceOf(DlqAcknowledgeInputError);
    await expect(acknowledgeDlq({ messageIds: ["SECRET_ID_X"], reason: "BAD REASON!" }, db)).rejects.toBeInstanceOf(DlqAcknowledgeInputError);
    await expect(acknowledgeDlq({ messageIds: ["ok-id"], reason: "x".repeat(201) }, db)).rejects.toBeInstanceOf(DlqAcknowledgeInputError);
    try {
      await acknowledgeDlq({ messageIds: ["SECRET_ID_X", "bad id!"], reason: "ok_reason" }, db);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(DlqAcknowledgeInputError);
      expect((err as Error).message).not.toContain("SECRET_ID_X");
      expect((err as Error).message).not.toContain("bad id!");
    }
    const result = await acknowledgeDlq({ messageIds: ["row-1"], reason: "stale_top3" }, db);
    expect(result).toEqual({ requested: 1, acknowledged: 1, already_acknowledged: 0, skipped_resolved: 0, skipped_leased: 0, unknown: 0 });
  });

  it("serves acknowledge through the authenticated admin route with counts only", async () => {
    process.env.ADMIN_API_KEY = "test-admin-key";
    const db = {
      queryImpl: async () => [{
        acknowledged: 2, already_acknowledged: 0, skipped_resolved: 1, skipped_leased: 0, unknown: 0,
      }],
    };
    const app = buildHonoApp({ dlqDb: db });
    const post = (body: unknown) => app.request("https://bot.example/api/dlq/acknowledge", {
      method: "POST",
      headers: { "x-api-key": "test-admin-key", "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }, { RL_FAIL_OPEN: "true" });

    expect((await post("not json")).status).toBe(400);
    expect((await post({ reason: "x" })).status).toBe(400);
    const bad = await post({ messageIds: ["ok"], reason: "BAD REASON!" });
    expect(bad.status).toBe(400);
    const response = await post({ messageIds: ["row-1", "row-2", "row-3"], reason: "stale_top3" });
    expect(response.status).toBe(200);
    const json = await response.json() as Record<string, unknown>;
    expect(json).toEqual({
      requested: 3, acknowledged: 2, already_acknowledged: 0,
      skipped_resolved: 1, skipped_leased: 0, unknown: 0,
    });
    expect(JSON.stringify(json)).not.toContain("row-");
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
