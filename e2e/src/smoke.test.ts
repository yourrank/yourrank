/// <reference types="bun-types" />

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { SQL } from "bun";
import { dashboardNavItems } from "@yourrank/shared/dashboard-nav";
import { Client, hmacSha256, randomId } from "./client.js";

const rawBaseUrl = process.env.E2E_BASE_URL?.trim();
if (!rawBaseUrl) {
  throw new Error("E2E_BASE_URL is required and must point to an isolated non-production environment.");
}

const parsedBaseUrl = new URL(rawBaseUrl);
if (parsedBaseUrl.hostname === "yourrank.site" || parsedBaseUrl.hostname === "www.yourrank.site") {
  throw new Error("Refusing to run mutating E2E tests against production.");
}
if (process.env.E2E_ALLOW_MUTATIONS !== "1") {
  throw new Error("Set E2E_ALLOW_MUTATIONS=1 after confirming E2E_BASE_URL is isolated from production.");
}

const BASE_URL = parsedBaseUrl.origin;
const TELEGRAM_BOT_TOKEN = process.env.E2E_TELEGRAM_BOT_TOKEN || "";

// Dependencies this suite cannot create for itself. Each one gates the tests
// that need it so they report SKIPPED instead of failing on a missing
// environment — and never report PASSED without running.
//
// - E2E_DB_URL: a board is only publicly reachable once the owner's email is
//   verified, and the raw token is only delivered by email (see journeys.test.ts).
// - E2E_MARKETING_AVAILABLE: "/" and "/pricing" are proxied to the MARKETING
//   Worker binding, which is absent in local dev (503).
// - E2E_BOT_AVAILABLE: /bot/dash/* is served by the separate apps/bot Worker.
const DB_URL = process.env.E2E_DB_URL?.trim() || "";
const PUBLIC_ACCESS_AVAILABLE = Boolean(DB_URL);
const MARKETING_AVAILABLE = process.env.E2E_MARKETING_AVAILABLE === "1";
const BOT_AVAILABLE = process.env.E2E_BOT_AVAILABLE === "1";

const id = randomId();
const email = `e2e-${id}@yourrank.test`;
// The server password policy requires a symbol (apps/leaderboard/src/password-rules.js).
const password = "TestPass1234!";
const name = "E2E Test";
const slug = `e2e-${id}`;

// The sidebar owns section roots and page subnavigation owns tabs (AGENTS.md),
// so a leaf like /dashboard/rewards/viewers is reachable from the Rewards page's
// own tabs, not from every other page's chrome. What every signed-in page must
// therefore expose is the sidebar's section roots — taken from the same contract
// the Worker renders from, so a section that disappears from the shell fails here
// instead of being quietly accepted.
// Matching the href alone would be vacuous for "/dashboard", which prefixes every
// other dashboard link, so each section is identified by its nav key too — the
// sidebar renders one `data-nav` per item.
const SECTION_ROOTS: Array<{ key: string; href: string }> = (function collect(items): Array<{
  key: string;
  href: string;
}> {
  return items.flatMap((item) =>
    item.kind === "group"
      ? collect(item.children ?? [])
      : item.href
        ? [{ key: item.key, href: item.href }]
        : []
  );
})(dashboardNavItems());

const AUTHENTICATED_DASHBOARD_ROUTES = [
  ["/dashboard", "board"],
  ["/dashboard/leaderboard", "board"],
  ["/dashboard/leaderboard/setup", "board"],
  ["/dashboard/leaderboard/players", "board"],
  ["/dashboard/leaderboard/design", "board"],
  ["/dashboard/games", "board"],
  ["/dashboard/leaderboard/share", "board"],
  ["/dashboard/leaderboard/history", "board"],
  ["/dashboard/leaderboards", "board"],
  ["/dashboard/analytics/activity", "board"],
  ["/dashboard/site", "board"],
  ["/dashboard/activities", "siteId"],
  ["/dashboard/rewards/viewers", "siteId"],
  ["/dashboard/rewards/redemptions", "siteId"],
  ["/dashboard/rewards/shop", "siteId"],
  ["/dashboard/rewards/rules", "siteId"],
  ["/dashboard/rewards/activity", "siteId"],
  ["/dashboard/rewards/channel", "siteId"],
  ["/dashboard/settings/account", "board"],
  ["/dashboard/settings/billing", "board"],
  ["/dashboard/settings/connections", "board"],
  ["/dashboard/settings/data", "board"],
] as const;

let client: Client;
let primarySlug: string;
let primarySiteId: string | undefined;
let postbackKey: string;
let offerSlug: string;
let botId: string;
let botSecret: string | undefined;
let accountCreated = false;

describe("YourRank E2E smoke", () => {
  beforeAll(async () => {
    client = new Client(BASE_URL);

    // Prime the CSRF cookie before the first mutating request. "/" is proxied to
    // the MARKETING worker binding, absent in local dev (503), so use a
    // first-party page that sets __csrf.
    await client.get("/login");
    const signup = await client.post("/api/auth/signup", { email, password, name, slug });
    if (!signup.json?.ok) {
      throw new Error(`signup failed: ${signup.status} ${signup.body}`);
    }
    accountCreated = true;
    primarySlug = signup.json.user.slug;

    if (PUBLIC_ACCESS_AVAILABLE) {
      const sql = new SQL(DB_URL);
      try {
        await sql`update users set email_verified = true where email = ${email}`;
      } finally {
        await sql.end();
      }
    }

    const login = await client.post("/api/auth/login", { email, password });
    if (!login.json?.ok) {
      throw new Error(`login failed: ${login.status} ${login.body}`);
    }

    // Start Pro trial so postback/score APIs and multi-board creation work.
    const trial = await client.post("/api/billing/trial", {});
    if (!trial.json?.ok) {
      throw new Error(`trial failed: ${trial.status} ${trial.body}`);
    }
  });

  afterAll(async () => {
    if (!accountCreated) return;

    const failures: string[] = [];
    if (botId) {
      const botCleanup = await client.delete(`/bot/dash/api/bots/${botId}`);
      if (!botCleanup.json?.ok) {
        failures.push(`bot cleanup failed: ${botCleanup.status} ${botCleanup.body}`);
      }
    }

    const accountCleanup = await client.post("/api/account/delete", { password });
    if (!accountCleanup.json?.ok) {
      failures.push(`account cleanup failed: ${accountCleanup.status} ${accountCleanup.body}`);
    }

    if (failures.length) {
      throw new Error(failures.join("\n"));
    }
  });

  describe("public site smoke", () => {
    it.skipIf(!MARKETING_AVAILABLE)("GET / returns the landing page", async () => {
      const res = await client.get("/");
      expect(res.status).toBe(200);
      expect(res.body).toContain("YourRank");
      expect(res.body).toContain("<html");
    });

    it("GET /health returns ok and db true", async () => {
      const res = await client.get("/health");
      expect(res.status).toBe(200);
      expect(res.json?.status).toBe("ok");
      expect(res.json?.db).toBe(true);
    });

    it.skipIf(!MARKETING_AVAILABLE)("GET /pricing returns the pricing page", async () => {
      const res = await client.get("/pricing");
      expect(res.status).toBe(200);
      expect(res.body).toContain("pricing");
    });

    it("GET /demo returns the demo leaderboard", async () => {
      const res = await client.get("/demo");
      expect(res.status).toBe(200);
      expect(res.body).toContain("leaderboard");
    });

    it("GET /nonexistent-board returns 404", async () => {
      const res = await client.get(`/nonexistent-board-${id}`);
      expect(res.status).toBe(404);
    });
  });

  describe("auth and leaderboard", () => {
    it("GET /api/auth/me returns the authenticated user", async () => {
      const res = await client.get("/api/auth/me");
      expect(res.status).toBe(200);
      expect(res.json?.ok).toBe(true);
      expect(res.json?.user?.email).toBe(email);
    });

    it("GET /api/site returns the primary site", async () => {
      const res = await client.get("/api/site");
      expect(res.status).toBe(200);
      expect(res.json?.ok).toBe(true);
      expect(res.json?.slug).toBe(primarySlug);
      primarySiteId = res.json?.siteId;
    });

    it("publishes the primary board so public pages are reachable", async () => {
      const res = await client.post("/api/site/finish", { siteId: primarySiteId });
      expect(res.status).toBe(200);
      expect(res.json?.ok).toBe(true);
      // The response reports the publication timestamp; `published` was never
      // part of it. Assert the timestamp is a real date so a silent no-op
      // publish still fails.
      expect(typeof res.json?.publishedAt).toBe("string");
      expect(Number.isFinite(Date.parse(res.json?.publishedAt))).toBe(true);
    });

    it.skipIf(!PUBLIC_ACCESS_AVAILABLE)("GET /<slug> renders the public leaderboard page", async () => {
      const res = await client.get(`/${primarySlug}`);
      expect(res.status).toBe(200);
      expect(res.body).toContain("leaderboard");
    });

    it.skipIf(!PUBLIC_ACCESS_AVAILABLE)("GET /api/public/:slug/standings returns JSON", async () => {
      const res = await client.get(`/api/public/${primarySlug}/standings`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.json?.players)).toBe(true);
    });

    it.skipIf(!PUBLIC_ACCESS_AVAILABLE)("GET /api/public/:slug/players returns JSON", async () => {
      const res = await client.get(`/api/public/${primarySlug}/players`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.json?.players)).toBe(true);
    });

    it.skipIf(!PUBLIC_ACCESS_AVAILABLE)("GET /api/public/:slug/rank returns a rank message", async () => {
      const res = await client.get(`/api/public/${primarySlug}/rank?user=TestPlayer`);
      expect(res.status).toBe(200);
      expect(res.body).toContain("leaderboard");
    });

    it.skipIf(!PUBLIC_ACCESS_AVAILABLE)("GET /api/public/:slug returns full data JSON", async () => {
      const res = await client.get(`/api/public/${primarySlug}`);
      expect(res.status).toBe(200);
      expect(res.json?.players).toBeDefined();
    });

    it("POST /api/track/copy returns ok", async () => {
      const res = await client.post("/api/track/copy", { slug: primarySlug });
      expect(res.status).toBe(200);
      expect(res.json?.ok).toBe(true);
    });

    it("POST /api/site/create creates a second board (pro trial)", async () => {
      const res = await client.post("/api/site/create", { slug: `e2e-${id}-board2`, name: "E2E Board 2" });
      expect(res.status).toBe(200);
      expect(res.json?.ok).toBe(true);
      expect(res.json?.slug).toBe(`e2e-${id}-board2`);
    });

    it("GET /api/site/list returns both boards", async () => {
      const res = await client.get("/api/site/list");
      expect(res.status).toBe(200);
      expect(res.json?.boards?.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("authenticated dashboard journey", () => {
    beforeAll(async () => {
      if (primarySiteId) return;
      const res = await client.get("/api/site");
      if (!res.json?.ok || !res.json?.siteId) {
        throw new Error(`site lookup failed: ${res.status} ${res.body}`);
      }
      primarySiteId = res.json.siteId;
    });

    for (const [path, siteParam] of AUTHENTICATED_DASHBOARD_ROUTES) {
      it(`GET ${path} renders the shell with every sidebar section root`, async () => {
        expect(primarySiteId).toBeDefined();
        const route = `${path}?${siteParam}=${encodeURIComponent(primarySiteId || "")}`;
        const res = await client.get(route);
        expect(res.status).toBe(200);
        expect(res.body).toContain('id="lbSide"');
        expect(res.body).toContain('data-close-side');
        for (const { key, href } of SECTION_ROOTS) {
          expect(res.body).toContain(`data-nav="${key}"`);
          // The shell appends ?board=/?siteId= to site-scoped roots, so match the
          // href prefix rather than the bare path.
          expect(res.body).toContain(`href="${href}`);
        }
      });
    }

    it("GET /help keeps the full dashboard journey and local help actions", async () => {
      const res = await client.get("/help");
      expect(res.status).toBe(200);
      // Help is not a sidebar section, so it carries no `data-nav`: its own tab
      // strip owns the active marker (page subnavigation owns tabs).
      expect(res.body).toContain("help-workspace-subnav");
      expect(res.body).toContain('href="/help" aria-current="page"');
      expect(res.body).toContain('href="/help/support"');
      expect(res.body).toContain('href="/help/feedback"');
      for (const { key, href } of SECTION_ROOTS) {
        expect(res.body).toContain(`data-nav="${key}"`);
        expect(res.body).toContain(`href="${href}`);
      }
    });
  });

  describe("public credits and viewer overlay", () => {
    it("GET /me returns the viewer account page", async () => {
      const res = await client.get("/me");
      expect(res.status).toBe(200);
      // The global surface is "your sites & account"; "My credits" is the
      // creator-scoped page at /<slug>/me.
      expect(res.body).toContain("Your sites");
    });

    it.skipIf(!PUBLIC_ACCESS_AVAILABLE)("GET /<slug>/credits redirects to the canonical shop page", async () => {
      const res = await client.get(`/${primarySlug}/credits`);
      expect(res.status).toBe(200);
      // The legacy credits URL is an alias: it 302s to /<slug>/shop, which the
      // client follows, and the canonical site shell renders the shop section.
      expect(res.body).toContain('data-section="shop"');
      expect(res.body).not.toMatch(/© 1970/);
    });

    it.skipIf(!PUBLIC_ACCESS_AVAILABLE)("GET /<slug>/overlay returns the OBS overlay page", async () => {
      const res = await client.get(`/${primarySlug}/overlay`);
      expect(res.status).toBe(200);
      expect(res.body).toContain("ov-wrap");
    });
  });

  describe("postback and score postback", () => {
    it("GET /api/attribution returns signed postback credentials for pro users", async () => {
      const res = await client.get("/api/attribution");
      expect(res.status).toBe(200);
      expect(res.json?.ok).toBe(true);
      // The response moved from a single query-string URL to explicit signed
      // credentials plus a sunsetting legacy URL; assert both so the legacy
      // field cannot be dropped silently before its sunset date.
      expect(res.json?.postback?.signedEndpoint).toContain("/api/postback");
      expect(res.json?.postback?.signature?.length).toBeGreaterThan(0);
      expect(res.json?.postback?.legacyUrl).toContain("key=");
      postbackKey = res.json?.postback?.key || "";
      expect(postbackKey.length).toBeGreaterThan(0);
    });

    it("POST /api/scores updates leaderboard with signed players payload", async () => {
      // A postback key can cover several boards, so the server requires the
      // target board in the signed body (or the X-Postback-Site header).
      const payload = JSON.stringify({
        slug: primarySlug,
        players: [
          { name: "Alice", wagered: 12345, prize: 100 },
          { name: "Bob", wagered: 9000, prize: 50 },
        ],
      });
      const signature = await hmacSha256(postbackKey, payload);
      const res = await client.post("/api/scores", payload, {
        headers: {
          "X-Postback-Key": postbackKey,
          "X-Postback-Signature": signature,
          "Content-Type": "application/json",
        },
      });
      expect(res.status).toBe(200);
      expect(res.json?.ok).toBe(true);
      expect(res.json?.players).toBe(2);
    });

    it.skipIf(!PUBLIC_ACCESS_AVAILABLE)("GET /api/public/:slug/standings reflects the new scores", async () => {
      const res = await client.get(`/api/public/${primarySlug}/standings`);
      expect(res.status).toBe(200);
      expect(res.json?.players?.length).toBe(2);
      expect(res.json?.players[0].name).toBe("Alice");
    });

    it.skipIf(!PUBLIC_ACCESS_AVAILABLE)("GET /api/public/:slug/rank returns Alices rank", async () => {
      const res = await client.get(`/api/public/${primarySlug}/rank?user=Alice`);
      expect(res.status).toBe(200);
      expect(res.body).toContain("#1");
      expect(res.body).toContain("Alice");
    });

    it("POST /api/postback records a signed conversion", async () => {
      const params = new URLSearchParams();
      params.set("key", postbackKey);
      params.set("event", "deposit");
      params.set("amount", "100");
      params.set("click_ref", `e2e-ref-${id}`);
      params.set("currency", "USD");
      const qs = params.toString();
      const signature = await hmacSha256(postbackKey, qs);
      const res = await client.post(`/api/postback?${qs}`, undefined, {
        headers: {
          "X-Postback-Signature": signature,
        },
      });
      expect(res.status).toBe(200);
      expect(res.json?.ok).toBe(true);
    });
  });

  describe.skipIf(!BOT_AVAILABLE)("bot dashboard and tracked links", () => {
    it("GET /bot/health returns ok and db true", async () => {
      const res = await client.get("/bot/health");
      expect(res.status).toBe(200);
      expect(res.json?.ok).toBe(true);
      expect(res.json?.db).toBe(true);
    });

    it("GET /dashboard/telegram loads the bot dashboard", async () => {
      const res = await client.get("/dashboard/telegram");
      expect(res.status).toBe(200);
      expect(res.body).toContain("Streamer Dashboard");
    });

    it("GET /bot/dash/api/me returns the authenticated user", async () => {
      const res = await client.get("/bot/dash/api/me");
      expect(res.status).toBe(200);
      expect(res.json?.id).toBeDefined();
    });

    it("POST /bot/dash/api/offers creates a tracked offer", async () => {
      const res = await client.post("/bot/dash/api/offers", {
        casino: "E2E Casino",
        label: "E2E Offer",
        referral_url: "https://example.com/?ref={click_ref}",
        promo_code: "E2E2025",
        bonus_text: "Test bonus",
      });
      expect(res.status).toBe(200);
      expect(res.json?.offer_id).toBeDefined();
      expect(res.json?.tracked_link).toContain("/r/");
      const tracked = new URL(res.json?.tracked_link);
      offerSlug = tracked.pathname.split("/").pop() || "";
      expect(offerSlug.length).toBeGreaterThan(0);
    });

    it("GET /r/:slug redirects to the referral URL with a click_ref", async () => {
      const res = await client.get(`/r/${offerSlug}`, { redirect: "manual" });
      expect(res.status).toBe(302);
      const location = res.headers.get("location") || "";
      expect(location).toContain("ref=");
      expect(location).not.toContain("{click_ref}");
    });

    it("GET /bot/dash/api/offers lists the created offer", async () => {
      const res = await client.get("/bot/dash/api/offers");
      expect(res.status).toBe(200);
      expect(res.json?.length).toBeGreaterThanOrEqual(1);
      expect(res.json?.[0].label).toBe("E2E Offer");
    });

    it("POST /hook/badsecret rejects unknown webhook secret", async () => {
      const res = await client.post("/hook/badsecret", { message: { text: "/code" } }, { skipCsrf: true });
      expect(res.status).toBe(401);
    });
  });

  describe.skipIf(!BOT_AVAILABLE)("Telegram bot connection (optional)", () => {
    it("connects a real bot when E2E_TELEGRAM_BOT_TOKEN is set", async () => {
      if (!TELEGRAM_BOT_TOKEN) {
        expect(true).toBe(true); // skipped
        return;
      }

      const res = await client.post("/bot/dash/api/bots", { token: TELEGRAM_BOT_TOKEN, welcome_message: "E2E welcome" });
      expect(res.status).toBe(200);
      expect(res.json?.bot_id).toBeDefined();
      expect(res.json?.username).toBeDefined();
      botId = res.json?.bot_id;

      const health = await client.get(`/bot/dash/api/bots/${botId}/health`);
      expect(health.status).toBe(200);
      expect(health.json?.ok).toBe(true);
      expect(health.json?.configured).toBe(true);

      const webhookUrl = health.json?.url || "";
      botSecret = webhookUrl.split("/").pop();
      expect(botSecret).toBeDefined();
    });

    it("creates and toggles a custom command when a bot is connected", async () => {
      if (!botId) {
        expect(true).toBe(true);
        return;
      }

      const created = await client.post(`/bot/dash/api/bots/${botId}/commands`, {
        command: "e2e",
        response: "E2E response",
      });
      expect(created.status).toBe(200);
      expect(created.json?.command).toBe("e2e");

      const list = await client.get(`/bot/dash/api/bots/${botId}/commands`);
      expect(list.status).toBe(200);
      expect(list.json?.length).toBe(1);

      const cmdId = created.json?.id;
      const toggled = await client.patch(`/bot/dash/api/commands/${cmdId}`, { is_enabled: false });
      expect(toggled.status).toBe(200);
      expect(toggled.json?.is_enabled).toBe(false);

      const removed = await client.delete(`/bot/dash/api/commands/${cmdId}`);
      expect(removed.status).toBe(200);
      expect(removed.json?.ok).toBe(true);
    });

    it("webhook returns 200 for a valid code command", async () => {
      if (!botSecret) {
        expect(true).toBe(true);
        return;
      }

      const update = {
        update_id: 1,
        message: {
          message_id: 1,
          from: { id: 1, is_bot: false, first_name: "E2E", username: "e2euser" },
          chat: { id: 1, type: "private" },
          date: Math.floor(Date.now() / 1000),
          text: "/code",
          entities: [{ type: "bot_command", offset: 0, length: 5 }],
        },
      };

      const res = await client.post(`/hook/${botSecret}`, update, {
        headers: {
          "x-telegram-bot-api-secret-token": botSecret,
          "Content-Type": "application/json",
        },
        skipCsrf: true,
      });
      expect(res.status).toBe(200);
    });
  });
});
