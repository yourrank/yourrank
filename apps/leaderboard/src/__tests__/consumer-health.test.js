import { describe, expect, it } from "bun:test";
import { evaluateConsumerHealth } from "../consumer-health.js";

describe("consumer health", () => {
  it("degrades for a recent failure without a later success", () => {
    const now = Date.parse("2026-08-24T12:00:00Z");
    const health = evaluateConsumerHealth({
      seconds_ago: 30,
      processed_count: "10",
      failed_count: "2",
      last_failure_at: "2026-08-24T11:55:00Z",
      last_success_at: "2026-08-24T11:50:00Z",
    }, now);
    expect(health.healthy).toBe(false);
  });

  it("does not grant unlimited grace to a consumer with zero processed work", () => {
    const health = evaluateConsumerHealth({
      seconds_ago: 3600,
      processed_count: "0",
      failed_count: "0",
      last_failure_at: null,
      last_success_at: null,
    }, Date.parse("2026-08-24T12:00:00Z"));
    expect(health.healthy).toBe(false);
    expect(health.stale).toBe(true);
    expect(health.heartbeat_source).toBe("traffic");
  });

  it("is healthy on a fresh scheduled heartbeat even without traffic", () => {
    const health = evaluateConsumerHealth({
      seconds_ago: 3600,
      scheduled_seconds_ago: 120,
      processed_count: "0",
      failed_count: "0",
      last_failure_at: null,
      last_success_at: null,
    }, Date.parse("2026-08-24T12:00:00Z"));
    expect(health.healthy).toBe(true);
    expect(health.heartbeat_source).toBe("scheduled");
  });

  it("prefers the scheduled heartbeat over recent queue traffic", () => {
    const health = evaluateConsumerHealth({
      seconds_ago: 5,
      scheduled_seconds_ago: 2000,
      processed_count: "10",
      failed_count: "0",
      last_failure_at: null,
      last_success_at: "2026-08-24T11:59:55Z",
    }, Date.parse("2026-08-24T12:00:00Z"));
    expect(health.healthy).toBe(false);
    expect(health.stale).toBe(true);
  });
});
