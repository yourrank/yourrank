import { giveawayRules, GIVEAWAY_CAPABILITIES } from "@yourrank/shared/giveaway-eligibility";
import { beforeAll, describe, expect, it } from "bun:test";
import { handleKickWebhook } from "../handlers/kick-webhook.js";
import {
  handleChatGiveawayDraw,
  handleChatGiveawayStart,
  handleChatGiveawayState,
  handleChatGiveawayStop,
} from "../handlers/chat-giveaways.js";
import { ROUTES as routes } from "../routes.js";

// ---------------------------------------------------------------------------
// /webhooks/kick: signed chat.message.sent events reach the chat-giveaway
// ingest; unsigned/foreign events never do; rewards keep their existing path.
// ---------------------------------------------------------------------------
let publicKeyPem;
let privateKey;

function toPem(buffer) {
  const b64 = Buffer.from(buffer).toString("base64").match(/.{1,64}/g).join("\n");
  return `-----BEGIN PUBLIC KEY-----\n${b64}\n-----END PUBLIC KEY-----`;
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  privateKey = pair.privateKey;
  publicKeyPem = toPem(await crypto.subtle.exportKey("spki", pair.publicKey));
});

async function signedRequest(eventType, payload, { signWith = privateKey, timestamp = new Date().toISOString() } = {}) {
  const body = JSON.stringify(payload);
  const messageId = crypto.randomUUID();
  const sig = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" }, signWith, new TextEncoder().encode(`${messageId}.${timestamp}.${body}`),
  );
  return new Request("https://yourrank.site/webhooks/kick", {
    method: "POST",
    headers: {
      "Kick-Event-Message-Id": messageId,
      "Kick-Event-Message-Timestamp": timestamp,
      "Kick-Event-Signature": Buffer.from(sig).toString("base64"),
      "Kick-Event-Type": eventType,
    },
    body,
  });
}

const chatPayload = (content, sender = { user_id: 222, username: "viewer" }) => ({
  message_id: crypto.randomUUID(),
  broadcaster: { user_id: 111, username: "streamer" },
  sender,
  content,
});

describe("Kick webhook: chat.message.sent", () => {
  it("passes a validly signed chat event to the chat-giveaway ingest", async () => {
    const seen = [];
    const res = await handleKickWebhook(await signedRequest("chat.message.sent", chatPayload("!win")), { KICK_WEBHOOK_PUBLIC_KEY: publicKeyPem }, {
      ingestChatMessage: async (payload) => { seen.push(payload); return { routed: true, matched: true, entered: true }; },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, chat: { routed: true, matched: true, entered: true } });
    expect(seen).toHaveLength(1);
    expect(seen[0].broadcaster.user_id).toBe(111);
    expect(seen[0].content).toBe("!win");
  });

  it("rejects chat events with an invalid signature before any ingest", async () => {
    const forged = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"],
    );
    let ingested = false;
    const res = await handleKickWebhook(
      await signedRequest("chat.message.sent", chatPayload("!win"), { signWith: forged.privateKey }),
      { KICK_WEBHOOK_PUBLIC_KEY: publicKeyPem },
      { ingestChatMessage: async () => { ingested = true; } },
    );
    expect(res.status).toBe(401);
    expect(ingested).toBe(false);
  });

  it("rejects stale timestamps and missing headers", async () => {
    let ingested = false;
    const stale = await handleKickWebhook(
      await signedRequest("chat.message.sent", chatPayload("!win"), { timestamp: new Date(Date.now() - 10 * 60_000).toISOString() }),
      { KICK_WEBHOOK_PUBLIC_KEY: publicKeyPem },
      { ingestChatMessage: async () => { ingested = true; } },
    );
    expect(stale.status).toBe(400);
    const missing = await handleKickWebhook(
      new Request("https://yourrank.site/webhooks/kick", { method: "POST", body: "{}" }),
      { KICK_WEBHOOK_PUBLIC_KEY: publicKeyPem },
      { ingestChatMessage: async () => { ingested = true; } },
    );
    expect(missing.status).toBe(400);
    expect(ingested).toBe(false);
  });

  it("keeps reward redemptions on the existing queue path, untouched by chat ingest", async () => {
    const sent = [];
    let ingested = false;
    const payload = { id: "r1", broadcaster: { user_id: 111 }, redeemer: { user_id: 222, username: "viewer" }, reward: { id: "rw", title: "T", cost: 10 }, status: "fulfilled" };
    const res = await handleKickWebhook(
      await signedRequest("channel.reward.redemption.updated", payload),
      { KICK_WEBHOOK_PUBLIC_KEY: publicKeyPem, EVENTS_QUEUE: { send: async (msg) => { sent.push(msg); } } },
      { ingestChatMessage: async () => { ingested = true; } },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, queued: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].payload).toMatchObject({ type: "kick-redemption", eventType: "channel.reward.redemption.updated", payload });
    expect(ingested).toBe(false);
  });

  it("acknowledges unrelated event types without ingesting", async () => {
    let ingested = false;
    const res = await handleKickWebhook(
      await signedRequest("channel.followed", { broadcaster: { user_id: 111 } }),
      { KICK_WEBHOOK_PUBLIC_KEY: publicKeyPem },
      { ingestChatMessage: async () => { ingested = true; } },
    );
    expect(await res.json()).toEqual({ ok: true, ignored: "channel.followed" });
    expect(ingested).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Dashboard API: connected Kick required, one active session, persisted draw.
// ---------------------------------------------------------------------------
const owner = { id: "user-1" };
const siteA = { id: "site-a", user_id: "user-1" };
const siteB = { id: "site-b", user_id: "user-2" };

function apiRequest(path, body) {
  return new Request(`https://yourrank.site${path}`, body === undefined ? {} : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

function deps(overrides = {}) {
  const d = {
    requireUser: async () => ({ user: owner, res: null }),
    getByUser: async () => siteA,
    getBoardById: async (_env, _userId, siteId) => (siteId === siteA.id ? siteA : null),
    requireSiteCapability: async (_user, _site, capability) => {
      expect(capability).toBe("canRoleManageRewards");
      return { role: "owner", res: null };
    },
    loadChatGiveawayConnection: async () => ({ connected: true, chatReady: true, channelName: "streamer", externalChannelId: "111" }),
    one: async () => null,
    query: async () => [],
    exec: async () => {},
    ...overrides,
  };
  d.transaction ||= (fn) => fn(async (sql, params) => {
    if (sql.includes("FROM chat_giveaway_entries e")) return d.query(sql, params);
    if (sql.startsWith("INSERT INTO chat_giveaway_draws")) return [];
    const row = await d.one(sql, params);
    return row ? [row] : [];
  });
  return d;
}

describe("Chat Giveaway API", () => {
  it("registers the server-backed routes alongside the legacy chatroom lookup", () => {
    const paths = routes.map((r) => `${r.method} ${r.path}`);
    for (const p of ["GET /api/giveaways/chat", "POST /api/giveaways/chat/start", "POST /api/giveaways/chat/stop", "POST /api/giveaways/chat/draw", "POST /api/giveaways/chat/entries/remove"]) {
      expect(paths).toContain(p);
    }
  });

  it("refuses to start without a connected Kick channel", async () => {
    let inserted = false;
    const res = await handleChatGiveawayStart(apiRequest("/api/giveaways/chat/start", { keyword: "!win" }), {}, deps({
      loadChatGiveawayConnection: async () => ({ connected: false, chatReady: false, channelName: null, externalChannelId: null }),
      one: async () => { inserted = true; return null; },
    }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("connected Kick channel");
    expect(inserted).toBe(false);
  });

  it("rejects unsupported eligibility and anti-abuse rules before writing a session", async () => {
    let wrote = false;
    for (const rules of [{ entryMode: "verified", vpnDetection: true }, { entryMode: "verified", duplicateDevice: true }, { entryMode: "chat", onePerIp: true }, { subscriberOnly: "yes" }]) {
      const res = await handleChatGiveawayStart(apiRequest("/api/giveaways/chat/start", { keyword: "!win", rules }), {}, deps({ one: async () => { wrote = true; } }));
      expect(res.status).toBe(400);
    }
    expect(wrote).toBe(false);
  });

  it("refuses to start when the chat subscription was not confirmed", async () => {
    const res = await handleChatGiveawayStart(apiRequest("/api/giveaways/chat/start", { keyword: "!win" }), {}, deps({
      loadChatGiveawayConnection: async () => ({ connected: true, chatReady: false, channelName: "streamer", externalChannelId: "111" }),
    }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("not subscribed");
  });

  it("starts an active session for a verified connected channel with a normalized keyword", async () => {
    const inserts = [];
    const res = await handleChatGiveawayStart(apiRequest("/api/giveaways/chat/start", { keyword: "  !WIN " }), {}, deps({
      one: async (sql, params) => {
        inserts.push({ sql, params });
        return { id: "gs-1", site_id: siteA.id, keyword: params[1], status: "active" };
      },
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(inserts[0].sql).toContain("INSERT INTO chat_giveaway_sessions");
    expect(inserts[0].params).toEqual([siteA.id, "!win", owner.id, giveawayRules({})]);
    expect(data.session).toMatchObject({ id: "gs-1", status: "active", keyword: "!win" });
    expect(data.entries).toEqual([]);
  });

  it("fails cleanly when a giveaway is already active instead of replacing it", async () => {
    const res = await handleChatGiveawayStart(apiRequest("/api/giveaways/chat/start", { keyword: "!win" }), {}, deps({
      one: async () => { throw Object.assign(new Error("duplicate key"), { code: "23505" }); },
    }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("already collecting");
  });

  it("rejects starting for a site the user cannot access", async () => {
    const res = await handleChatGiveawayStart(apiRequest("/api/giveaways/chat/start", { keyword: "!win", siteId: siteB.id }), {}, deps());
    expect(res.status).toBe(404);
  });

  it("stops a session without deleting entrants and reads them back from the database", async () => {
    const sql = [];
    const entries = [
      { id: "e1", giveaway_session_id: "gs-1", provider: "kick", provider_user_id: "222", username: "a", avatar_url: null, message: "!win", badges: [], entered_at: "t", eligibility_status: "eligible" },
      { id: "e2", giveaway_session_id: "gs-1", provider: "kick", provider_user_id: "333", username: "b", avatar_url: null, message: "!win", badges: [], entered_at: "t", eligibility_status: "eligible" },
    ];
    const res = await handleChatGiveawayStop(apiRequest("/api/giveaways/chat/stop", { sessionId: "gs-1" }), {}, deps({
      one: async (text, params) => {
        sql.push(text);
        return { id: "gs-1", site_id: siteA.id, keyword: "!win", status: "stopped", winner_entry_id: null, params };
      },
      query: async (text) => { sql.push(text); return entries; },
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(sql[0]).toContain("SET status = 'stopped'");
    expect(sql[0]).toContain("AND id = $2");
    expect(sql.some((s) => /DELETE/i.test(s))).toBe(false);
    expect(data.session.status).toBe("stopped");
    expect(data.entries).toHaveLength(2);
  });

  it("draws the winner only from persisted entries of the session and records it", async () => {
    const entries = [
      { id: "e1", giveaway_session_id: "gs-1", provider: "kick", provider_user_id: "222", username: "a", avatar_url: null, message: "!win", badges: [], entered_at: "t", eligibility_status: "eligible" },
      { id: "e2", giveaway_session_id: "gs-1", provider: "kick", provider_user_id: "333", username: "b", avatar_url: null, message: "!win", badges: [], entered_at: "t", eligibility_status: "eligible" },
    ];
    entries[0].eligibility_status = "pending_verification";
    let update = null;
    const res = await handleChatGiveawayDraw(apiRequest("/api/giveaways/chat/draw", { sessionId: "gs-1", entryIds: ["e1", "not-persisted"] }), {}, deps({
      one: async (text, params) => {
        if (text.startsWith("UPDATE")) { update = { text, params }; return null; }
        if (update) return { id: "gs-1", status: "completed", winner_entry_id: update.params[1] };
        return { id: "gs-1", site_id: siteA.id, keyword: "!win", status: "stopped" };
      },
      query: async () => entries,
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    // A forged client list cannot admit pending entries; the server chooses the eligible pool.
    expect(data.winner.id).toBe("e2");
    expect(update.params).toEqual(["gs-1", "e2", false, 60]);
    expect(update.text).toContain("status='completed'");
    expect(data.session.winner_entry_id).toBe("e2");
  });

  it("refuses to draw when there are no persisted entrants", async () => {
    const res = await handleChatGiveawayDraw(apiRequest("/api/giveaways/chat/draw", { sessionId: "gs-1" }), {}, deps({
      one: async () => ({ id: "gs-1", site_id: siteA.id, status: "stopped" }),
      query: async () => [],
    }));
    expect(res.status).toBe(409);
  });

  it("exposes connection + session + entries for the dashboard poll", async () => {
    const res = await handleChatGiveawayState(apiRequest("/api/giveaways/chat"), {}, deps({
      one: async () => ({ id: "gs-1", site_id: siteA.id, keyword: "!win", status: "active", winner_entry_id: null }),
      query: async () => [{ id: "e1", username: "a", provider_user_id: "222" }],
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      capabilities: GIVEAWAY_CAPABILITIES,
      connection: { connected: true, chatReady: true, channelName: "streamer", externalChannelId: "111" },
      session: { id: "gs-1", site_id: siteA.id, keyword: "!win", status: "active", winner_entry_id: null },
      entries: [{ id: "e1", username: "a", provider_user_id: "222" }],
      winner: null,
    });
  });

  it("denies members without the rewards capability", async () => {
    const res = await handleChatGiveawayState(apiRequest("/api/giveaways/chat"), {}, deps({
      requireSiteCapability: async () => ({ role: "moderator", res: new Response("forbidden", { status: 403 }) }),
    }));
    expect(res.status).toBe(403);
  });
});
