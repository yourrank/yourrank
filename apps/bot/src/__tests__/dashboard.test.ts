// Dashboard + bot onboarding integration tests.
// Mocks DB and Telegram API, then exercises the real Hono routes and views.

import { describe, it, expect, mock, beforeEach } from "bun:test";

// ── Mocks (set up before importing the SUT) ───────────────────────────
const dbUrl = import.meta.resolve("@yourrank/shared/db");
const dbUrlTs = import.meta.resolve("@yourrank/shared/db");
const cryptoUrl = import.meta.resolve("@yourrank/shared/crypto");
const cryptoUrlTs = import.meta.resolve("@yourrank/shared/crypto");
const telegramUrl = import.meta.resolve("../telegram.js");
const telegramUrlTs = import.meta.resolve("../telegram.ts");
const realDb = await import(dbUrl);
const realCrypto = await import(cryptoUrl);
const realTelegram = await import(telegramUrl);

const mockOne = mock<(...args: any[]) => Promise<any>>(() => Promise.resolve(null));
const mockExec = mock<(...args: any[]) => Promise<any>>(() => Promise.resolve(undefined));
const mockQuery = mock<(...args: any[]) => Promise<any>>(() => Promise.resolve([]));

const dbMock = () => ({
  ...realDb,
  one: (...args: any[]) => mockOne(...args),
  exec: (...args: any[]) => mockExec(...args),
  query: (...args: any[]) => mockQuery(...args),
  getSql: () => null,
  withTransaction: async (fn: any) => fn({ one: (...a: any[]) => mockOne(...a), exec: (...a: any[]) => mockExec(...a), query: (...a: any[]) => mockQuery(...a) }),
});

const cryptoMock = () => ({
  ...realCrypto,
  encryptToken: (s: string) => `enc:${s}`,
  decryptToken: (enc: Buffer | string) => enc.toString().replace("enc:", ""),
  hashToken: async (s: string) => "hash:" + s,
  encrypt: (s: string) => s,
  decrypt: (s: string) => s,
  verifyHmacSha256Hex: async () => true,
  safeEqual: (a: string, b: string) => a === b,
  reencryptToken: (s: string) => s,
  isCurrentVersion: () => true,
  newClickRef: () => "ref",
  newLinkSlug: () => "abcd",
  newPostbackKey: () => "pbkey",
  newWebhookSecret: () => "secret",
});

const telegramMock = () => ({
  ...realTelegram,
  getMe: () => Promise.resolve({ id: 123456, username: "testbot", first_name: "Test Bot" }),
  setWebhook: () => Promise.resolve(true),
  deleteWebhook: () => Promise.resolve(true),
  getWebhookInfo: () => Promise.resolve({ url: "https://yourrank.site/hook/secret", pending_update_count: 0 }),
  sendMessage: () => Promise.resolve({ message_id: 1, chat: { id: 123456 } }),
  setMyCommands: () => Promise.resolve(true),
});

mock.module(dbUrl, dbMock);
mock.module(dbUrlTs, dbMock);
mock.module(cryptoUrl, cryptoMock);
mock.module(cryptoUrlTs, cryptoMock);
mock.module(telegramUrl, telegramMock);
mock.module(telegramUrlTs, telegramMock);

// ── Import real modules after mocks are registered ─────────────────────
import { buildDashboard } from "../dashboard.js";
import { sameOrigin } from "../dashboard-auth.js";
import { loginHtml, appHtml, clientScriptSource } from "../dashboard-views.js";

const testEnv = { RL_FAIL_OPEN: "true" } as any;

function resetMocks() {
  mockOne.mockImplementation(() => Promise.resolve(null));
  mockExec.mockImplementation(() => Promise.resolve(undefined));
  mockQuery.mockImplementation((sql: string) => {
    if (typeof sql === "string" && sql.includes("FROM sessions")) {
      return Promise.resolve([{ user_id: "u-1", created_at: new Date(), age: 0 }]);
    }
    return Promise.resolve([]);
  });
}

// ── Unit tests for pure helpers and views ─────────────────────────────
describe("sameOrigin", () => {
  const publicBaseUrl = "https://yourrank.site";

  it("allows GET requests without Origin", () => {
    const req = new Request("https://yourrank.site/bot/dashboard", { method: "GET" });
    expect(sameOrigin(req, publicBaseUrl)).toBe(true);
  });

  it("rejects cross-origin POST", () => {
    const req = new Request("https://yourrank.site/bot/dash/api/bots", {
      method: "POST",
      headers: { origin: "https://evil.com" },
    });
    expect(sameOrigin(req, publicBaseUrl)).toBe(false);
  });

  it("allows same-origin POST matching publicBaseUrl", () => {
    const req = new Request("https://yourrank.site/bot/dash/api/bots", {
      method: "POST",
      headers: { origin: "https://yourrank.site" },
    });
    expect(sameOrigin(req, publicBaseUrl)).toBe(true);
  });

  it("allows local/preview origin matching Host header", () => {
    const req = new Request("http://localhost:8787/bot/dash/api/bots", {
      method: "POST",
      headers: { origin: "http://localhost:8787", host: "localhost:8787" },
    });
    expect(sameOrigin(req, publicBaseUrl)).toBe(true);
  });
});

describe("dashboard views", () => {
  it("loginHtml does not contain inline event handlers", () => {
    const html = loginHtml("testbot", true, "nonce123");
    expect(html).toContain('data-action="devLogin"');
    expect(html).toContain('data-onauth="onTgAuth"');
    expect(html).toContain('nonce="nonce123"');
    expect(html).not.toContain("onclick=");
    expect(html).not.toContain("onfocus=");
    expect(html).not.toContain("onblur=");
  });

  it("renders the Telegram pages in the shared dashboard shell", () => {
    const html = appHtml({ display_name: "Test", email: "test@example.com", plan: "free" }, "https://yourrank.site", "nonce123", "offers");
    // Same rail, topbar and stylesheets as the leaderboard dashboard.
    expect(html).toContain('<aside class="lb-side" id="lbSide"');
    expect(html).toContain('<link rel="stylesheet" href="/assets/shell-nav.css"><link rel="stylesheet" href="/assets/ui.css"><link rel="stylesheet" href="/assets/dashboard-v4.css">');
    // Product context stays on the main rail, without a duplicate Product nav.
    expect(html).not.toContain('class="lb-product-link"');
    expect(html).toContain('data-product-link="telegram"');
    expect(html).toMatch(/data-nav="telegram"[^>]*aria-current="page"/);
    expect(html).toContain('<nav class="v3-tabs telegram-tabs" aria-label="Telegram pages"');
    expect(html).toContain('href="/dashboard/telegram/offers" aria-current="page">Offers</a>');
    expect(html).toContain('<nav class="v3-crumbs" aria-label="Breadcrumb">');
    // One shell, not the product header stacked on a second rail.
    expect(html).not.toContain("gm-shell-nav");
    expect(html).not.toContain('<aside class="side"');
    expect((html.match(/<main/g) || []).length).toBe(1);
    expect((html.match(/<h1/g) || []).length).toBe(1);
  });

  // Each Telegram route is its own document and renders only its own panel, so
  // action markup is asserted per page rather than all on one stacked document.
  it("appHtml loads the external client script and keeps markup data-action based", () => {
    const user = { display_name: "Test", email: "test@example.com", plan: "free" };
    const overview = appHtml(user, "https://yourrank.site", "nonce123", "overview");
    expect(overview).toContain('<script src="/bot/dash/client.js"></script>');
    // Signing out is the dashboard shell's account menu (a POST form) now that
    // /bot/* renders in that shell instead of its own rail.
    expect(overview).toContain('action="/bot/auth/logout?next=%2Fdashboard%2Ftelegram"');
    expect(overview).not.toContain('<div class="panel" data-page="settings">');
    expect(overview).toContain('nonce="nonce123"');
    expect(overview).not.toContain("gm-shell-nav");
    expect(overview).not.toContain("onclick=");
    expect(overview).not.toContain("onfocus=");
    expect(overview).not.toContain("onblur=");

    expect(appHtml(user, "https://yourrank.site", "nonce123", "bots")).toContain('data-action="connectBot"');
    const offers = appHtml(user, "https://yourrank.site", "nonce123", "offers");
    expect(offers).toContain('data-action="createOffer"');
    expect(offers).toContain("postbackStatus");
    expect(offers).toContain("Create an offer");
    expect(offers).toContain("Offer results");
    expect(offers.indexOf("Create an offer")).toBeLessThan(offers.indexOf("Offer results"));
    expect(offers).toContain("How tracking works");
    expect(offers).toContain("Revenue");
    expect(offers).toContain("Last activity");
    expect(offers).toContain('colspan="11"');
    expect(offers).not.toContain("Click metrics cover the last 90 days");
    expect(offers).not.toContain("Reported revenue");
    expect(appHtml(user, "https://yourrank.site", "nonce123", "broadcasts")).toContain('data-action="sendBroadcast"');
  });

  it("renders one offers metric glossary and bot setup guidance for empty broadcasts", () => {
    const user = { display_name: "Test", email: "test@example.com", plan: "free" };
    const offers = appHtml(user, "https://yourrank.site", "nonce123", "offers");
    expect((offers.match(/<summary[^>]*>How tracking works<\/summary>/g) || []).length).toBe(1);
    const broadcasts = appHtml(user, "https://yourrank.site", "nonce123", "broadcasts");
    expect(broadcasts).toContain('id="bcList"');
    expect(broadcasts).toContain('id="bcSetupState"');
    expect(broadcasts).toMatch(/id="bcComposer"[^>]*\shidden/);
    expect(clientScriptSource()).toContain("No broadcasts yet. Connect an active bot to send your first message.");
    expect(appHtml(user, "https://yourrank.site", "nonce123", "bots")).toContain('href="https://t.me/BotFather"');
  });

  it("gates empty list controls and avoids page-zero pagination", () => {
    const js = clientScriptSource();
    expect(js).toContain("wrap.hidden = self.all.length === 0");
    expect(js).toContain("this.controls.hidden = this.all.length === 0");
    expect(js).toContain("reported_revenue");
    expect(js).toContain("last_activity_at");
    expect(js).toContain("Extra results not connected");
    expect(js).toContain("emptyAllMarkup");
    expect(js).not.toContain("This does not indicate that an individual offer is converting.");
    expect(js).toContain("this.pageInfo.textContent = total ? 'Page '+this.page+' of '+this.totalPages+' ('+total+')' : ''");
    // Broadcasts need an active bot, so availability keys off activeBots — a
    // disconnected or revoked bot must not unlock the composer.
    expect(js).toContain("setBroadcastAvailability(activeBots.length > 0)");
    expect(js).toContain("page !== 'commands' || bots.length > 0");
    expect(js).toContain("const readRequest = !opts || !opts.method || opts.method.toUpperCase() === 'GET'");
    expect(js).toContain("const requestOpts = controller");
  });

  it("links the shared shell styles and keeps the skip link keyboard-reachable", () => {
    const html = appHtml({ display_name: "Test", email: "test@example.com", plan: "free" }, "https://yourrank.site", "nonce123", "overview", '<header class="gm-shell-nav"></header>');
    expect(html).toContain('<link rel="stylesheet" href="/assets/shell-nav.css">');
    expect(html).toContain('<a href="#main-content" class="skip-link">Skip to main content</a>');
  });

  it("clientScriptSource emits parseable JavaScript", () => {
    // The script is built from a template literal, so escape sequences like
    // \\t are interpreted at build time and can emit raw control characters
    // into the served file. A single unparseable line kills the whole
    // dashboard silently, so the emitted source must be parsed here.
    const js = clientScriptSource();
    expect(() => new Function(js)).not.toThrow();
  });

  it("clientScriptSource normalizes command input on whitespace and @", () => {
    const js = clientScriptSource();
    const normalize = new Function(
      `${js.slice(js.indexOf("function normalizeCommandInput"), js.indexOf("async function addCommand"))}
       return normalizeCommandInput;`
    )() as (raw: string) => string;
    expect(normalize("/Start@MyBot")).toBe("start");
    expect(normalize(" /help me")).toBe("help");
    expect(normalize("code\tnow")).toBe("code");
    expect(normalize("rank\nboard")).toBe("rank");
  });

  it("clientScriptSource handles dashboard actions without inline event handlers", () => {
    const js = clientScriptSource();
    expect(js).toContain('data-action="checkHealth"');
    expect(js).toContain('data-action="disconnectBot"');
    expect(js).toContain('data-action="reconnectBot"');
    expect(js).not.toContain("onclick=");
    expect(js).not.toContain("onfocus=");
    expect(js).not.toContain("onblur=");
  });

  it("keeps the test-message form hidden until a bot is selected", () => {
    const html = appHtml(
      { display_name: "Test", email: "test@example.com", plan: "free" },
      "https://yourrank.site",
      "nonce123",
      "bots"
    );
    expect(html).toContain('id="testMsgPanel" hidden');
    expect(clientScriptSource()).toContain("if (!__testBotId) return toast('Select a bot first')");
  });

  it("keeps command editing on Commands and preserves selected bot context", () => {
    const html = appHtml(
      { display_name: "Test", email: "test@example.com", plan: "free" },
      "https://yourrank.site",
      "nonce123",
      "commands"
    );
    expect(html).toContain('id="botSelect"');
    // The commands panel renders only on the commands route; its wrapper carries
    // the page key and the customize card inside it is what gets toggled.
    expect(html).toContain('data-page="commands"');
    expect(html).toContain('id="customizePanel"');
    expect(clientScriptSource()).toContain('/dashboard/telegram/commands?bot=');
    expect(clientScriptSource()).toContain("requestedBotId");
  });

  it("appHtml renders each page with its own page key and includes the .hidden rule", () => {
    for (const page of ["overview", "bots", "offers", "commands", "broadcasts"]) {
      const html = appHtml(
        { display_name: "Test", email: "test@example.com", plan: "free" },
        "https://yourrank.site",
        "nonce123",
        page
      );
      expect(html).toContain(`<body class="yr-ui" data-page="${page}">`);
      // Without this rule showPage() cannot hide other pages' sections and
      // every route renders the same stacked UI.
      expect(html).toContain(".hidden { display: none !important; }");
    }
  });
});

// ── Dashboard route integration tests ─────────────────────────────────
describe("buildDashboard", () => {
  const app = buildDashboard();

  beforeEach(() => {
    resetMocks();
    process.env.LOGIN_BOT_USERNAME = "testbot";
    process.env.ALLOW_DEV_LOGIN = "1";
    process.env.LOGIN_BOT_TOKEN = "test_token";
    process.env.PUBLIC_BASE_URL = "https://yourrank.site";
  });

  it("GET /dashboard returns the login page when not authenticated", async () => {
    const req = new Request("http://localhost:8787/dashboard");
    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-action="devLogin"');
    expect(html).toContain('data-onauth="onTgAuth"');
    const csp = res.headers.get("content-security-policy") || "";
    const scriptSrc = csp.split(";").find((s) => s.trim().startsWith("script-src")) || "";
    expect(scriptSrc).toContain("nonce-");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it("POST /auth/dev returns a session cookie for local dev login", async () => {
    mockOne.mockImplementation(() => Promise.resolve({ id: "u-1" }));
    const req = new Request("http://localhost:8787/auth/dev", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:8787" },
      body: JSON.stringify({ telegram_user_id: 123456 }),
    });
    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(res.headers.get("set-cookie")).toContain("yr_session");
  });

  it("POST /auth/logout returns JSON when Accept is application/json", async () => {
    const req = new Request("http://localhost:8787/auth/logout", {
      method: "POST",
      headers: { accept: "application/json" },
    });
    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(res.headers.get("set-cookie")).toContain("yr_session");
  });

  it("POST /auth/logout redirects to /dashboard/telegram for form/logout button submission", async () => {
    const req = new Request("http://localhost:8787/auth/logout", { method: "POST" });
    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/dashboard/telegram");
  });

  it("GET /dashboard returns the app HTML when authenticated", async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("FROM sessions")) return Promise.resolve([{ user_id: "u-1", created_at: new Date(), age: 0 }]);
      return Promise.resolve([]);
    });
    const req = new Request("http://localhost:8787/dashboard", {
      headers: { cookie: "yr_session=token123" },
    });
    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<script src="/bot/dash/client.js"></script>');
    // The overview route renders the overview panel; connecting a bot lives on
    // the Bots page, so assert the shell + account menu here instead.
    expect(html).toContain('action="/bot/auth/logout?next=%2Fdashboard%2Ftelegram"');
    expect(html).not.toContain("onclick=");

    const csp = res.headers.get("content-security-policy") || "";
    const m = csp.match(/nonce-([a-f0-9]+)/);
    expect(m).toBeTruthy();
    expect(html).toContain(`nonce="${m![1]}"`);
  });

  it("serves canonical Telegram pages and permanently redirects legacy page routes", async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("FROM sessions")) return Promise.resolve([{ user_id: "u-1", created_at: new Date(), age: 0 }]);
      return Promise.resolve([]);
    });
    const canonical = buildDashboard({ canonical: true });
    const page = await canonical.fetch(new Request("http://localhost:8788/bots", {
      headers: { cookie: "yr_session=token123" },
    }), testEnv);
    expect(page.status).toBe(200);
    expect((await page.text())).toContain(">Bot<");
    const canonicalDevLogin = await canonical.fetch(new Request("http://localhost:8788/auth/dev", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:8788" },
      body: JSON.stringify({ telegram_user_id: 123456 }),
    }), testEnv);
    expect(canonicalDevLogin.status).toBe(404);

    const legacy = buildDashboard({ legacyPages: true });
    const redirect = await legacy.fetch(new Request("http://localhost:8788/dashboard"), testEnv);
    expect(redirect.status).toBe(301);
    expect(redirect.headers.get("location")).toBe("/dashboard/telegram");
  });

  it("POST /dash/api/bots connects a bot and returns its info", async () => {
    mockOne.mockImplementation((sql: string) => {
      if (sql.includes("SELECT status FROM users")) return Promise.resolve({ status: "active" });
      if (sql.includes("SELECT plan, plan_expires_at")) return Promise.resolve({ plan: "free", plan_expires_at: null });
      if (sql.includes("INSERT INTO bots")) return Promise.resolve({ id: "b-1", username: "testbot" });
      if (sql.includes("count(*)")) return Promise.resolve({ n: 0 });
      return Promise.resolve(null);
    });
    const req = new Request("http://localhost:8787/dash/api/bots", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://yourrank.site",
        cookie: "yr_session=token123",
      },
      body: JSON.stringify({ token: "123456:ABC-DEF" }),
    });
    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.username).toBe("testbot");
    expect(body.try_it).toBe("https://t.me/testbot");
  });

  it("GET /dash/api/bots/:id/health returns webhook status", async () => {
    mockOne.mockImplementation((sql: string) => {
      if (sql.includes("SELECT status FROM users")) return Promise.resolve({ status: "active" });
      if (sql.includes("SELECT plan, plan_expires_at")) return Promise.resolve({ plan: "free", plan_expires_at: null });
      if (sql.includes("FROM bots") && sql.includes("webhook_secret")) {
        return Promise.resolve({ token_encrypted: "enc:123456:ABC-DEF", webhook_secret: "secret" });
      }
      return Promise.resolve(null);
    });
    const req = new Request("http://localhost:8787/dash/api/bots/b-1/health", {
      headers: { cookie: "yr_session=token123" },
    });
    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.configured).toBe(true);
    expect(body.url).toBe("https://yourrank.site/hook/secret");
  });

  it("GET /dash/api/offers includes reported revenue and last activity", async () => {
    mockOne.mockImplementation((sql: string) => {
      if (sql.includes("SELECT status FROM users")) return Promise.resolve({ status: "active" });
      return Promise.resolve(null);
    });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("FROM sessions")) return Promise.resolve([{ user_id: "u-1", created_at: new Date(), age: 0 }]);
      if (sql.includes("FROM offers o")) return Promise.resolve([]);
      return Promise.resolve([]);
    });
    const req = new Request("http://localhost:8787/dash/api/offers", {
      headers: { cookie: "yr_session=token123" },
    });
    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(200);
    expect(await res.json() as any).toEqual([]);
    const offersSql = mockQuery.mock.calls
      .map(([sql]) => sql)
      .find((sql) => typeof sql === "string" && sql.includes("FROM offers o"));
    expect(offersSql).toContain("reported_revenue");
    expect(offersSql).toContain("last_activity_at");
    expect(offersSql).toContain("conversion_by_currency");
  });

  it("POST /dash/api/bots/:id/disconnect revokes the bot", async () => {
    mockOne.mockImplementation((sql: string) => {
      if (sql.includes("SELECT status FROM users")) return Promise.resolve({ status: "active" });
      if (sql.includes("SELECT id, token_encrypted, webhook_secret FROM bots")) {
        return Promise.resolve({ id: "b-1", token_encrypted: "enc:123456:ABC-DEF", webhook_secret: "secret" });
      }
      if (sql.includes("UPDATE bots SET status = 'revoked'")) return Promise.resolve({ id: "b-1" });
      return Promise.resolve(null);
    });
    const req = new Request("http://localhost:8787/dash/api/bots/b-1/disconnect", {
      method: "POST",
      headers: { origin: "https://yourrank.site", cookie: "yr_session=token123" },
    });
    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.webhook_removed).toBe(true);
  });

  it("POST /dash/api/bots/:id/reconnect reactivates the bot", async () => {
    mockOne.mockImplementation((sql: string) => {
      if (sql.includes("SELECT status FROM users")) return Promise.resolve({ status: "active" });
      if (sql.includes("SELECT id, token_encrypted, webhook_secret")) {
        return Promise.resolve({ id: "b-1", token_encrypted: "enc:123456:ABC-DEF", webhook_secret: "secret", status: "active" });
      }
      if (sql.includes("UPDATE bots SET status = 'active'")) return Promise.resolve({ id: "b-1", username: "testbot" });
      return Promise.resolve(null);
    });
    const req = new Request("http://localhost:8787/dash/api/bots/b-1/reconnect", {
      method: "POST",
      headers: { origin: "https://yourrank.site", cookie: "yr_session=token123" },
    });
    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.username).toBe("testbot");
  });

  it("DELETE /dash/api/bots/:id permanently deletes the bot", async () => {
    mockOne.mockImplementation((sql: string) => {
      if (sql.includes("SELECT status FROM users")) return Promise.resolve({ status: "active" });
      if (sql.includes("SELECT id, token_encrypted, status FROM bots")) {
        return Promise.resolve({ id: "b-1", token_encrypted: "enc:123456:ABC-DEF", status: "active" });
      }
      return Promise.resolve(null);
    });
    mockExec.mockImplementation(() => Promise.resolve([{ id: "b-1" }]));
    const req = new Request("http://localhost:8787/dash/api/bots/b-1", {
      method: "DELETE",
      headers: { origin: "https://yourrank.site", cookie: "yr_session=token123" },
    });
    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
  });

  it("POST /dash/api/bots/:id/test-message sends a Telegram DM", async () => {
    mockOne.mockImplementation((sql: string) => {
      if (sql.includes("SELECT status FROM users")) return Promise.resolve({ status: "active" });
      if (sql.includes("SELECT token_encrypted FROM bots")) return Promise.resolve({ token_encrypted: "enc:123456:ABC-DEF" });
      return Promise.resolve(null);
    });
    const req = new Request("http://localhost:8787/dash/api/bots/b-1/test-message", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://yourrank.site", cookie: "yr_session=token123" },
      body: JSON.stringify({ chat_id: 123456, text: "Hello from dashboard" }),
    });
    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.message_id).toBe(1);
  });

  it("DELETE /dash/api/commands/:id resyncs Telegram's command menu", async () => {
    mockOne.mockImplementation((sql: string) => {
      if (sql.includes("SELECT status FROM users")) return Promise.resolve({ status: "active" });
      if (sql.includes("DELETE FROM bot_commands")) return Promise.resolve({ id: "c-1", bot_id: "b-1" });
      if (sql.includes("SELECT token_encrypted FROM bots WHERE id = $1 AND status = 'active'")) {
        return Promise.resolve({ token_encrypted: "enc:123456:ABC-DEF" });
      }
      return Promise.resolve(null);
    });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("FROM sessions")) return Promise.resolve([{ user_id: "u-1", created_at: new Date(), age: 0 }]);
      if (sql.includes("FROM bot_commands")) return Promise.resolve([]);
      return Promise.resolve([]);
    });
    const req = new Request("http://localhost:8787/dash/api/commands/c-1", {
      method: "DELETE",
      headers: { origin: "https://yourrank.site", cookie: "yr_session=token123" },
    });
    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(200);
    expect(await res.json() as any).toEqual({ ok: true });
    expect(mockQuery.mock.calls.some(([sql]) => typeof sql === "string" && sql.includes("FROM bot_commands"))).toBe(true);
  });

  it("GET /dash/api/broadcasts/audience returns the reachable subscriber count", async () => {
    mockOne.mockImplementation((sql: string) => {
      if (sql.includes("SELECT status FROM users")) return Promise.resolve({ status: "active" });
      if (sql.includes("FROM bot_subscribers")) return Promise.resolve({ count: 42 });
      return Promise.resolve(null);
    });
    const req = new Request("http://localhost:8787/dash/api/broadcasts/audience?bot_id=b-1", {
      headers: { cookie: "yr_session=token123" },
    });
    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).count).toBe(42);
  });

  it("GET /dash/api/broadcasts/audience requires bot_id", async () => {
    mockOne.mockImplementation((sql: string) =>
      sql.includes("SELECT status FROM users") ? Promise.resolve({ status: "active" }) : Promise.resolve(null));
    const req = new Request("http://localhost:8787/dash/api/broadcasts/audience", {
      headers: { cookie: "yr_session=token123" },
    });
    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(400);
  });

  it("DELETE /dash/api/broadcasts/:id cancels a scheduled broadcast", async () => {
    mockOne.mockImplementation((sql: string) => {
      if (sql.includes("SELECT status FROM users")) return Promise.resolve({ status: "active" });
      return Promise.resolve(null);
    });
    mockExec.mockImplementation(() => Promise.resolve([{ id: "bc-1" }]));
    const req = new Request("http://localhost:8787/dash/api/broadcasts/bc-1", {
      method: "DELETE",
      headers: { origin: "https://yourrank.site", cookie: "yr_session=token123" },
    });
    const res = await app.fetch(req, testEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
  });
});
