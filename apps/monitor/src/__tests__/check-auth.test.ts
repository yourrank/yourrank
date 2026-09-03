import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import worker, {
  authorizeCheck,
  backupCheckPolicy,
  runChecks,
  alertAll,
  timingSafeEqual,
  type Env,
} from "../worker";

const SECRET = "test-monitor-secret-do-not-log";
const baseEnv: Env = {
  MONITOR_TARGET: "https://yourrank.site",
  MONITOR_BACKUP_CHECK: "true",
  MONITOR_CHECK_SECRET: SECRET,
} as Env;

const realFetch = globalThis.fetch;
const logs: string[] = [];
const realError = console.error;
const realWarn = console.warn;
const realLog = console.log;

beforeEach(() => {
  logs.length = 0;
  const capture = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  console.error = capture;
  console.warn = capture;
  console.log = capture;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
  console.warn = realWarn;
  console.log = realLog;
});

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return handler(url);
  }) as typeof fetch;
}

const healthy = () => stubFetch(() => new Response("ok", { status: 200 }));

describe("F-013/F-014 monitor /check authentication", () => {
  it("fails closed when MONITOR_CHECK_SECRET is missing: no checks run, 503, safe diagnostic", async () => {
    let fetched = 0;
    stubFetch(() => { fetched += 1; return new Response("ok"); });
    const env = { ...baseEnv, MONITOR_CHECK_SECRET: undefined } as Env;
    const res = await worker.fetch(
      new Request("https://monitor/check", { headers: { authorization: "Bearer anything" } }),
      env,
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("monitor_check_secret_not_configured");
    expect(fetched).toBe(0);
    expect(logs.some((l) => l.includes("monitor_check_secret_not_configured"))).toBe(true);
    expect(logs.join("\n")).not.toContain("anything");
    const blank = await authorizeCheck(new Request("https://monitor/check"), { ...baseEnv, MONITOR_CHECK_SECRET: "  " } as Env);
    expect(blank.ok).toBe(false);
  });

  it("returns 401 without Authorization and with a wrong Bearer", async () => {
    healthy();
    const none = await worker.fetch(new Request("https://monitor/check"), baseEnv);
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toBe("Bearer");
    expect(none.headers.get("cache-control")).toBe("no-store");
    const wrong = await worker.fetch(
      new Request("https://monitor/check", { headers: { authorization: `Bearer ${SECRET}x` } }),
      baseEnv,
    );
    expect(wrong.status).toBe(401);
    const basic = await worker.fetch(
      new Request("https://monitor/check", { headers: { authorization: `Basic ${btoa(SECRET)}` } }),
      baseEnv,
    );
    expect(basic.status).toBe(401);
  });

  it("executes checks with the correct Bearer and never echoes the secret", async () => {
    healthy();
    const res = await worker.fetch(
      new Request("https://monitor/check", { headers: { authorization: `Bearer ${SECRET}` } }),
      baseEnv,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.text();
    expect(body).not.toContain(SECRET);
    expect(logs.join("\n")).not.toContain(SECRET);
    const results = JSON.parse(body) as Array<{ name: string; ok: boolean }>;
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("rejects the correct secret in the query string, with or without Bearer", async () => {
    let fetched = 0;
    stubFetch(() => { fetched += 1; return new Response("ok"); });
    const qs = await worker.fetch(new Request(`https://monitor/check?secret=${SECRET}`), baseEnv);
    expect(qs.status).toBe(400);
    expect((await qs.json()).error).toBe("query_string_credentials_not_accepted");
    const both = await worker.fetch(
      new Request(`https://monitor/check?secret=${SECRET}`, { headers: { authorization: `Bearer ${SECRET}` } }),
      baseEnv,
    );
    expect(both.status).toBe(400);
    expect(fetched).toBe(0);
  });

  it("uses a length- and content-sensitive timing-safe comparison", async () => {
    expect(await timingSafeEqual(SECRET, SECRET)).toBe(true);
    expect(await timingSafeEqual(SECRET, `${SECRET}!`)).toBe(false);
    expect(await timingSafeEqual("", SECRET)).toBe(false);
  });

  it("/health stays public and exposes no configuration", async () => {
    const res = await worker.fetch(new Request("https://monitor/health"), baseEnv);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ ok: true, worker: "monitor" });
    expect(body).not.toContain(SECRET);
  });

  it("worker source contains no query-string credential path", () => {
    const src = readFileSync(resolve(import.meta.dir, "../worker.ts"), "utf8");
    expect(src).not.toMatch(/searchParams\.get\(["']secret["']\)/);
  });
});

describe("F-049 production backup monitoring", () => {
  const wranglerToml = readFileSync(resolve(import.meta.dir, "../../wrangler.toml"), "utf8");

  it("production config explicitly enables MONITOR_BACKUP_CHECK", () => {
    const productionVars = wranglerToml.split(/^\[env\./m)[0];
    expect(productionVars).toMatch(/^MONITOR_BACKUP_CHECK\s*=\s*"true"/m);
    expect(wranglerToml).toMatch(/\[env\.staging\.vars\][\s\S]*?MONITOR_BACKUP_CHECK\s*=\s*"true"/);
    expect(wranglerToml).not.toMatch(/MONITOR_CHECK_SECRET\s*=/);
  });

  it("monitor check fails when backup health returns 503", async () => {
    stubFetch((url) => new Response(url.endsWith("/api/health/backup") ? "degraded" : "ok", {
      status: url.endsWith("/api/health/backup") ? 503 : 200,
    }));
    const results = await runChecks(baseEnv);
    const backup = results.find((r) => r.name === "GET /api/health/backup");
    expect(backup?.ok).toBe(false);
    expect(backup?.status).toBe(503);
  });

  it("production cannot silently skip backup checking", async () => {
    expect(backupCheckPolicy({ ...baseEnv, MONITOR_BACKUP_CHECK: undefined } as Env).error).toBeTruthy();
    expect(backupCheckPolicy({ ...baseEnv, MONITOR_BACKUP_CHECK: "yes" } as Env).error).toBeTruthy();
    expect(backupCheckPolicy({ ...baseEnv, MONITOR_BACKUP_CHECK: "false" } as Env).error).toBeTruthy();
    expect(backupCheckPolicy({ ...baseEnv, MONITOR_TARGET: "https://staging.yourrank.site", MONITOR_BACKUP_CHECK: "false" } as Env))
      .toEqual({ enabled: false });
    healthy();
    const results = await runChecks({ ...baseEnv, MONITOR_BACKUP_CHECK: undefined } as Env);
    const policy = results.find((r) => r.name === "backup check policy");
    expect(policy?.ok).toBe(false);
  });

  it("alert delivery failure does not turn a backup failure green", async () => {
    stubFetch(() => new Response("upstream down", { status: 502 }));
    const failures = [{ name: "GET /api/health/backup", ok: false, status: 503, latencyMs: 1 }];
    await alertAll({ ...baseEnv, DISCORD_MONITORING_WEBHOOK: "https://discord.example/hook" } as Env, failures);
    expect(failures[0].ok).toBe(false);
    expect(logs.some((l) => l.includes("monitor_alerts_failed"))).toBe(true);
  });
});
