import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// The release runs the preflight from `apps/monitor` (working-directory) as
// `node ../../scripts/monitor-preflight.mjs production`; it must locate the
// Wrangler config from the repository root regardless of the caller's cwd.
const monitorDir = resolve(import.meta.dir, "../..");
const repoRoot = resolve(monitorDir, "../..");
const script = resolve(repoRoot, "scripts/monitor-preflight.mjs");

function run(cwd: string, env: Record<string, string>) {
  const result = spawnSync(process.execPath, [script, "production"], {
    cwd,
    env: { PATH: process.env.PATH ?? "", ...env },
    encoding: "utf8",
  });
  return { code: result.status, out: `${result.stdout}\n${result.stderr}` };
}

const configured = {
  MONITOR_CHECK_SECRET_PRESENT: "true",
  WORKER_SECRET_LIST: JSON.stringify([{ name: "MONITOR_CHECK_SECRET" }, { name: "DISCORD_MONITORING_WEBHOOK" }]),
};

describe("monitor-preflight.mjs", () => {
  it("passes from apps/monitor and from the repository root when the contract is satisfied", () => {
    for (const cwd of [monitorDir, repoRoot]) {
      const { code, out } = run(cwd, configured);
      expect(out).not.toContain("ENOENT");
      expect(out).toContain("Monitor preflight OK (production)");
      expect(code).toBe(0);
    }
  });

  it("fails closed when the GitHub environment lacks MONITOR_CHECK_SECRET", () => {
    const { code, out } = run(monitorDir, { MONITOR_CHECK_SECRET_PRESENT: "false", WORKER_SECRET_LIST: "[]" });
    expect(code).toBe(1);
    expect(out).toContain("MONITOR_CHECK_SECRET is not set");
    expect(out).toContain("no alert path is configured");
  });
});
