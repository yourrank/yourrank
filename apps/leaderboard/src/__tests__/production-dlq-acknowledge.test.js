import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { selectAcknowledgeIds } from "../../../../scripts/production-dlq-acknowledge-select.mjs";
import { verifyAcknowledgedCleanup } from "../../../../scripts/production-dlq-acknowledge-verify.mjs";

const rootFile = (path) => readFile(new URL(`../../../../${path}`, import.meta.url), "utf8");

const envelope = (changes) => ({
  v: 1,
  eventId: "SECRET_EVENT_ID",
  eventType: "notify",
  createdAt: "2026-01-01T00:00:00.000Z",
  correlationId: "SECRET_CORRELATION",
  payload: {
    type: "notify", kind: "top3", siteId: "SECRET_SITE_ID",
    siteName: "SENTINEL_SITE_NAME", changes,
  },
});

const top3Row = (i, overrides = {}) => ({
  message_id: `SENTINEL_MID_${i}`,
  queue_name: "q",
  event_type: "notify",
  replay_state: "pending",
  replay_attempts: 0,
  resolved_at: null,
  last_replay_error: null,
  received_at: `SENTINEL_RECEIVED_${i}`,
  body: envelope([{ name: `SENTINEL_PLAYER_${i}`, rank: 1, wagered: 0, score: 0, rankBy: "score" }]),
  ...overrides,
});

const pageOf = (n, mutate) => ({
  summary: [],
  rows: Array.from({ length: n }, (_, i) => {
    const row = top3Row(i);
    return mutate ? mutate(row, i) : row;
  }),
});

const expectRefusal = (page, expected) => {
  try {
    selectAcknowledgeIds(page, expected);
    expect.unreachable();
  } catch (err) {
    expect(err.message).toMatch(/^refused:/);
    for (const sentinel of ["SENTINEL", "SECRET"]) expect(err.message).not.toContain(sentinel);
    return err.message;
  }
};

describe("production DLQ acknowledge selector", () => {
  it("returns the ids when every actionable row matches the inspected profile", () => {
    const { messageIds } = selectAcknowledgeIds(pageOf(16), 16);
    expect(messageIds).toHaveLength(16);
  });

  it("refuses on any total other than expected", () => {
    expect(expectRefusal(pageOf(17), 16)).toContain("17 != expected 16");
    expect(expectRefusal(pageOf(0), 16)).toBeTruthy();
  });

  it("refuses when a row is not a Top-3 notify", () => {
    const page = pageOf(16, (row, i) => i === 5
      ? { ...row, event_type: "bump", body: { type: "bump", siteId: "SECRET_SITE_ID", field: "views", referer: null, timestamp: 1 } }
      : row);
    expect(expectRefusal(page, 16)).toContain("1 of 16");
  });

  it("refuses when a top3 row fails the current schema", () => {
    const page = pageOf(16, (row, i) => i === 3
      ? {
          ...row,
          body: envelope(Array.from({ length: 11 }, (_, j) => ({ name: `SENTINEL_PLAYER_${j}`, rank: 1, wagered: 0 }))),
        }
      : row);
    expect(expectRefusal(page, 16)).toContain("1 of 16");
  });

  it("refuses when a row is not pending or already resolved", () => {
    expect(expectRefusal(pageOf(16, (row, i) => i === 2 ? { ...row, replay_state: "replaying" } : row), 16)).toContain("1 of 16");
    expect(expectRefusal(pageOf(16, (row, i) => i === 2 ? { ...row, resolved_at: "SENTINEL_TS" } : row), 16)).toContain("1 of 16");
  });
});

describe("production DLQ acknowledge rerun verifier", () => {
  const REASON = "stale_top3_notification_after_schema_fix";
  const termRow = (i, overrides = {}) => ({
    message_id: `SENTINEL_MID_${i}`,
    replay_state: "invalid",
    resolved_at: "2026-01-01T00:00:00.000Z",
    resolution: "acknowledged",
    ack_reason: REASON,
    received_at: "SENTINEL_RECEIVED",
    ...overrides,
  });
  const termPage = (n, mutate) => ({
    summary: [],
    rows: Array.from({ length: n }, (_, i) => mutate ? mutate(termRow(i), i) : termRow(i)),
  });
  const expectVerifyRefusal = (page, expected = 16) => {
    try {
      verifyAcknowledgedCleanup(page, expected, REASON);
      expect.unreachable();
    } catch (err) {
      expect(err.message).toMatch(/^refused:/);
      for (const sentinel of ["SENTINEL", "SECRET", "other_reason", "stale_top3"]) {
        expect(err.message).not.toContain(sentinel);
      }
      return err.message;
    }
  };

  it("accepts a rerun page of fully acknowledged rows and reports counts", () => {
    const page = termPage(16, (row, i) => i === 0 ? { ...row, resolution: "invalid", ack_reason: null } : row);
    const counts = verifyAcknowledgedCleanup(termPage(15), 15, REASON);
    expect(counts).toEqual({ acknowledged: 15, acknowledged_with_reason: 15, actionable: 0, invalid: 0, exhausted: 0 });
    expect(verifyAcknowledgedCleanup(page, 15, REASON))
      .toMatchObject({ acknowledged: 15, invalid: 1, exhausted: 0 });
  });

  it("refuses when acknowledged count differs, reasons mismatch, or rows remain actionable", () => {
    expect(expectVerifyRefusal(termPage(15), 16)).toContain("15 != expected 16");
    // one acknowledged row carrying a different reason
    expect(expectVerifyRefusal(termPage(16, (row, i) => i === 4 ? { ...row, ack_reason: "other_reason" } : row)))
      .toContain("different ack_reason");
    // mixed resolutions do not count toward acknowledged
    expect(expectVerifyRefusal(termPage(15).rows.concat([termRow(99, { resolution: "invalid", ack_reason: null })])
      .reduce((p, r) => ({ rows: [...(p.rows ?? []), r] }), {}), 16)).toContain("15 != expected 16");
    expect(expectVerifyRefusal(termPage(15).rows.concat([termRow(99, { resolution: "exhausted", ack_reason: null })])
      .reduce((p, r) => ({ rows: [...(p.rows ?? []), r] }), {}), 16)).toContain("15 != expected 16");
    // an unresolved row is still actionable
    expect(expectVerifyRefusal(termPage(16, (row, i) => i === 7 ? { ...row, resolved_at: null, resolution: null, ack_reason: null } : row)))
      .toContain("still unresolved");
  });

  it("refuses an empty page and a possibly truncated page", () => {
    expect(expectVerifyRefusal({ rows: [] })).toBeTruthy();
    expect(expectVerifyRefusal({})).toBeTruthy();
    expect(expectVerifyRefusal(termPage(200))).toContain(">= limit");
  });
});

describe("production DLQ acknowledge workflow", () => {
  it("is guarded, production-gated, and never prints ids or bodies", async () => {
    const workflow = await rootFile(".github/workflows/production-dlq-acknowledge.yml");
    const on = workflow.match(/on:\n([\s\S]*?)(?=\npermissions:)/)[1];
    expect(on).toContain("workflow_dispatch");
    expect(on).not.toContain("pull_request");
    expect(on).not.toContain("push:");
    expect(on).toContain("expected_actionable");
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain("group: production-mutation");
    expect(workflow).toContain("secrets.PRODUCTION_ADMIN_API_KEY");
    expect(workflow).toContain("PRODUCTION_ADMIN_API_KEY is not configured");
    expect(workflow).not.toContain("/dlq/replay");
    expect(workflow).toContain('"$PRODUCTION_APEX/bot/api/dlq/acknowledge"');
    expect(workflow).not.toMatch(/curl[^\n]*\s[^\n]*\/dlq\/replay/);
    for (const run of workflow.match(/run: \|([\s\S]*?)(?=\n[ ]{6}- |\n {2}[a-z]|$)/g)) {
      expect(run).not.toMatch(/cat\s+"?\$RUNNER_TEMP\/(dlq|ack-request|ack-response)\.json/);
      expect(run).not.toMatch(/echo\s+.*ack-request\.json/);
      expect(run).not.toMatch(/jq\s+\.\s/);
    }
    // fresh / rerun mode gating
    expect(workflow).toContain("id: mode");
    expect(workflow).toContain("actionable total $COUNT is neither 0 nor expected $EXPECTED");
    const freshSteps = workflow.match(/if: steps\.mode\.outputs\.mode == 'fresh'/g);
    const rerunSteps = workflow.match(/if: steps\.mode\.outputs\.mode == 'rerun'/g);
    expect(freshSteps).toHaveLength(2);
    expect(rerunSteps).toHaveLength(2);
    // include_terminal appears only on the rerun terminal fetch, never the actionable fetch
    expect(workflow).toContain("/bot/api/dlq?limit=200&include_terminal=true");
    expect(workflow.match(/include_terminal=true/g)).toHaveLength(1);
    expect(workflow).not.toContain("include_body=true&include_terminal");
    // the unreachable already_acknowledged success branch is gone
    expect(workflow).not.toContain("idempotent re-run");
    expect(workflow).not.toContain("ALREADY");
    expect(workflow).toContain('acknowledged=$ACKED != expected=$EXPECTED');
    expect(workflow).toContain(".dlq.pending == 0");
    expect(workflow).toContain(".dlq.terminal.acknowledged == $expected");
    expect(workflow).not.toContain("upload-artifact");
  });
});
