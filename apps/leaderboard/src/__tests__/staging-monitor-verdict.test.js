import { describe, expect, it } from "bun:test";
import { evaluateStagingMonitorChecks } from "../../../../scripts/staging-monitor-verdict.mjs";

const stagingHealthBody = {
  status: "degraded",
  db: true,
  db_identity: { expected: true },
  email_verification: { required: false, configured: true },
  dlq: { degraded_reasons: [] },
  consumer: { healthy: false, heartbeat_source: "traffic" },
};

const allOk = [
  { name: "GET /health", status: 200, ok: true },
  { name: "GET /api/health/backup", status: 200, ok: true },
  { name: "GET /r/smoke-probe-ci", status: 302, ok: true },
];

describe("evaluateStagingMonitorChecks", () => {
  it("passes when every check is ok", () => {
    const verdict = evaluateStagingMonitorChecks(allOk, stagingHealthBody);
    expect(verdict.ok).toBe(true);
    expect(verdict.problems).toEqual([]);
    expect(verdict.tolerated).toEqual([]);
  });

  it("tolerates a 503 backup check", () => {
    const verdict = evaluateStagingMonitorChecks(
      [...allOk, { name: "GET /api/health/backup", status: 503, ok: false }],
      stagingHealthBody,
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.tolerated[0]).toContain("GET /api/health/backup");
  });

  it("tolerates a 503 /health check when the only degradation is the consumer heartbeat", () => {
    const verdict = evaluateStagingMonitorChecks(
      [
        { name: "GET /api/health/backup", status: 200, ok: true },
        { name: "GET /health", status: 503, ok: false },
      ],
      stagingHealthBody,
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.tolerated[0]).toContain("GET /health");
  });

  it("does not tolerate /health 503 when db is unhealthy", () => {
    const verdict = evaluateStagingMonitorChecks(
      [{ name: "GET /health", status: 503, ok: false }],
      { ...stagingHealthBody, db: false },
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.problems[0]).toContain("db is not true");
  });

  it("does not tolerate /health 503 when dlq has degraded reasons", () => {
    const verdict = evaluateStagingMonitorChecks(
      [{ name: "GET /health", status: 503, ok: false }],
      { ...stagingHealthBody, dlq: { degraded_reasons: ["oldest_unresolved_age"] } },
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.problems[0]).toContain("dlq.degraded_reasons");
  });

  it("does not tolerate /health 503 when db_identity is unexpected", () => {
    const verdict = evaluateStagingMonitorChecks(
      [{ name: "GET /health", status: 503, ok: false }],
      { ...stagingHealthBody, db_identity: { expected: false } },
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.problems[0]).toContain("db_identity.expected");
  });

  it("does not tolerate /health 503 when status is not degraded", () => {
    const verdict = evaluateStagingMonitorChecks(
      [{ name: "GET /health", status: 503, ok: false }],
      { ...stagingHealthBody, status: "ok" },
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.problems[0]).toContain('status is "ok"');
  });

  it("reports unrelated failing checks as problems", () => {
    const verdict = evaluateStagingMonitorChecks(
      [...allOk, { name: "GET /r/smoke-probe-ci", status: 500, ok: false, error: "boom" }],
      stagingHealthBody,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.problems).toEqual(["GET /r/smoke-probe-ci: status 500 boom"]);
  });

  it("fails on an empty checks array", () => {
    const verdict = evaluateStagingMonitorChecks([], stagingHealthBody);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems[0]).toContain("empty");
  });
});
