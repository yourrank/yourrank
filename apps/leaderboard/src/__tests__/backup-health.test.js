import { describe, expect, it } from "bun:test";
import { backupVerificationLimitHours, handleBackupHealth } from "../handlers/backup.js";

describe("backup restore health", () => {
  it("uses the Worker environment threshold and validates invalid values", () => {
    expect(backupVerificationLimitHours({ BACKUP_VERIFICATION_LIMIT_HOURS: "24" })).toBe(24);
    expect(backupVerificationLimitHours({ BACKUP_VERIFICATION_LIMIT_HOURS: "invalid" })).toBe(168);
  });

  it("fails closed when no successful restore drill has been recorded", async () => {
    const response = await handleBackupHealth(new Request("https://test.com/api/health/backup"), {}, {
      one: () => Promise.resolve(null),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false });
  });

  it("applies a configured freshness limit", async () => {
    const response = await handleBackupHealth(
      new Request("https://test.com/api/health/backup"),
      { BACKUP_VERIFICATION_LIMIT_HOURS: "1" },
      { one: () => Promise.resolve({ completed_at: new Date(Date.now() - 2 * 3600_000), provider: "test", target: "scratch" }) },
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("Limit is 1 hour");
  });
});
