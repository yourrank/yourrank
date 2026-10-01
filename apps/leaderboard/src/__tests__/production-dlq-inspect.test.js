import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { sanitizeDlqPage } from "../../../../scripts/production-dlq-inspect-sanitize.mjs";

const rootFile = (path) => readFile(new URL(`../../../../${path}`, import.meta.url), "utf8");

const envelope = (eventType, payload) => ({
  v: 1,
  eventId: "SECRET_EVENT_ID",
  eventType,
  createdAt: "2026-01-01T00:00:00.000Z",
  correlationId: "SECRET_CORRELATION",
  payload,
});

const top3Payload = (changes) => ({
  type: "notify",
  kind: "top3",
  siteId: "SECRET_SITE_ID",
  siteName: "SENTINEL_SITE_NAME",
  changes,
});

const tiedChanges = (n) => Array.from({ length: n }, (_, i) => ({
  name: `SENTINEL_PLAYER_${i}`, rank: 1, amount: 0, score: 0, rankBy: "score",
}));

const bumpEnvelope = () => envelope("bump", {
  type: "bump",
  siteId: "SECRET_SITE_ID",
  field: "views",
  referer: null,
  visitorHash: "SECRET_HASH",
  timestamp: 1,
});

export const fixture = {
  summary: [{
    event_type: "notify", pending: 3, invalid: 1, exhausted: 0,
    max_attempts: 3, oldest_received_at: "SENTINEL_OLDEST_TS",
  }],
  rows: [
    {
      message_id: "SENTINEL_MID_1", queue_name: "q", event_type: "notify",
      replay_state: "pending", replay_attempts: 0, last_replay_error: null,
      received_at: "SENTINEL_RECEIVED_1",
      body: envelope("notify", top3Payload(tiedChanges(2).slice(0, 1))),
    },
    {
      message_id: "SENTINEL_MID_2", queue_name: "q", event_type: "notify",
      replay_state: null, replay_attempts: 0, last_replay_error: null,
      received_at: "SENTINEL_RECEIVED_2",
      body: envelope("notify", top3Payload(tiedChanges(1))),
    },
    {
      message_id: "SENTINEL_MID_3", queue_name: "q", event_type: "notify",
      replay_state: "pending", replay_attempts: 0, last_replay_error: null,
      received_at: "SENTINEL_RECEIVED_3",
      body: {
        type: "notify", kind: "top3", siteId: "SECRET_SITE_ID",
        siteName: "SENTINEL_SITE_NAME",
        changes: tiedChanges(11).map(({ name, rank, amount }) => ({ name, rank, amount })),
      },
    },
    {
      message_id: "SENTINEL_MID_4", queue_name: "q", event_type: "bump",
      replay_state: "pending", replay_attempts: 0, last_replay_error: null,
      received_at: "SENTINEL_RECEIVED_4", body: bumpEnvelope(),
    },
    {
      message_id: "SENTINEL_MID_5", queue_name: "q", event_type: "bump",
      replay_state: "invalid", replay_attempts: 1,
      last_replay_error: JSON.stringify([{
        code: "unrecognized_keys", keys: ["score", "rankBy"],
        path: ["payload", "changes", 0],
        message: "Unrecognized key(s): SENTINEL_ERROR_DETAIL",
      }]),
      received_at: "SENTINEL_RECEIVED_5", body: bumpEnvelope(),
    },
    {
      message_id: "SENTINEL_MID_6", queue_name: "q", event_type: "bump",
      replay_state: "pending", replay_attempts: 1,
      last_replay_error: "fetch https://secret.example/token?x=SENTINEL failed",
      received_at: "SENTINEL_RECEIVED_6", body: bumpEnvelope(),
    },
  ],
};

describe("production DLQ inspect sanitizer", () => {
  const output = sanitizeDlqPage(fixture);

  it("reports grouped counts across replay states, event types, and schema validity", () => {
    expect(output.total_actionable).toBe(6);
    expect(output.by_replay_state).toEqual(expect.arrayContaining([
      { state: "pending", count: 5 },
      { state: "invalid", count: 1 },
    ]));
    expect(output.event_types).toEqual(expect.arrayContaining([
      { event_type: "notify", count: 3 },
      { event_type: "bump", count: 3 },
    ]));
    expect(output.envelope_vs_legacy).toEqual({ envelope: 5, legacy: 1, unknown: 0 });
    expect(output.current_schema).toEqual({ valid: 5, invalid: 1 });
    expect(output.other_count).toBe(3);
    expect(output.safe_to_replay_count).toBe(4);
  });

  it("classifies error kinds and aggregates Zod signatures without error text", () => {
    expect(output.error_kinds).toEqual(expect.arrayContaining([
      { error_kind: "none", count: 4 },
      { error_kind: "zod_validation", count: 1 },
      { error_kind: "send_failure", count: 1 },
    ]));
    expect(output.zod_issue_signatures).toEqual([{
      code: "unrecognized_keys",
      path: "payload.changes.0",
      unrecognized_keys: ["score", "rankBy"],
      count: 1,
    }]);
  });

  it("profiles top3 notify rows including schema drift", () => {
    expect(output.top3_notify.compatible_count).toBe(2);
    expect(output.top3_notify.schema_drift_rows).toBe(1);
    expect(output.top3_notify.current_schema_valid).toBe(false);
    expect(output.top3_notify.with_score).toBe(2);
    expect(output.top3_notify.with_rankBy).toBe(2);
    expect(output.top3_notify.change_item_key_sets).toEqual(expect.arrayContaining([
      { keys: "amount,name,rank,rankBy,score", count: 2 },
      { keys: "amount,name,rank", count: 1 },
    ]));
  });

  it("passes the API summary through minus timestamps, and emits no secrets", () => {
    expect(output.summary).toEqual([{
      event_type: "notify", pending: 3, invalid: 1, exhausted: 0, max_attempts: 3,
    }]);
    const serialized = JSON.stringify(output);
    for (const sentinel of [
      "SENTINEL", "SECRET_", "secret.example",
      "last_replay_error", "message_id", "received_at",
    ]) {
      expect(serialized).not.toContain(sentinel);
    }
  });
});

describe("production DLQ inspect workflow", () => {
  it("is read-only, production-gated, and never prints raw rows", async () => {
    const workflow = await rootFile(".github/workflows/production-dlq-inspect.yml");
    const on = workflow.match(/on:\n([\s\S]*?)(?=\n[a-z])/)[1];
    expect(on).toContain("workflow_dispatch");
    expect(on).not.toContain("pull_request");
    expect(on).not.toContain("push:");
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain("group: production-mutation");
    expect(workflow).toContain("secrets.PRODUCTION_ADMIN_API_KEY");
    expect(workflow).toContain("PRODUCTION_ADMIN_API_KEY is not configured");
    const curl = workflow.match(/curl[\s\S]*?dlq\.json/g).join("\n");
    expect(curl).toContain("/bot/api/dlq?limit=200&include_body=true");
    expect(curl).not.toContain("-X POST");
    expect(curl).not.toContain("/replay");
    expect(curl).not.toContain("--data");
    expect(workflow).not.toContain("include_terminal");
    for (const run of workflow.match(/run: \|([\s\S]*?)(?=\n[ ]{6}- |\n {2}[a-z]|$)/g)) {
      expect(run).not.toMatch(/cat\s+"?\$RUNNER_TEMP\/dlq\.json/);
      expect(run).not.toMatch(/jq\s+\.[^a-z]/);
    }
    expect(workflow).not.toContain("upload-artifact");
  });
});
