import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EVERY_MINUTE_CRON, NIGHTLY_CRON, isWebhookRecoveryTick } from "../cron-schedule.js";

describe("bot cron schedule", () => {
  it("runs webhook recovery only on 5-minute boundaries of the every-minute tick", () => {
    const base = Date.UTC(2026, 8, 3, 12, 0, 0);
    const minutes = Array.from({ length: 60 }, (_, m) => m);
    const recoveryMinutes = minutes.filter((m) => isWebhookRecoveryTick(base + m * 60_000));
    expect(recoveryMinutes).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
    // Same cadence the retired "*/5 * * * *" trigger delivered: 12 ticks per hour.
    expect(recoveryMinutes.length).toBe(12);
  });

  it("tolerates late delivery within the scheduled minute and rejects invalid timestamps", () => {
    expect(isWebhookRecoveryTick(Date.UTC(2026, 8, 3, 12, 5, 42))).toBe(true);
    expect(isWebhookRecoveryTick(Date.UTC(2026, 8, 3, 12, 6, 0))).toBe(false);
    expect(isWebhookRecoveryTick(Number.NaN)).toBe(false);
    expect(isWebhookRecoveryTick(undefined as unknown as number)).toBe(false);
  });

  it("matches the production wrangler.toml triggers (two Cron Triggers, no */5)", () => {
    const toml = readFileSync(resolve(import.meta.dir, "../../wrangler.toml"), "utf8");
    const production = toml.slice(0, toml.search(/^\s*\[env\./m));
    const crons = production.match(/^\s*crons\s*=\s*\[([^\]]*)\]/m)?.[1] ?? "";
    const list = [...crons.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(list).toEqual([EVERY_MINUTE_CRON, NIGHTLY_CRON]);
  });
});
