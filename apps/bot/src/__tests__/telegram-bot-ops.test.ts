// Telegram bot operations coverage, complementing dashboard.test.ts and
// broadcasts.test.ts:
//   bot connection (invalid/valid token, webhook failure)
//   test message (success, failed delivery)
//   automations = custom commands (create/toggle/edit/delete,
//     UI-vs-backend consistency for the enabled state)
//   broadcasts (create, empty recipient list, duplicate prevention,
//     failed delivery, cancel)
//
// Mock pattern mirrors dashboard.test.ts: process-global module mocks with
// switchable Telegram behavior via `tg` state.

import { describe, it, expect, mock, beforeEach } from "bun:test";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const dbUrl = import.meta.resolve("@yourrank/shared/db");
const cryptoUrl = import.meta.resolve("@yourrank/shared/crypto");
const telegramUrl = import.meta.resolve("../telegram.js");
const telegramUrlTs = import.meta.resolve("../telegram.ts");
const dbUrlTs = import.meta.resolve("@yourrank/shared/db");
const cryptoUrlTs = import.meta.resolve("@yourrank/shared/crypto");
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

// Switchable Telegram API behavior per test.
const tg: Record<string, (...a: any[]) => Promise<any>> = {
  getMe: async () => ({ id: 123456, username: "testbot", first_name: "Test Bot" }),
  setWebhook: async () => true,
  deleteWebhook: async () => true,
  sendMessage: async () => ({ message_id: 42, chat: { id: 123456 } }),
  sendPhoto: async () => ({ message_id: 43, chat: { id: 123456 } }),
  getWebhookInfo: async () => ({ url: "https://yourrank.site/hook/secret", pending_update_count: 0 }),
};

const telegramMock = () => ({
  ...realTelegram,
  getMe: (...a: any[]) => tg.getMe(...a),
  setWebhook: (...a: any[]) => tg.setWebhook(...a),
  deleteWebhook: (...a: any[]) => tg.deleteWebhook(...a),
  sendMessage: (...a: any[]) => tg.sendMessage(...a),
  sendPhoto: (...a: any[]) => tg.sendPhoto(...a),
  getWebhookInfo: (...a: any[]) => tg.getWebhookInfo(...a),
  setMyCommands: () => Promise.resolve(true),
});

mock.module(dbUrl, dbMock);
mock.module(dbUrlTs, dbMock);
mock.module(cryptoUrl, cryptoMock);
mock.module(cryptoUrlTs, cryptoMock);
mock.module(telegramUrl, telegramMock);
mock.module(telegramUrlTs, telegramMock);

import { buildDashboard } from "../dashboard.js";
import { processBroadcastBatch } from "../broadcasts.js";
import { clientScriptSource } from "../dashboard-views.js";

// sameOrigin() compares Origin against config.publicBaseUrl, which reads
// process.env live. dashboard.test.ts sets this mid-file; set it up front here.
process.env.PUBLIC_BASE_URL = "https://yourrank.site";

const testEnv = { RL_FAIL_OPEN: "true" } as any;
const app = buildDashboard();

const SRC = path.dirname(fileURLToPath(import.meta.url));

function resetMocks() {
  mockOne.mockReset();
  mockExec.mockReset();
  mockQuery.mockReset();
  mockOne.mockImplementation((sql: string) => {
    if (typeof sql === "string" && sql.includes("SELECT status FROM users")) return Promise.resolve({ status: "active" });
    return Promise.resolve(null);
  });
  mockExec.mockImplementation(() => Promise.resolve(undefined));
  mockQuery.mockImplementation((sql: string) => {
    if (typeof sql === "string" && sql.includes("FROM sessions")) {
      return Promise.resolve([{ user_id: "u-1", created_at: new Date(), age: 0 }]);
    }
    return Promise.resolve([]);
  });
  tg.getMe = async () => { if (process.env.DBG) console.log("MOCK getMe called"); return { id: 123456, username: "testbot", first_name: "Test Bot" }; };
  tg.setWebhook = async () => true;
  tg.sendMessage = async () => ({ message_id: 42, chat: { id: 123456 } });
}

function dashReq(pathname: string, method = "GET", body?: unknown): Request {
  const init: RequestInit = {
    method,
    headers: { cookie: "yr_session=token123" },
  };
  if (method !== "GET") (init.headers as any).origin = "https://yourrank.site";
  if (body !== undefined) {
    (init.headers as any)["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return new Request(`http://localhost:8787/dash/api${pathname}`, init);
}

function mockAuthedUser(plan = "pro") {
  mockOne.mockImplementation((sql: string) => {
    if (sql.includes("SELECT status FROM users")) return Promise.resolve({ status: "active" });
    if (sql.includes("SELECT plan, plan_expires_at")) return Promise.resolve({ plan, plan_expires_at: null });
    return Promise.resolve(null);
  });
}

beforeEach(() => resetMocks());

// --- Bot connection -----------------------------------------------------------

describe("bot connection", () => {
  it("rejects an invalid token before touching the database", async () => {
    tg.getMe = async () => { throw new Error("401 Unauthorized"); };
    const res = await app.fetch(dashReq("/bots", "POST", { token: "999:BAD-TOKEN" }), testEnv);
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toMatch(/rejected that token/i);
    const wroteBot = mockOne.mock.calls.some(([sql]) => typeof sql === "string" && sql.includes("INSERT INTO bots"));
    expect(wroteBot).toBe(false);
  });

  it("activates a valid token only after Telegram confirms the webhook", async () => {
    const calls: string[] = [];
    tg.setWebhook = async () => { calls.push("setWebhook"); return true; };
    mockOne.mockImplementation((sql: string) => {
      if (sql.includes("SELECT status FROM users")) return Promise.resolve({ status: "active" });
      if (sql.includes("SELECT plan, plan_expires_at")) return Promise.resolve({ plan: "free", plan_expires_at: null });
      if (sql.includes("count(*)")) return Promise.resolve({ n: 0 });
      if (sql.includes("INSERT INTO bots")) return Promise.resolve({ id: "b-1", username: "testbot" });
      if (sql.includes("UPDATE bots SET status = 'active'")) { calls.push("activate"); return Promise.resolve({ id: "b-1" }); }
      return Promise.resolve(null);
    });
    const res = await app.fetch(dashReq("/bots", "POST", { token: "123456:ABC-DEF" }), testEnv);
    expect(res.status).toBe(200);
    // H-20: activation must happen strictly after the webhook is set.
    expect(calls).toEqual(["setWebhook", "activate"]);
  });

  it("leaves the bot pending (not active) when setWebhook fails", async () => {
    tg.setWebhook = async () => { throw new Error("connection refused"); };
    mockOne.mockImplementation((sql: string) => {
      if (sql.includes("SELECT status FROM users")) return Promise.resolve({ status: "active" });
      if (sql.includes("SELECT plan, plan_expires_at")) return Promise.resolve({ plan: "free", plan_expires_at: null });
      if (sql.includes("count(*)")) return Promise.resolve({ n: 0 });
      if (sql.includes("INSERT INTO bots")) return Promise.resolve({ id: "b-1", username: "testbot" });
      return Promise.resolve(null);
    });
    const res = await app.fetch(dashReq("/bots", "POST", { token: "123456:ABC-DEF" }), testEnv);
    expect(res.status).toBe(502);
    const body = (await res.json()) as any;
    expect(body.error).toMatch(/pending/);
    const activated = mockOne.mock.calls.some(([sql]) => typeof sql === "string" && sql.includes("UPDATE bots SET status = 'active'"));
    expect(activated).toBe(false);
  });
});

// --- Test message ---------------------------------------------------------------

describe("test message", () => {
  it("sends a test message and returns the Telegram message id", async () => {
    mockAuthedUser();
    mockOne.mockImplementation((sql: string) => {
      if (sql.includes("SELECT status FROM users")) return Promise.resolve({ status: "active" });
      if (sql.includes("SELECT token_encrypted FROM bots")) return Promise.resolve({ token_encrypted: "enc:123456:ABC-DEF" });
      return Promise.resolve(null);
    });
    const res = await app.fetch(dashReq("/bots/b-1/test-message", "POST", { chat_id: 123456, text: "hello" }), testEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.message_id).toBe(42);
  });

  it("surfaces failed delivery instead of pretending success", async () => {
    tg.sendMessage = async () => { throw new Error("Forbidden: bot was blocked by the user"); };
    mockOne.mockImplementation((sql: string) => {
      if (sql.includes("SELECT status FROM users")) return Promise.resolve({ status: "active" });
      if (sql.includes("SELECT token_encrypted FROM bots")) return Promise.resolve({ token_encrypted: "enc:123456:ABC-DEF" });
      return Promise.resolve(null);
    });
    const res = await app.fetch(dashReq("/bots/b-1/test-message", "POST", { chat_id: 123456, text: "hello" }), testEnv);
    expect(res.status).toBe(500);
    const body = (await res.json()) as any;
    expect(body.error).toMatch(/blocked/);
  });

  it("rejects an empty or whitespace-only test message", async () => {
    mockOne.mockImplementation((sql: string) => {
      if (sql.includes("SELECT status FROM users")) return Promise.resolve({ status: "active" });
      if (sql.includes("SELECT token_encrypted FROM bots")) return Promise.resolve({ token_encrypted: "enc:123456:ABC-DEF" });
      return Promise.resolve(null);
    });
    for (const text of ["", "   "]) {
      const res = await app.fetch(dashReq("/bots/b-1/test-message", "POST", { chat_id: 123456, text }), testEnv);
      expect(res.status).toBe(400);
    }
  });
});

// --- Automations (custom commands) ----------------------------------------------

describe("command automations", () => {
  it("creates an automation enabled by default", async () => {
    mockAuthedUser();
    mockOne.mockImplementation((sql: string) => {
      if (sql.includes("SELECT status FROM users")) return Promise.resolve({ status: "active" });
      if (sql.includes("SELECT id FROM bots")) return Promise.resolve({ id: "b-1" });
      if (sql.includes("INSERT INTO bot_commands")) {
        return Promise.resolve({ id: "c-1", command: "rules", response: "Be nice", is_enabled: true, buttons: [] });
      }
      return Promise.resolve(null);
    });
    const res = await app.fetch(dashReq("/bots/b-1/commands", "POST", { command: "rules", response: "Be nice" }), testEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.is_enabled).toBe(true);
    const insert = mockOne.mock.calls.find(([sql]) => typeof sql === "string" && sql.includes("INSERT INTO bot_commands"));
    expect(insert![0]).toContain("ON CONFLICT (bot_id, command)"); // re-adding re-enables, no dupes
  });

  it("rejects invalid command names, reserved names, and empty responses", async () => {
    mockOne.mockImplementation((sql: string) => {
      if (sql.includes("SELECT status FROM users")) return Promise.resolve({ status: "active" });
      if (sql.includes("SELECT id FROM bots")) return Promise.resolve({ id: "b-1" });
      if (sql.includes("INSERT INTO bot_commands")) return Promise.resolve({ id: "c-x", command: "x", response: "x", is_enabled: true, buttons: [] });
      return Promise.resolve(null);
    });
    for (const payload of [
      { command: "ab!cd", response: "hi" },
      { command: "start", response: "hi" }, // reserved built-in
      { command: "rules", response: "   " }, // whitespace-only response
    ]) {
      const res = await app.fetch(dashReq("/bots/b-1/commands", "POST", payload), testEnv);
      expect(res.status).toBe(400);
    }
    const wrote = mockOne.mock.calls.some(([sql]) => typeof sql === "string" && sql.includes("INSERT INTO bot_commands"));
    expect(wrote).toBe(false);
  });

  it("toggle off writes is_enabled=false, scoped to the bot owner", async () => {
    mockAuthedUser();
    mockOne.mockImplementation((sql: string) => {
      if (sql.includes("SELECT status FROM users")) return Promise.resolve({ status: "active" });
      if (sql.includes("UPDATE bot_commands")) {
        return Promise.resolve({ id: "c-1", bot_id: "b-1", command: "rules", response: "Be nice", is_enabled: false, buttons: [] });
      }
      return Promise.resolve(null);
    });
    const res = await app.fetch(dashReq("/commands/c-1", "PATCH", { is_enabled: false }), testEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.is_enabled).toBe(false);
    const update = mockOne.mock.calls.find(([sql]) => typeof sql === "string" && sql.includes("UPDATE bot_commands"));
    expect(update![0]).toContain("b.owner_id"); // tenant-scoped toggle
  });

  it("toggling a nonexistent command returns 404 so the UI cannot claim it changed", async () => {
    mockAuthedUser();
    const res = await app.fetch(dashReq("/commands/nope", "PATCH", { is_enabled: false }), testEnv);
    expect(res.status).toBe(404);
  });

  it("editing trims and re-validates the response", async () => {
    const res = await app.fetch(dashReq("/commands/c-1", "PATCH", { response: "x".repeat(1001) }), testEnv);
    expect(res.status).toBe(400);
  });

  it("deletes a command with an ownership check", async () => {
    mockAuthedUser();
    mockOne.mockImplementation((sql: string) => {
      if (sql.includes("SELECT status FROM users")) return Promise.resolve({ status: "active" });
      if (sql.includes("DELETE FROM bot_commands")) return Promise.resolve({ id: "c-1", bot_id: "b-1" });
      return Promise.resolve(null);
    });
    const res = await app.fetch(dashReq("/commands/c-1", "DELETE"), testEnv);
    expect(res.status).toBe(200);
    const del = mockOne.mock.calls.find(([sql]) => typeof sql === "string" && sql.includes("DELETE FROM bot_commands"));
    expect(del![0]).toContain("b.owner_id");
  });

  it("delete of someone else's command finds nothing", async () => {
    mockAuthedUser();
    const res = await app.fetch(dashReq("/commands/c-1", "DELETE"), testEnv);
    expect(res.status).toBe(404);
  });
});

// --- UI vs backend consistency (the "looks active but isn't" trap) ---------------

describe("enabled-state consistency between UI and backend", () => {
  it("every custom-command lookup in the engine is gated on is_enabled", () => {
    const src = readFileSync(path.join(SRC, "..", "botEngine.ts"), "utf8");
    const lookups = src.match(/SELECT[\s\S]*?FROM bot_commands[\s\S]*?`/g) || [];
    expect(lookups.length).toBeGreaterThanOrEqual(3); // menu list, slash exec, button exec
    for (const sql of lookups) {
      expect(sql).toContain("is_enabled");
    }
  });

  it("a disabled command tapped from a stale Telegram menu gets a graceful fallback", () => {
    const src = readFileSync(path.join(SRC, "..", "botEngine.ts"), "utf8");
    expect(src).toContain("That option is no longer available.");
  });

  it("the dashboard toggle applies the server response, never an optimistic guess", () => {
    const src = clientScriptSource();
    const toggle = src.match(/async function toggleCommand[\s\S]*?\n}/);
    expect(toggle).toBeTruthy();
    const body = toggle![0];
    // Error path must bail BEFORE state mutation.
    const errIdx = body.indexOf("r.error");
    const mutateIdx = body.indexOf("__commands[i] = r");
    expect(errIdx).toBeGreaterThanOrEqual(0);
    expect(mutateIdx).toBeGreaterThan(errIdx);
  });

  it("the dashboard renders enabled state from server data and surfaces resync warnings", () => {
    const src = clientScriptSource();
    expect(src).toContain("c.is_enabled?'On':'Off'");
    expect(src).toContain("r.warning");
  });
});

// --- Broadcasts -------------------------------------------------------------------

describe("broadcasts", () => {
  it("creates a broadcast in scheduled state", async () => {
    mockAuthedUser("pro");
    mockOne.mockImplementation((sql: string) => {
      if (sql.includes("SELECT status FROM users")) return Promise.resolve({ status: "active" });
      if (sql.includes("SELECT plan, plan_expires_at")) return Promise.resolve({ plan: "pro", plan_expires_at: null });
      if (sql.includes("SELECT id FROM bots")) return Promise.resolve({ id: "b-1" });
      return Promise.resolve(null);
    });
    mockExec.mockImplementation((sql: string) => {
      if (sql.includes("INSERT INTO broadcasts")) return Promise.resolve([{ id: "bc-1", status: "scheduled" }]);
      return Promise.resolve([]);
    });
    const res = await app.fetch(
      dashReq("/broadcasts", "POST", { bot_id: "11111111-1111-1111-1111-111111111111", body: "Big news" }),
      testEnv
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("scheduled");
  });

  it("rejects a whitespace-only broadcast body instead of queueing an empty message", async () => {
    mockAuthedUser("pro");
    mockOne.mockImplementation((sql: string) => {
      if (sql.includes("SELECT status FROM users")) return Promise.resolve({ status: "active" });
      if (sql.includes("SELECT plan, plan_expires_at")) return Promise.resolve({ plan: "pro", plan_expires_at: null });
      if (sql.includes("SELECT id FROM bots")) return Promise.resolve({ id: "b-1" });
      return Promise.resolve(null);
    });
    const res = await app.fetch(
      dashReq("/broadcasts", "POST", { bot_id: "11111111-1111-1111-1111-111111111111", body: "   " }),
      testEnv
    );
    expect(res.status).toBe(400);
    const inserted = mockExec.mock.calls.some(([sql]) => typeof sql === "string" && sql.includes("INSERT INTO broadcasts"));
    expect(inserted).toBe(false);
  });

  it("blocks broadcasts on the free plan", async () => {
    mockOne.mockImplementation((sql: string) => {
      if (sql.includes("SELECT status FROM users")) return Promise.resolve({ status: "active" });
      if (sql.includes("SELECT plan, plan_expires_at")) return Promise.resolve({ plan: "free", plan_expires_at: null });
      return Promise.resolve(null);
    });
    const res = await app.fetch(
      dashReq("/broadcasts", "POST", { bot_id: "11111111-1111-1111-1111-111111111111", body: "hi" }),
      testEnv
    );
    expect(res.status).toBe(402);
  });

  it("cancel only works before sending starts", async () => {
    mockAuthedUser();
    mockExec.mockImplementation(() => Promise.resolve([])); // no row with status='scheduled'
    const res = await app.fetch(dashReq("/broadcasts/bc-1", "DELETE"), testEnv);
    expect(res.status).toBe(404);
    const cancel = mockExec.mock.calls.find(([sql]) => typeof sql === "string" && sql.includes("status = 'canceled'"));
    expect(cancel![0]).toContain("b.status = 'scheduled'");
  });
});

// --- Broadcast worker: empty list, duplicates, failed delivery ---------------------

describe("broadcast worker", () => {
  const bc = {
    id: "bc-1",
    bot_id: "b-1",
    body: "Hello {name}",
    media_url: null,
    buttons: null,
    segment: null,
    cursor_tg_user_id: 100,
    sent_count: 0,
    fail_count: 0,
  };

  function mockClaim(overrides: Partial<typeof bc> = {}, subs: any[] = []) {
    mockOne.mockImplementation((sql: string) => {
      if (sql.includes("UPDATE broadcasts SET status = 'sending'")) return Promise.resolve({ ...bc, ...overrides });
      if (sql.includes("FROM bots")) return Promise.resolve({ token_encrypted: "enc:tok", status: "active" });
      return Promise.resolve(null);
    });
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("FROM bot_subscribers")) return Promise.resolve(subs);
      return Promise.resolve([]);
    });
  }

  function cursorUpdate(): { sql: string; params: any[] } | undefined {
    const call = mockQuery.mock.calls.find(
      ([sql]) => typeof sql === "string" && sql.includes("cursor_tg_user_id = $1")
    );
    return call ? { sql: call[0] as string, params: call[1] as any[] } : undefined;
  }

  it("claims broadcasts with SKIP LOCKED so two workers never send the same one twice", async () => {
    mockOne.mockImplementation(() => Promise.resolve(null)); // nothing due
    const done = await processBroadcastBatch();
    expect(done).toBe(false);
    const claim = mockOne.mock.calls.find(([sql]) => typeof sql === "string" && sql.includes("UPDATE broadcasts SET status = 'sending'"));
    expect(claim![0]).toContain("FOR UPDATE SKIP LOCKED");
  });

  it("finishes cleanly on an empty recipient list", async () => {
    mockClaim({ cursor_tg_user_id: 0 }, []); // first batch, zero subscribers
    const more = await processBroadcastBatch();
    expect(more).toBe(true);
    const finished = mockQuery.mock.calls.find(([sql]) => typeof sql === "string" && sql.includes("status = 'sent'"));
    expect(finished).toBeTruthy();
  });

  it("does not advance the cursor past unprocessed subscribers on a 429, so nobody is skipped or double-sent", async () => {
    mockClaim({}, [
      { tg_user_id: 101, first_name: "A", tg_username: "a" },
      { tg_user_id: 102, first_name: "B", tg_username: "b" },
      { tg_user_id: 103, first_name: "C", tg_username: "c" },
    ]);
    let n = 0;
    globalThis.fetch = (async () => {
      n++;
      if (n === 1) return new Response("{}", { status: 200 });
      return new Response(JSON.stringify({ parameters: { retry_after: 0 } }), { status: 429 });
    }) as any;
    await processBroadcastBatch();
    expect(n).toBe(2); // stopped at the rate limit
    const cur = cursorUpdate();
    expect(cur!.params[0]).toBe(101); // cursor = last PROCESSED sub; 102/103 retried next tick
    expect(cur!.params[1]).toBe(1); // sent_count += 1
    expect(cur!.params[2]).toBe(0); // fail_count += 0
  });

  it("marks 403 blocked users and never retries them", async () => {
    mockClaim({}, [{ tg_user_id: 101, first_name: "A", tg_username: "a" }]);
    globalThis.fetch = (async () => new Response("{}", { status: 403 })) as any;
    await processBroadcastBatch();
    const blocked = mockQuery.mock.calls.find(([sql]) => typeof sql === "string" && sql.includes("is_blocked = true"));
    expect(blocked).toBeTruthy();
    expect(blocked![1]).toEqual(["b-1", 101]);
    const cur = cursorUpdate();
    expect(cur!.params[0]).toBe(101); // advances past: no retry, no duplicate
    expect(cur!.params[2]).toBe(1); // counted as failed
  });

  it("counts generic send failures without stalling the broadcast", async () => {
    mockClaim({}, [
      { tg_user_id: 101, first_name: "A", tg_username: "a" },
      { tg_user_id: 102, first_name: "B", tg_username: "b" },
    ]);
    globalThis.fetch = (async () => new Response("server error", { status: 500 })) as any;
    await processBroadcastBatch();
    const cur = cursorUpdate();
    expect(cur!.params[0]).toBe(102); // both processed
    expect(cur!.params[2]).toBe(2); // both failed, none sent
  });

  it("personalizes {name} and HTML-escapes user content", async () => {
    mockClaim({ body: "Hi {name} <b>welcome</b>" }, [{ tg_user_id: 101, first_name: "<script>", tg_username: "a" }]);
    let sentBody = "";
    globalThis.fetch = (async (_url: any, init: any) => {
      sentBody = init.body;
      return new Response("{}", { status: 200 });
    }) as any;
    await processBroadcastBatch();
    const payload = JSON.parse(sentBody);
    expect(payload.text).toContain("&lt;script&gt;");
    expect(payload.text).toContain("&lt;b&gt;welcome&lt;/b&gt;"); // broadcast body escaped too
    expect(payload.parse_mode).toBe("HTML");
  });

  it("fails the broadcast instead of sending when the bot was disconnected", async () => {
    mockOne.mockImplementation((sql: string) => {
      if (sql.includes("UPDATE broadcasts SET status = 'sending'")) return Promise.resolve(bc);
      if (sql.includes("FROM bots")) return Promise.resolve({ token_encrypted: "enc:tok", status: "revoked" });
      return Promise.resolve(null);
    });
    await processBroadcastBatch();
    const failed = mockQuery.mock.calls.find(([sql]) => typeof sql === "string" && sql.includes("status = 'failed'"));
    expect(failed).toBeTruthy();
    const sent = mockQuery.mock.calls.some(([sql]) => typeof sql === "string" && sql.includes("FROM bot_subscribers"));
    expect(sent).toBe(false);
  });
});
