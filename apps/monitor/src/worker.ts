// YourRank Uptime Monitor — Cloudflare Worker
// Runs on a cron schedule, checks golden paths, alerts Discord on failure.

export interface Env {
  MONITOR_TARGET: string;       // e.g. "https://yourrank.site"
  DISCORD_MONITORING_WEBHOOK: string;  // Discord webhook for alerts
  MONITOR_SLUG?: string;        // known board slug for /r/ check
  MONITOR_PB_KEY?: string;      // known postback key for /pb check
  MONITOR_BACKUP_CHECK?: string; // explicit "true" | "false" backup-freshness policy
  RESEND_API_KEY?: string;      // Optional email alert fallback
  ALERT_EMAIL?: string;         // Optional email alert recipient
  ALERT_FROM?: string;          // Optional email from address
  MONITOR_CHECK_SECRET?: string; // Required secret protecting the /check manual trigger
}

export interface CheckResult {
  name: string;
  ok: boolean;
  status: number;
  latencyMs: number;
  error?: string;
}

export const PRODUCTION_TARGET_HOSTS = ["yourrank.site", "www.yourrank.site"];

const JSON_HEADERS = { "content-type": "application/json" };

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

// Constant-time comparison: both inputs are hashed to a fixed length first so
// neither the length nor the position of the first mismatch leaks.
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i];
  return diff === 0 && a.length === b.length;
}

export type CheckAuth =
  | { ok: true }
  | { ok: false; status: 401 | 400 | 503; error: string };

// /check authentication. Fails closed: without a configured secret nothing
// runs. Only `Authorization: Bearer <secret>` is accepted; query-string
// credentials are rejected outright so they never work even by accident.
export async function authorizeCheck(request: Request, env: Env): Promise<CheckAuth> {
  const secret = env.MONITOR_CHECK_SECRET;
  if (typeof secret !== "string" || secret.trim() === "") {
    console.error(JSON.stringify({
      level: "error",
      msg: "monitor_check_secret_not_configured",
      hint: "set MONITOR_CHECK_SECRET via wrangler secret put; /check stays disabled until then",
      ts: new Date().toISOString(),
    }));
    return { ok: false, status: 503, error: "monitor_check_secret_not_configured" };
  }
  if (new URL(request.url).searchParams.has("secret")) {
    return { ok: false, status: 400, error: "query_string_credentials_not_accepted" };
  }
  const auth = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)\s*$/i.exec(auth);
  if (!match || !(await timingSafeEqual(match[1], secret))) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  return { ok: true };
}

export function isProductionTarget(target: string | undefined): boolean {
  try {
    return PRODUCTION_TARGET_HOSTS.includes(new URL(String(target)).hostname);
  } catch {
    return false;
  }
}

// Backup-freshness policy must be explicit. Production may never opt out.
export function backupCheckPolicy(env: Env): { enabled: boolean; error?: string } {
  const raw = env.MONITOR_BACKUP_CHECK;
  if (raw === "true") return { enabled: true };
  if (raw === "false") {
    if (isProductionTarget(env.MONITOR_TARGET)) {
      return { enabled: false, error: "MONITOR_BACKUP_CHECK=false is not allowed for the production target" };
    }
    return { enabled: false };
  }
  return { enabled: false, error: `MONITOR_BACKUP_CHECK must be explicitly "true" or "false" (got ${raw === undefined ? "unset" : JSON.stringify(raw)})` };
}

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function checkEndpoint(
  url: string,
  options: RequestInit,
  name: string,
  timeoutMs = 10_000,
  expectedStatuses?: number[]
): Promise<CheckResult> {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ok = expectedStatuses ? expectedStatuses.includes(res.status) : res.ok;
    return {
      name,
      ok,
      status: res.status,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name,
      ok: false,
      status: 0,
      latencyMs: Date.now() - start,
      error: String(err),
    };
  }
}

async function alertEmail(env: Env, failures: CheckResult[]): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.ALERT_EMAIL) return false;

  const fromAddr = env.ALERT_FROM ?? "YourRank Monitor <alerts@yourrank.site>";
  const subject = `🔴 YourRank uptime alert: ${failures.length} check(s) failed`;
  const text = failures.map((f) => `❌ ${f.name}\nStatus: ${f.status} | Latency: ${f.latencyMs}ms${f.error ? `\nError: ${f.error}` : ""}`).join("\n\n");
  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px"><h2>YourRank uptime alert</h2><pre style="white-space:pre-wrap;background:#f6f6f6;padding:14px;border-radius:6px">${text.replace(/</g, "&lt;")}</pre></div>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from: fromAddr, to: [env.ALERT_EMAIL], subject, text, html }),
      signal: AbortSignal.timeout(8_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function runChecks(env: Env): Promise<CheckResult[]> {
  const base = env.MONITOR_TARGET;
  const checks: Promise<CheckResult>[] = [
    // 1. GET /health (leaderboard + DB)
    checkEndpoint(`${base}/health`, { method: "GET" }, "GET /health"),
    // 2. GET / (landing page render)
    checkEndpoint(`${base}/`, { method: "GET" }, "GET / (landing)"),
    // 3. GET /bot/health (bot worker + DB)
    checkEndpoint(`${base}/bot/health`, { method: "GET" }, "GET /bot/health"),
    // 4. GET /dashboard/telegram (bot dashboard + Telegram login widget)
    checkEndpoint(`${base}/dashboard/telegram`, { method: "GET" }, "GET /dashboard/telegram"),
  ];

  // 5. GET /r/<known-slug> — only if a slug is configured; 302/307 are expected
  if (env.MONITOR_SLUG) {
    checks.push(
      checkEndpoint(
        `${base}/r/${env.MONITOR_SLUG}`,
        { method: "GET", redirect: "manual" },
        `GET /r/${env.MONITOR_SLUG}`,
        10_000,
        [301, 302, 303, 307, 308]
      )
    );
  }

  // 6. POST /pb — postback endpoint canary (signed, if a key is configured).
  // The monitor sends a synthetic test conversion with a unique click_ref so
  // it does not collide with real conversions.
  if (env.MONITOR_PB_KEY) {
    const clickRef = `monitor-${Date.now()}`;
    const qs = `event=monitor&amount=0&click_ref=${encodeURIComponent(clickRef)}`;
    const signature = await hmacSha256Hex(env.MONITOR_PB_KEY, qs);
    checks.push(
      checkEndpoint(
        `${base}/pb?${qs}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-postback-key": env.MONITOR_PB_KEY,
            "x-postback-signature": signature,
          },
        },
        "POST /pb (canary)",
        10_000,
        [200]
      )
    );
  }

  // 7. Backup verification freshness. The leaderboard endpoint returns 503
  // when no valid successful restore drill is recorded within the configured
  // limit (default 7 days). An unset/invalid policy is itself a failed check so
  // the monitor can never silently skip recovery-proof monitoring.
  const backupPolicy = backupCheckPolicy(env);
  if (backupPolicy.error) {
    checks.push(Promise.resolve({
      name: "backup check policy",
      ok: false,
      status: 0,
      latencyMs: 0,
      error: backupPolicy.error,
    }));
  } else if (backupPolicy.enabled) {
    checks.push(
      checkEndpoint(
        `${base}/api/health/backup`,
        { method: "GET" },
        "GET /api/health/backup",
        10_000,
        [200]
      )
    );
  }

  // 8. Consumer health: ping the consumer Worker's /health route. This both
  // checks the consumer is reachable and updates its DB heartbeat row, which
  // the leaderboard /health check above also reads.
  checks.push(checkEndpoint(`${base}/consumer/health`, { method: "GET" }, "GET /consumer/health"));

  return Promise.all(checks);
}

async function alertDiscord(env: Env, failures: CheckResult[]): Promise<boolean> {
  if (!env.DISCORD_MONITORING_WEBHOOK) return false;

  const fields = failures.map((f) => ({
    name: `❌ ${f.name}`,
    value: `Status: ${f.status} | Latency: ${f.latencyMs}ms${f.error ? `\nError: ${f.error.slice(0, 200)}` : ""}`,
    inline: false,
  }));

  const embed = {
    title: "🔴 YourRank Uptime Alert",
    color: 0xff4444,
    fields,
    timestamp: new Date().toISOString(),
    footer: { text: "YourRank Monitor" },
  };

  try {
    const res = await fetch(env.DISCORD_MONITORING_WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "YourRank Monitor",
        embeds: [embed],
      }),
      signal: AbortSignal.timeout(8_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function alertAll(env: Env, failures: CheckResult[]): Promise<void> {
  // Send to Discord first, then to email. If Discord fails, email becomes the
  // fallback. If both are configured, both fire so you don't lose the alert.
  const discordOk = await alertDiscord(env, failures);
  const emailOk = await alertEmail(env, failures);

  if (!discordOk && !emailOk) {
    console.error(JSON.stringify({
      level: "error",
      msg: "monitor_alerts_failed",
      ts: new Date().toISOString(),
      failures: failures.map((f) => f.name),
    }));
  } else if (!discordOk) {
    console.warn(JSON.stringify({
      level: "warn",
      msg: "monitor_discord_alert_failed_email_sent",
      ts: new Date().toISOString(),
    }));
  }
}

export default {
  // Cron handler — runs every 5 minutes
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const results = await runChecks(env);
    const failures = results.filter((r) => !r.ok);

    if (failures.length > 0) {
      console.error(JSON.stringify({
        level: "error",
        msg: "uptime_check_failed",
        failures: failures.map((f) => f.name),
        ts: new Date().toISOString(),
      }));
      ctx.waitUntil(alertAll(env, failures));
    } else {
      console.log(JSON.stringify({
        level: "info",
        msg: "uptime_check_passed",
        checks: results.map((r) => ({ name: r.name, status: r.status, ms: r.latencyMs })),
        ts: new Date().toISOString(),
      }));
    }
  },

  // HTTP handler — returns monitor status
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, worker: "monitor" }), {
        headers: JSON_HEADERS,
      });
    }

    if (url.pathname === "/check") {
      const auth = await authorizeCheck(request, env);
      if (!auth.ok) {
        return new Response(JSON.stringify({ ok: false, error: auth.error }), {
          status: auth.status,
          headers: { ...JSON_HEADERS, "cache-control": "no-store", "www-authenticate": "Bearer" },
        });
      }
      const results = await runChecks(env);
      return new Response(JSON.stringify(results, null, 2), {
        headers: { ...JSON_HEADERS, "cache-control": "no-store" },
      });
    }

    return new Response("YourRank Monitor", { status: 200 });
  },
};
