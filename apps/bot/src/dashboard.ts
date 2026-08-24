// ------------------------------------------------------------------
// Streamer dashboard: Telegram Login auth + self-serve UI.
//
// Refactored to separate concerns:
//   - Auth logic in dashboard-auth.ts
//   - API handlers in dashboard-api.ts  
//   - HTML templates in dashboard-views.ts
//   - This file handles routing and middleware setup
//
// Routes:
//   GET  /dashboard            HTML app (login screen or dashboard)
//   POST /auth/telegram        Telegram Login widget callback
//   POST /auth/dev             Dev-only login (ALLOW_DEV_LOGIN=1)
//   POST /auth/logout
//   GET  /dash/api/me
//   GET  /dash/api/offers      list own offers (+ tracked links, clicks)
//   POST /dash/api/offers      create offer
//   PATCH /dash/api/offers/:id toggle active
//   GET  /dash/api/stats/daily clicks per day (14d) for the chart
//   GET  /dash/api/bots        list own bots
//   POST /dash/api/bots        connect a bot (paste BotFather token)
//
// Session: SHARED KV-backed session (see packages/shared/src/session.ts). The token
// is a random opaque id; DB sessions table maps token -> user UUID in
// namespace, which is bound to the SAME id as the leaderboard Worker so one
// login works across both Workers. Cookie name yr_session, Domain=.yourrank.site.
// (Replaces the old HMAC-signed stateless `sess` cookie, which could not be
// verified cross-Worker and gave no real server-side logout.)
// ------------------------------------------------------------------
import { Hono } from "hono";
import { config } from "./config.js";
import { one } from "@yourrank/shared/db";
import {
  createSession,
  destroySession,
  cookieSet,
  cookieClear,
  resolveSession,
  readToken,
  hasLegacyCookie,
  cookieClearLegacy,
  type SessionEnv,
} from "@yourrank/shared/session";
import { sameOrigin, verifyTelegramLogin } from "./dashboard-auth.js";
import { buildDashboardApi } from "./dashboard-api.js";
import { loginHtml, appHtml, clientScriptSource } from "./dashboard-views.js";
import { rateLimit, type RateLimitKV } from "./ratelimit.js";
import { errMessage } from "./errors.js";

// ---------------- app ----------------

// The Workers env is passed straight through as Hono's `c.env` (see worker.ts:
// `app.fetch(req, env as any)`), so the env bindings declared in
// wrangler.toml are reachable as `c.env`.
type DashBindings = SessionEnv & {
  SESSIONS?: RateLimitKV;
  RATE_LIMITER_DO?: any;
  RL_BACKEND?: string;
  [key: string]: unknown;
};
type DashEnv = { Bindings: DashBindings; Variables: { cspNonce: string } };

export function buildDashboard(opts: { canonical?: boolean } = {}): Hono<DashEnv> {
  const app = new Hono<DashEnv>();
  const canonical = opts.canonical === true;

  // Global error handler — same reason as buildHonoApp: Hono's default
  // text/plain 500 breaks the dashboard's api() JSON parse.
  app.onError((err, c) => {
    const msg = errMessage(err);
    const stack = err instanceof Error ? err.stack ?? "" : "";
    console.error("[dashboard unhandled error]", msg, stack);
    // Match buildHonoApp: never leak message/stack to clients in production.
    const isDev = c.env?.ENVIRONMENT === "development" || c.env?.ENVIRONMENT === "local";
    return c.json({ error: isDev ? msg : "Internal Server Error" }, 500);
  });

  // CSP header on all dashboard responses (SEC-102, SEC-703)
  // SEC-104: Also clear legacy 'sess' cookie on every response.
  // SEC-107: Propagate rotated session cookies.
  app.use("*", async (c, next) => {
    const nonce = crypto.randomUUID().replace(/-/g, "");
    c.set("cspNonce", nonce);
    await next();
    if (!c.res.headers.has("Content-Security-Policy")) {
      // M-02: nonce-only script-src and style-src. No 'unsafe-eval' or 'unsafe-inline'.
      // The Google Fonts stylesheet/files are allowed by origin (same list the
      // leaderboard Worker uses) so the shared page shell renders in Inter here
      // too instead of falling back to a system font.
      c.header("Content-Security-Policy", `default-src 'self'; script-src 'self' 'nonce-${nonce}' https://telegram.org; style-src 'self' 'nonce-${nonce}' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://telegram.org; frame-src https://telegram.org https://oauth.telegram.org;`);
    }
    c.res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    // SEC-104: Clear legacy 'sess' cookie
    if (hasLegacyCookie(c.req.raw)) {
      c.res.headers.append("Set-Cookie", cookieClearLegacy());
    }
  });

  const registerAuthAndApi = (target: Hono<DashEnv>) => {
    // ---- auth ----
    // BE-005: Rate-limit the Telegram login endpoint to prevent brute-force
    // signature forgery attempts (60 req/min per IP).
    target.post("/auth/telegram", async (c) => {
      const ip = c.req.header("cf-connecting-ip") || "0.0.0.0";
      const rlResult = await rateLimit(c.env, `bot-dash:${ip}`, 20, 60);
      if (!rlResult.ok) return c.json({ error: "rate limit exceeded", retryAfter: rlResult.retryAfter }, 429);
      if (!sameOrigin(c.req.raw, config.publicBaseUrl)) return c.json({ error: "cross-origin request rejected" }, 403);
      const loginBotToken = process.env.LOGIN_BOT_TOKEN;
      if (!loginBotToken) return c.json({ error: "telegram login not configured" }, 501);
      const data = await c.req.json();
      if (!(await verifyTelegramLogin(data, loginBotToken)))
        return c.json({ error: "bad telegram signature" }, 401);

      const name = [data.first_name, data.last_name].filter(Boolean).join(" ") || data.username || String(data.id);
      const row = (await one<{ id: string; status: string }>(
        `INSERT INTO users (telegram_user_id, display_name)
         VALUES ($1, $2)
         ON CONFLICT (telegram_user_id) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now()
         RETURNING id, status`,
        [data.id, name]
      ))!;
      if (row.status === "suspended") return c.json({ error: "account suspended" }, 403);
      const token = await createSession(c.env, row.id);
      c.header("Set-Cookie", cookieSet(token, c.env));
      return c.json({ ok: true });
    });

    target.post("/auth/dev", async (c) => {
      if (process.env.ALLOW_DEV_LOGIN !== "1") return c.json({ error: "disabled" }, 403);
      // Dev login blindly trusts a telegram_user_id and hands back that user's
      // session, so it is an ATO primitive if reachable. Restrict HARD:
      //  - REQUIRE an Origin header and require it to be localhost (curl/local
      //    dev only). sameOrigin()'s missing-Origin bypass is deliberately NOT
      //    applied here, since that bypass is exactly how a remote attacker would
      //    reach dev login with curl-equivalent tooling.
      //  - Never enable ALLOW_DEV_LOGIN in production.
      const origin = c.req.raw.headers.get("origin") ?? "";
      const isLocal =
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      if (!isLocal) return c.json({ error: "dev login is local-only" }, 403);
      const { telegram_user_id, display_name } = await c.req.json<{ telegram_user_id: number; display_name?: string }>();
      const row = (await one<{ id: string }>(
        `INSERT INTO users (telegram_user_id, display_name) VALUES ($1, $2)
         ON CONFLICT (telegram_user_id) DO UPDATE SET updated_at = now() RETURNING id`,
        [telegram_user_id, display_name ?? `dev-${telegram_user_id}`]
      ))!;
      const token = await createSession(c.env, row.id);
      c.header("Set-Cookie", cookieSet(token, c.env));
      return c.json({ ok: true });
    });

    target.post("/auth/logout", async (c) => {
      await destroySession(c.env, readToken(c.req.raw));
      c.header("Set-Cookie", cookieClear(c.env));
      // JSON for the dashboard JS client; HTML redirect for the shared nav form.
      const accept = c.req.header("accept") || "";
      if (accept.includes("application/json")) return c.json({ ok: true });
      return c.redirect("/dashboard/telegram");
    });

    // ---- session-scoped API ----
    const api = buildDashboardApi();
    target.route("/dash/api", api);

    // ---- static client JS (external so CSP nonce cannot block it) ----
    target.get("/dash/client.js", (c) =>
      c.body(clientScriptSource(), 200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      })
    );
  };

  if (!canonical) {
    registerAuthAndApi(app);
  }

  // ---- HTML ----
  const dashboardPage = async (c: any, page: string) => {
    const session = await resolveSession(c.req.raw, c.env as any);
    const uid = session?.uid ?? null;
    if (session?.rotatedCookie) c.header("Set-Cookie", session.rotatedCookie);
    const loginBotUsername = process.env.LOGIN_BOT_USERNAME ?? "";
    const devLogin = process.env.ALLOW_DEV_LOGIN === "1";
    if (!uid) {
      // The Telegram Login Widget (telegram-widget.js) uses eval internally,
      // so the login page needs 'unsafe-eval' in script-src. Authenticated
      // dashboard pages keep the stricter nonce-only CSP.
      c.header("Content-Security-Policy", `default-src 'self'; script-src 'self' 'unsafe-eval' 'nonce-${c.get("cspNonce")}' https://telegram.org; style-src 'self' 'nonce-${c.get("cspNonce")}' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://telegram.org; frame-src https://telegram.org https://oauth.telegram.org;`);
      return c.html(loginHtml(loginBotUsername, devLogin, c.get("cspNonce")));
    }
    const user = await one<{ display_name: string; email: string; plan: string; bot_username: string | null; bot_status: string | null; site_name: string | null }>(
      `SELECT u.display_name, u.email, u.plan,
              (SELECT b.username FROM bots b WHERE b.owner_id = u.id ORDER BY b.created_at ASC LIMIT 1) AS bot_username,
              (SELECT b.status FROM bots b WHERE b.owner_id = u.id ORDER BY b.created_at ASC LIMIT 1) AS bot_status,
              (SELECT s.name FROM sites s WHERE s.user_id = u.id ORDER BY s.board_order ASC, s.id ASC LIMIT 1) AS site_name
       FROM users u WHERE u.id=$1`,
      [uid]
    );
    // The page renders the dashboard rail and its own topbar/account menu, so
    // it no longer stacks the marketing-style product header on top.
    return c.html(appHtml(
      user ?? { display_name: "", email: "", plan: "free" },
      config.publicBaseUrl,
      c.get("cspNonce"),
      page,
      undefined,
      { botUsername: user?.bot_username, botStatus: user?.bot_status, siteName: user?.site_name },
    ));
  };

  if (canonical) {
    const pageRoute = (page: string) => {
      return (c: any) => dashboardPage(c, page);
    };
    app.get("/", pageRoute("overview"));
    app.get("/bots", pageRoute("bots"));
    app.get("/offers", pageRoute("offers"));
    app.get("/commands", pageRoute("commands"));
    app.get("/broadcasts", pageRoute("broadcasts"));
  }
  return app;
}
