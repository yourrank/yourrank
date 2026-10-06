import { giveawayRules, GIVEAWAY_CAPABILITIES } from "@yourrank/shared/giveaway-eligibility";
import { beforeAll, describe, expect, it } from "bun:test";
import { handleKickWebhook } from "../handlers/kick-webhook.js";
import {
  handleChatGiveawayDraw,
  handleChatGiveawayFinalize,
  handleChatGiveawayStart,
  handleChatGiveawayState,
  handleChatGiveawayAddEntry,
  handleChatGiveawayClearEntries,
  handleChatGiveawayExcludeLinkedEntries,
  handleChatGiveawayIncludeLinkedEntry,
  handleChatGiveawayStop,
  handleChatGiveawayUpdateResponseRules,
} from "../handlers/chat-giveaways.js";
import { runGiveawayTimeouts } from "../chat-giveaway-service.js";
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
    const tournamentOutcome = { routed: false, matched: false, entered: false, duplicate: false, rejected: null, tournamentId: null };
    const res = await handleKickWebhook(await signedRequest("chat.message.sent", chatPayload("!win")), { KICK_WEBHOOK_PUBLIC_KEY: publicKeyPem }, {
      ingestChatMessage: async (payload) => { seen.push(payload); return { routed: true, matched: true, entered: true }; },
      ingestTournamentMessage: async () => tournamentOutcome,
      withTransaction: async (fn) => fn({ one: async () => ({ message_id: "m-1" }), unsafe: async () => [] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, duplicate: false, chat: { routed: true, matched: true, entered: true }, tournament: tournamentOutcome });
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

  it("marks chat events observed for the broadcaster inside the ingest transaction", async () => {
    const observed = [];
    const res = await handleKickWebhook(await signedRequest("chat.message.sent", chatPayload("!win")), { KICK_WEBHOOK_PUBLIC_KEY: publicKeyPem }, {
      ingestChatMessage: async () => ({ routed: true, matched: false }),
      ingestTournamentMessage: async () => ({}),
      markEventObserved: async (run, provider, externalChannelId, event) => { observed.push([provider, externalChannelId, event]); },
      withTransaction: async (fn) => fn({ one: async () => ({ message_id: "m-1" }), unsafe: async () => [] }),
    });
    expect(res.status).toBe(200);
    expect(observed).toEqual([["kick", "111", "chatEvents"]]);
  });

  it("marks reward events observed and still returns ok when the stamp fails", async () => {
    const observed = [];
    const sent = [];
    const payload = { id: "r1", broadcaster: { user_id: 111 }, redeemer: { user_id: 222 }, reward: { id: "rw" }, status: "fulfilled" };
    const res = await handleKickWebhook(
      await signedRequest("channel.reward.redemption.updated", payload),
      { KICK_WEBHOOK_PUBLIC_KEY: publicKeyPem, EVENTS_QUEUE: { send: async (msg) => { sent.push(msg); } } },
      { markEventObserved: async (_run, provider, externalChannelId, event) => { observed.push([provider, externalChannelId, event]); throw new Error("db down"); } },
    );
    expect(res.status).toBe(200);
    expect(observed).toEqual([["kick", "111", "rewardEvents"]]);
    expect(sent).toHaveLength(1);
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
    loadChannelEventDelivery: async () => ({
      rewardEventsSubscribedAt: new Date().toISOString(),
      chatEventsSubscribedAt: new Date().toISOString(),
      checkedAt: new Date().toISOString(),
    }),
    reconcileKickWebhookDelivery: async () => ({
      status: "ok",
      subscriptions: { rewardEvents: true, chatEvents: true },
      failedEvents: [],
    }),
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
    for (const p of ["GET /api/giveaways/chat", "POST /api/giveaways/chat/start", "POST /api/giveaways/chat/stop", "POST /api/giveaways/chat/draw", "POST /api/giveaways/chat/finalize", "POST /api/giveaways/chat/entries/add", "POST /api/giveaways/chat/entries/clear", "POST /api/giveaways/chat/entries/remove", "POST /api/giveaways/chat/entries/exclude", "POST /api/giveaways/chat/entries/include", "POST /api/giveaways/chat/response-rules"]) {
      expect(paths).toContain(p);
    }
  });

  it("starts a manual giveaway without loading Kick connection state", async () => {
    let inserted;
    let checkedConnection = false;
    const res = await handleChatGiveawayStart(apiRequest("/api/giveaways/chat/start", {
      mode: "manual",
      rules: { winnerRepeat: "again", excludePreviousWinners: true },
    }), {}, deps({
      loadChatGiveawayConnection: async () => { checkedConnection = true; throw new Error("should not load Kick"); },
      reconcileKickWebhookDelivery: async () => { throw new Error("should not reconcile Kick for a manual giveaway"); },
      one: async (sql, params) => {
        inserted = { sql, params };
        return { id: "gs-manual", site_id: siteA.id, provider: "manual", keyword: "manual", status: "active" };
      },
    }));
    expect(res.status).toBe(200);
    expect(checkedConnection).toBe(false);
    expect(inserted.sql).toContain("VALUES ($1, 'manual', 'manual', 'active'");
    expect(inserted.params).toEqual([siteA.id, owner.id, giveawayRules({ winnerRepeat: "again", excludePreviousWinners: true })]);
    expect((await res.json()).session).toMatchObject({ provider: "manual", keyword: "manual", status: "active" });
  });

  it("rejects Kick-only rules for manual giveaways with the compatibility message", async () => {
    let inserted = false;
    const res = await handleChatGiveawayStart(apiRequest("/api/giveaways/chat/start", {
      mode: "manual",
      rules: { subscriberOnly: true },
    }), {}, deps({
      loadChatGiveawayConnection: async () => { throw new Error("should not load Kick"); },
      one: async () => { inserted = true; return null; },
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Manual giveaways can't use Kick-only rules (members, verified entry, subscriber/VIP only, winner chat response).");
    expect(inserted).toBe(false);
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

  function addEntryDeps({
    session = {
      id: "gs-manual", site_id: siteA.id, provider: "manual", status: "active",
      rules: {}, winner_entry_id: null,
    },
    duplicate = null,
    previousWinner = false,
  } = {}) {
    const inserts = [];
    const storedEntries = [];
    const d = deps({
      one: async (sql, params) => {
        const text = String(sql);
        if (text.includes("FROM chat_giveaway_sessions") && text.includes("status = 'active'")) return session;
        if (text.includes("SELECT id FROM chat_giveaway_entries")) return duplicate;
        if (text.startsWith("INSERT INTO chat_giveaway_entries")) {
          inserts.push({ sql: text, params });
          const entry = {
            id: "entry-manual", giveaway_session_id: params[0], provider: "manual",
            provider_user_id: params[1], username: params[2], message: "", badges: [],
            eligibility_status: params[3], eligibility_reason: params[4],
          };
          storedEntries.push(entry);
          return entry;
        }
        if (text.includes("FROM chat_giveaway_sessions")) return session;
        return null;
      },
      query: async (sql) => {
        if (String(sql).includes("previous_winner")) return [{ viewer_id: null, previous_winner: previousWinner }];
        if (String(sql).includes("FROM chat_giveaway_entries")) return storedEntries;
        return [];
      },
    });
    return { d, inserts, storedEntries };
  }

  it("adds an entrant to an active manual session using a stable manual identity", async () => {
    const { d, inserts } = addEntryDeps();
    const res = await handleChatGiveawayAddEntry(apiRequest("/api/giveaways/chat/entries/add", {
      sessionId: "gs-manual", username: "  @Alice  ",
    }), {}, d);
    expect(res.status).toBe(200);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].sql).toContain("ON CONFLICT DO NOTHING");
    expect(inserts[0].params).toEqual(["gs-manual", "manual:alice", "Alice", "eligible", null]);
    expect((await res.json()).entries[0]).toMatchObject({
      provider: "manual", provider_user_id: "manual:alice", username: "Alice",
      message: "", eligibility_status: "eligible",
    });
  });

  it("rejects a case-insensitive duplicate username", async () => {
    const { d, inserts } = addEntryDeps({ duplicate: { id: "entry-existing" } });
    const res = await handleChatGiveawayAddEntry(apiRequest("/api/giveaways/chat/entries/add", {
      sessionId: "gs-manual", username: "ALICE",
    }), {}, d);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("ALICE is already entered.");
    expect(inserts).toHaveLength(0);
  });

  it("requires an active giveaway session before adding entrants", async () => {
    const { d, inserts } = addEntryDeps({ session: null });
    const res = await handleChatGiveawayAddEntry(apiRequest("/api/giveaways/chat/entries/add", {
      sessionId: "gs-manual", username: "Alice",
    }), {}, d);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Start a giveaway before adding entrants.");
    expect(inserts).toHaveLength(0);
  });

  it("rejects manual additions to Kick sessions with incompatible rules", async () => {
    const { d, inserts } = addEntryDeps({
      session: {
        id: "gs-kick", site_id: siteA.id, provider: "kick", status: "active",
        rules: { subscriberOnly: true },
      },
    });
    const res = await handleChatGiveawayAddEntry(apiRequest("/api/giveaways/chat/entries/add", {
      sessionId: "gs-kick", username: "Alice",
    }), {}, d);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Manual entrants can't meet this giveaway's Kick entry rules (members, verified entry, subscriber/VIP only, one account per IP).");
    expect(inserts).toHaveLength(0);
  });

  it("adds a manual entrant to a Kick session that requires a winner response", async () => {
    // Draw-phase rules (must respond / auto re-roll) are not entry gates: a
    // typed-in viewer can still be added, they just can't respond in chat.
    const { d, inserts } = addEntryDeps({
      session: {
        id: "gs-kick", site_id: siteA.id, provider: "kick", status: "active",
        rules: { winnerMustRespond: true, responseTimeout: 30, autoReroll: true },
      },
    });
    const res = await handleChatGiveawayAddEntry(apiRequest("/api/giveaways/chat/entries/add", {
      sessionId: "gs-kick", username: "Alice",
    }), {}, d);
    expect(res.status).toBe(200);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].params[1]).toBe("manual:alice");
  });

  it("still rejects winner-response rules for manual-mode giveaways", async () => {
    const res = await handleChatGiveawayStart(apiRequest("/api/giveaways/chat/start", {
      mode: "manual",
      rules: { winnerMustRespond: true },
    }), {}, deps({
      loadChatGiveawayConnection: async () => { throw new Error("should not load Kick"); },
      one: async () => null,
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Manual giveaways can't use Kick-only rules (members, verified entry, subscriber/VIP only, winner chat response).");
  });

  it("rejects empty and overlong entrant names", async () => {
    for (const username of ["", "x".repeat(41)]) {
      const res = await handleChatGiveawayAddEntry(apiRequest("/api/giveaways/chat/entries/add", {
        sessionId: "gs-manual", username,
      }), {}, addEntryDeps().d);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Enter a viewer name (up to 40 characters).");
    }
  });

  it("marks a previous winner as rejected by the saved manual rules", async () => {
    const { d, storedEntries } = addEntryDeps({
      session: {
        id: "gs-manual", site_id: siteA.id, provider: "manual", status: "active",
        rules: { excludePreviousWinners: true },
      },
      previousWinner: true,
    });
    const res = await handleChatGiveawayAddEntry(apiRequest("/api/giveaways/chat/entries/add", {
      sessionId: "gs-manual", username: "Alice",
    }), {}, d);
    expect(res.status).toBe(200);
    expect(storedEntries[0].eligibility_status).toBe("rejected");
  });

  it("rejects unsupported eligibility and anti-abuse rules before writing a session", async () => {
    let wrote = false;
    for (const rules of [{ entryMode: "verified", vpnDetection: true }, { entryMode: "verified", duplicateDevice: true }, { entryMode: "chat", onePerIp: true }, { subscriberOnly: "yes" }]) {
      const res = await handleChatGiveawayStart(apiRequest("/api/giveaways/chat/start", { keyword: "!win", rules }), {}, deps({ one: async () => { wrote = true; } }));
      expect(res.status).toBe(400);
    }
    expect(wrote).toBe(false);
  });

  it("starts verified + VPN detection when the API key is configured", async () => {
    let wrote = null;
    const res = await handleChatGiveawayStart(apiRequest("/api/giveaways/chat/start", {
      keyword: "!win", rules: { entryMode: "verified", vpnDetection: true, onePerIp: true },
    }), { PROXYCHECK_API_KEY: "k" }, deps({
      one: async (sql, params) => {
        if (String(sql).includes("FROM users")) return { plan: "pro", plan_expires_at: null, status: "active" };
        wrote = { sql, params }; return { id: "gs-1", site_id: siteA.id, status: "active", rules: params[3] };
      },
    }));
    expect(res.status).toBe(200);
    expect(wrote).not.toBeNull();
    expect(wrote.params[3]).toMatchObject({ entryMode: "verified", vpnDetection: true, onePerIp: true });
  });

  it("uses plain-language copy when VPN detection is unavailable", async () => {
    const res = await handleChatGiveawayStart(apiRequest("/api/giveaways/chat/start", {
      keyword: "!win", rules: { entryMode: "verified", vpnDetection: true },
    }), {}, deps());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("VPN / proxy detection isn't available right now.");
  });

  it("refuses to start when live reconciliation cannot confirm the chat subscription", async () => {
    let inserted = false;
    const res = await handleChatGiveawayStart(apiRequest("/api/giveaways/chat/start", { keyword: "!win" }), {}, deps({
      reconcileKickWebhookDelivery: async () => ({
        status: "ok",
        subscriptions: { rewardEvents: true, chatEvents: false },
        failedEvents: ["chat.message.sent"],
      }),
      one: async () => { inserted = true; return null; },
    }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("not subscribed");
    expect(inserted).toBe(false);
  });

  it("refuses to start when reconciliation reports the Kick grant needs reconnecting", async () => {
    let inserted = false;
    const res = await handleChatGiveawayStart(apiRequest("/api/giveaways/chat/start", { keyword: "!win" }), {}, deps({
      reconcileKickWebhookDelivery: async () => ({ status: "reconnect_required" }),
      one: async () => { inserted = true; return null; },
    }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("not subscribed");
    expect(inserted).toBe(false);
  });

  it("self-heals: starts when the recorded flag is stale but the subscription is live", async () => {
    // Regression: the recorded chatReady flag is only stamped at connect/repair
    // time, while Kick auto-unsubscribes events after delivery failures. The
    // start decision must come from the live reconciliation, not the flag.
    let inserted;
    let reconciled = false;
    const res = await handleChatGiveawayStart(apiRequest("/api/giveaways/chat/start", { keyword: "!win" }), {}, deps({
      loadChatGiveawayConnection: async () => ({ connected: true, chatReady: false, channelName: "streamer", externalChannelId: "111" }),
      reconcileKickWebhookDelivery: async () => {
        reconciled = true;
        return { status: "ok", subscriptions: { rewardEvents: true, chatEvents: true }, failedEvents: [] };
      },
      one: async (sql, params) => {
        inserted = { sql, params };
        return { id: "gs-healed", site_id: siteA.id, keyword: params[1], status: "active" };
      },
    }));
    expect(res.status).toBe(200);
    expect(reconciled).toBe(true);
    expect(inserted.sql).toContain("INSERT INTO chat_giveaway_sessions");
  });

  it("refuses to start when the recorded flag says ready but the subscription died at Kick", async () => {
    // The incident this prevents: chatReady stayed stamped after Kick
    // auto-unsubscribed chat.message.sent, so the giveaway started and
    // silently collected zero entries.
    let inserted = false;
    const res = await handleChatGiveawayStart(apiRequest("/api/giveaways/chat/start", { keyword: "!win" }), {}, deps({
      loadChatGiveawayConnection: async () => ({ connected: true, chatReady: true, channelName: "streamer", externalChannelId: "111" }),
      reconcileKickWebhookDelivery: async () => ({
        status: "ok",
        subscriptions: { rewardEvents: true, chatEvents: false },
        failedEvents: ["chat.message.sent"],
      }),
      one: async () => { inserted = true; return null; },
    }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("not subscribed");
    expect(inserted).toBe(false);
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
        if (text.includes("UPDATE chat_giveaway_sessions")) { update = { text, params }; return { id: "gs-1", status: "completed", winner_entry_id: params[1] }; }
        if (update) return { id: "gs-1", status: "completed", winner_entry_id: update.params[1] };
        return { id: "gs-1", site_id: siteA.id, keyword: "!win", status: "stopped", rules: {} };
      },
      query: async () => entries,
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    // A forged client list cannot admit pending entries; the server chooses the eligible pool.
    expect(data.winner.id).toBe("e2");
    expect(update.params).toEqual(["gs-1", "e2", siteA.id, false, null]);
    expect(update.text).toContain("status = CASE WHEN s.status = 'active' THEN 'active' ELSE 'completed' END");
    expect(update.text).toContain("GREATEST(clock_timestamp(), drawn_at + interval '1 millisecond')");
    // An initial draw only lands while no winner exists yet.
    expect(update.text).toContain("winner_entry_id IS NULL");
    // A re-roll clears any previous streamer-side confirmation.
    expect(update.text).toContain("winner_finalized_at = NULL");
    expect(update.text).toContain("winner_finalized_by = NULL");
    expect(update.text).toContain("winner_response_required = $4::boolean");
    expect(update.text).toContain("winner_response_timeout_seconds = $5::int");
    expect(data.session.winner_entry_id).toBe("e2");
  });

  it("derives the draw's response rule from the persisted session rules, not the request", async () => {
    const entries = [
      { id: "e1", giveaway_session_id: "gs-1", provider: "kick", provider_user_id: "222", username: "a", avatar_url: null, message: "!win", badges: [], entered_at: "t", eligibility_status: "eligible" },
    ];
    let update = null;
    // The request claims OFF/10s; the rules persisted at /start win.
    const res = await handleChatGiveawayDraw(apiRequest("/api/giveaways/chat/draw", { sessionId: "gs-1", responseRequired: false, responseTimeoutSeconds: 10 }), {}, deps({
      one: async (text, params) => {
        if (text.includes("UPDATE chat_giveaway_sessions")) { update = { text, params }; return { id: "gs-1", status: "completed", winner_entry_id: params[1] }; }
        return { id: "gs-1", site_id: siteA.id, status: "stopped", rules: { winnerMustRespond: true, responseTimeout: 90 } };
      },
      query: async () => entries,
    }));
    expect(res.status).toBe(200);
    expect(update.params).toEqual(["gs-1", "e1", siteA.id, true, 90]);
    expect(update.text).toContain("winner_response_deadline = CASE WHEN $4::boolean THEN stamp.new_drawn_at + make_interval(secs => $5::int) ELSE NULL END");
  });

  it("persists no response window when the session rules do not require one", async () => {
    const entries = [
      { id: "e1", giveaway_session_id: "gs-1", provider: "kick", provider_user_id: "222", username: "a", avatar_url: null, message: "!win", badges: [], entered_at: "t", eligibility_status: "eligible" },
    ];
    let update = null;
    const res = await handleChatGiveawayDraw(apiRequest("/api/giveaways/chat/draw", { sessionId: "gs-1" }), {}, deps({
      one: async (text, params) => {
        if (text.includes("UPDATE chat_giveaway_sessions")) { update = { text, params }; return { id: "gs-1", status: "completed", winner_entry_id: params[1] }; }
        return { id: "gs-1", site_id: siteA.id, status: "stopped", rules: { winnerMustRespond: false } };
      },
      query: async () => entries,
    }));
    expect(res.status).toBe(200);
    expect(update.params).toEqual(["gs-1", "e1", siteA.id, false, null]);
  });

  it("finalizes a drawn winner by stamping who confirmed and when", async () => {
    const queries = [];
    const drawnAt = "2026-09-28T00:00:00.000Z";
    const finalized = {
      id: "gs-1", site_id: siteA.id, status: "completed", winner_entry_id: "e1", drawn_at: drawnAt,
      winner_finalized_at: "2026-09-28T00:05:00Z", winner_finalized_by: owner.id,
    };
    const res = await handleChatGiveawayFinalize(apiRequest("/api/giveaways/chat/finalize", {
      sessionId: "gs-1", siteId: siteA.id, winnerEntryId: "e1", drawnAt,
    }), {}, deps({
      one: async (text, params) => {
        queries.push({ text, params });
        if (text.includes("winner_finalized_at = now()")) return finalized;
        if (text.startsWith("UPDATE")) return null;
        // The re-read after the update reflects the persisted stamp.
        if (queries.some((q) => q.text.includes("winner_finalized_at = now()"))) return finalized;
        return { id: "gs-1", site_id: siteA.id, status: "completed", winner_entry_id: "e1", drawn_at: drawnAt, winner_finalized_at: null };
      },
      query: async (text) => { queries.push({ text }); return [{ id: "e1", giveaway_session_id: "gs-1", username: "a" }]; },
    }));
    expect(res.status).toBe(200);
    const update = queries.find((q) => q.text.includes("winner_finalized_at = now()"));
    expect(update).toBeTruthy();
    expect(update.params).toEqual(["gs-1", siteA.id, owner.id, "e1", drawnAt]);
    expect(update.text).toContain("winner_entry_id = $4");
    expect(update.text).toContain("date_trunc('milliseconds', drawn_at) = date_trunc('milliseconds', $5::timestamptz)");
    expect(update.text).toContain("winner_finalized_at IS NULL");
    expect(update.text).toContain("winner_response_required IS NOT TRUE OR winner_confirmed_at IS NOT NULL");
    expect(update.text).toContain("UPDATE chat_giveaway_draws");
    expect(update.text).toContain("confirmed_at = finalized.winner_finalized_at");
    const data = await res.json();
    expect(data.session.winner_finalized_at).toBe("2026-09-28T00:05:00Z");
    expect(data.winner.id).toBe("e1");
    expect(data.connection.connected).toBe(true);
  });

  it("rejects finalize calls missing the draw identity", async () => {
    for (const body of [
      { sessionId: "gs-1" },
      { sessionId: "gs-1", winnerEntryId: "e1" },
      { sessionId: "gs-1", drawnAt: "2026-09-28T00:00:00Z" },
      { sessionId: "gs-1", winnerEntryId: "e1", drawnAt: "not-a-date" },
    ]) {
      const res = await handleChatGiveawayFinalize(apiRequest("/api/giveaways/chat/finalize", body), {}, deps());
      expect(res.status).toBe(400);
    }
  });

  it("reports a winner change when the draw raced ahead of the confirm", async () => {
    const updates = [];
    const session = {
      id: "gs-1", site_id: siteA.id, status: "completed", winner_entry_id: "e2",
      drawn_at: "2026-09-28T00:01:00.000Z", winner_finalized_at: null,
    };
    const res = await handleChatGiveawayFinalize(apiRequest("/api/giveaways/chat/finalize", {
      sessionId: "gs-1", winnerEntryId: "e1", drawnAt: "2026-09-28T00:00:00.000Z",
    }), {}, deps({
      one: async (text, params) => {
        if (text.includes("UPDATE chat_giveaway_sessions")) { updates.push({ text, params }); return null; }
        return session;
      },
      query: async () => [{ id: "e2", giveaway_session_id: "gs-1", username: "b" }],
    }));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe("The giveaway winner changed. Refresh the current draw before confirming.");
    expect(data.session.winner_entry_id).toBe("e2");
    // The failed CAS is the only write attempt.
    expect(updates).toHaveLength(1);
  });

  it("refuses to finalize while a required chat response is still unanswered", async () => {
    const updates = [];
    const drawnAt = "2026-09-28T00:00:00.000Z";
    const res = await handleChatGiveawayFinalize(apiRequest("/api/giveaways/chat/finalize", {
      sessionId: "gs-1", winnerEntryId: "e1", drawnAt,
    }), {}, deps({
      one: async (text, params) => {
        if (text.includes("UPDATE chat_giveaway_sessions")) { updates.push({ text, params }); return null; }
        return {
          id: "gs-1", site_id: siteA.id, status: "completed", winner_entry_id: "e1", drawn_at: drawnAt,
          winner_response_required: true, winner_response_timeout_seconds: 30, winner_confirmed_at: null,
        };
      },
    }));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe("The winner must respond in chat before you can confirm.");
    expect(data.session.winner_entry_id).toBe("e1");
    expect(updates).toHaveLength(1);
  });

  it("finalizes once the required chat response has arrived", async () => {
    let update = null;
    const drawnAt = "2026-09-28T00:00:00.000Z";
    const finalized = {
      id: "gs-1", site_id: siteA.id, status: "completed", winner_entry_id: "e1", drawn_at: drawnAt,
      winner_response_required: true, winner_response_timeout_seconds: 30,
      winner_confirmed_at: "2026-09-28T00:01:00Z",
      winner_finalized_at: "2026-09-28T00:02:00Z", winner_finalized_by: owner.id,
    };
    const res = await handleChatGiveawayFinalize(apiRequest("/api/giveaways/chat/finalize", {
      sessionId: "gs-1", winnerEntryId: "e1", drawnAt,
    }), {}, deps({
      one: async (text, params) => {
        if (text.includes("winner_finalized_at = now()")) { update = { text, params }; return finalized; }
        if (text.includes("UPDATE chat_giveaway_sessions")) return null;
        if (update) return finalized;
        return {
          id: "gs-1", site_id: siteA.id, status: "completed", winner_entry_id: "e1", drawn_at: drawnAt,
          winner_response_required: true, winner_response_timeout_seconds: 30,
          winner_confirmed_at: "2026-09-28T00:01:00Z", winner_finalized_at: null,
        };
      },
      query: async () => [{ id: "e1", giveaway_session_id: "gs-1", username: "a" }],
    }));
    expect(res.status).toBe(200);
    expect(update).toBeTruthy();
    expect(update.params).toEqual(["gs-1", siteA.id, owner.id, "e1", drawnAt]);
    expect((await res.json()).session.winner_finalized_at).toBe("2026-09-28T00:02:00Z");
  });

  it("refuses to finalize before a winner is drawn", async () => {
    const updates = [];
    const res = await handleChatGiveawayFinalize(apiRequest("/api/giveaways/chat/finalize", {
      sessionId: "gs-1", winnerEntryId: "e1", drawnAt: "2026-09-28T00:00:00.000Z",
    }), {}, deps({
      one: async (text, params) => {
        if (text.includes("UPDATE chat_giveaway_sessions")) { updates.push({ text, params }); return null; }
        return { id: "gs-1", site_id: siteA.id, status: "stopped", winner_entry_id: null, drawn_at: null };
      },
    }));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe("Draw a winner before confirming.");
    expect(data.session.winner_entry_id).toBeNull();
    expect(updates).toHaveLength(1);
  });

  it("returns the current state unchanged when the winner was already finalized", async () => {
    const updates = [];
    const drawnAt = "2026-09-28T00:00:00.000Z";
    const session = {
      id: "gs-1", site_id: siteA.id, status: "completed", winner_entry_id: "e1", drawn_at: drawnAt,
      winner_finalized_at: "2026-09-28T00:05:00Z", winner_finalized_by: owner.id,
    };
    const res = await handleChatGiveawayFinalize(apiRequest("/api/giveaways/chat/finalize", {
      sessionId: "gs-1", winnerEntryId: "e1", drawnAt,
    }), {}, deps({
      one: async (text, params) => {
        if (text.includes("UPDATE chat_giveaway_sessions")) { updates.push({ text, params }); return null; }
        return session;
      },
      query: async () => [{ id: "e1", giveaway_session_id: "gs-1", username: "a" }],
    }));
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(1); // the failed CAS, no second write
    expect((await res.json()).session.winner_finalized_at).toBe("2026-09-28T00:05:00Z");
  });

  it("denies finalize to members without the rewards capability", async () => {
    let touched = false;
    const res = await handleChatGiveawayFinalize(apiRequest("/api/giveaways/chat/finalize", {
      sessionId: "gs-1", winnerEntryId: "e1", drawnAt: "2026-09-28T00:00:00.000Z",
    }), {}, deps({
      requireSiteCapability: async () => ({ role: "moderator", res: new Response("forbidden", { status: 403 }) }),
      one: async () => { touched = true; return null; },
    }));
    expect(res.status).toBe(403);
    expect(touched).toBe(false);
  });

  it("refuses to draw when there are no persisted entrants", async () => {
    const res = await handleChatGiveawayDraw(apiRequest("/api/giveaways/chat/draw", { sessionId: "gs-1" }), {}, deps({
      one: async () => ({ id: "gs-1", site_id: siteA.id, status: "stopped" }),
      query: async () => [],
    }));
    expect(res.status).toBe(409);
  });

  it("a re-roll only lands on the draw identity the client saw", async () => {
    const entries = [
      { id: "e1", giveaway_session_id: "gs-1", provider: "kick", provider_user_id: "222", username: "a", avatar_url: null, message: "!win", badges: [], entered_at: "t", eligibility_status: "eligible" },
      { id: "e2", giveaway_session_id: "gs-1", provider: "kick", provider_user_id: "333", username: "b", avatar_url: null, message: "!win", badges: [], entered_at: "t", eligibility_status: "eligible" },
    ];
    let update = null;
    const drawnAt = "2026-09-28T00:00:00.000Z";
    const res = await handleChatGiveawayDraw(apiRequest("/api/giveaways/chat/draw", {
      sessionId: "gs-1", expectedWinnerEntryId: "e1", expectedDrawnAt: drawnAt,
    }), {}, deps({
      one: async (text, params) => {
        if (text.includes("UPDATE chat_giveaway_sessions")) { update = { text, params }; return { id: "gs-1", status: "completed", winner_entry_id: params[1] }; }
        return { id: "gs-1", site_id: siteA.id, status: "completed", winner_entry_id: "e1", drawn_at: drawnAt, rules: {} };
      },
      query: async () => entries,
    }));
    expect(res.status).toBe(200);
    expect(update.text).toContain("winner_entry_id = $6");
    expect(update.text).toContain("date_trunc('milliseconds', s.drawn_at) = date_trunc('milliseconds', $7::timestamptz)");
    expect(update.text).toContain("winner_finalized_at IS NULL");
    expect(update.params).toEqual(["gs-1", update.params[1], siteA.id, false, null, "e1", drawnAt]);
  });

  it("a stale re-roll is rejected and reports the current draw", async () => {
    const entries = [
      { id: "e1", giveaway_session_id: "gs-1", provider: "kick", provider_user_id: "222", username: "a", avatar_url: null, message: "!win", badges: [], entered_at: "t", eligibility_status: "eligible" },
    ];
    let updated = false;
    const current = {
      id: "gs-1", site_id: siteA.id, status: "completed", winner_entry_id: "e2",
      drawn_at: "2026-09-28T00:01:00.000Z", winner_finalized_at: null, rules: {},
    };
    const res = await handleChatGiveawayDraw(apiRequest("/api/giveaways/chat/draw", {
      sessionId: "gs-1", expectedWinnerEntryId: "e1", expectedDrawnAt: "2026-09-28T00:00:00.000Z",
    }), {}, deps({
      one: async (text) => {
        if (text.includes("UPDATE chat_giveaway_sessions")) { updated = true; return null; }
        return current;
      },
      query: async () => entries,
    }));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe("The giveaway draw changed. Refresh the current draw before drawing again.");
    expect(data.session.winner_entry_id).toBe("e2");
    expect(data.entries).toHaveLength(1);
    // The row lock catches the mismatch before any write is attempted.
    expect(updated).toBe(false);
  });

  it("an initial draw is rejected while a winner already exists", async () => {
    const entries = [
      { id: "e1", giveaway_session_id: "gs-1", provider: "kick", provider_user_id: "222", username: "a", avatar_url: null, message: "!win", badges: [], entered_at: "t", eligibility_status: "eligible" },
    ];
    let updated = false;
    const current = {
      id: "gs-1", site_id: siteA.id, status: "completed", winner_entry_id: "e1",
      drawn_at: "2026-09-28T00:00:00.000Z", winner_finalized_at: null, rules: {},
    };
    const res = await handleChatGiveawayDraw(apiRequest("/api/giveaways/chat/draw", { sessionId: "gs-1" }), {}, deps({
      one: async (text) => {
        if (text.includes("UPDATE chat_giveaway_sessions")) { updated = true; return null; }
        return current;
      },
      query: async () => entries,
    }));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe("The giveaway draw changed. Refresh the current draw before drawing again.");
    expect(data.session.winner_entry_id).toBe("e1");
    expect(updated).toBe(false);
  });

  it("a re-roll on an already-confirmed winner is rejected", async () => {
    const entries = [
      { id: "e1", giveaway_session_id: "gs-1", provider: "kick", provider_user_id: "222", username: "a", avatar_url: null, message: "!win", badges: [], entered_at: "t", eligibility_status: "eligible" },
    ];
    let updated = false;
    const current = {
      id: "gs-1", site_id: siteA.id, status: "completed", winner_entry_id: "e1",
      drawn_at: "2026-09-28T00:00:00.000Z", winner_finalized_at: "2026-09-28T00:05:00Z", rules: {},
    };
    const res = await handleChatGiveawayDraw(apiRequest("/api/giveaways/chat/draw", {
      sessionId: "gs-1", expectedWinnerEntryId: "e1", expectedDrawnAt: "2026-09-28T00:00:00.000Z",
    }), {}, deps({
      one: async (text) => {
        if (text.includes("UPDATE chat_giveaway_sessions")) { updated = true; return null; }
        return current;
      },
      query: async () => entries,
    }));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe("This winner is already confirmed and cannot be re-rolled.");
    expect(data.session.winner_finalized_at).toBe("2026-09-28T00:05:00Z");
    expect(updated).toBe(false);
  });

  it("exposes connection + session + entries for the dashboard poll", async () => {
    const res = await handleChatGiveawayState(apiRequest("/api/giveaways/chat"), {}, deps({
      one: async () => ({ id: "gs-1", site_id: siteA.id, keyword: "!win", status: "active", winner_entry_id: null }),
      query: async (text) => String(text).includes("chat_giveaway_draws") ? [] : [{ id: "e1", username: "a", provider_user_id: "222" }],
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({
      ok: true,
      capabilities: GIVEAWAY_CAPABILITIES,
      connection: { connected: true, chatReady: true, channelName: "streamer", externalChannelId: "111" },
      session: { id: "gs-1", site_id: siteA.id, keyword: "!win", status: "active", winner_entry_id: null },
      entries: [{ id: "e1", username: "a", provider_user_id: "222" }],
      winner: null,
      draws: [],
      doctor: data.doctor,
    });
    // The poll carries a read-only diagnostic naming the first closed ingest
    // gate, so an empty entrant list comes with a cause and an operator action
    // instead of sending the streamer to the wrong console.
    expect(data.doctor.checks.map((c) => c.name)).toEqual([
      "channel_connected", "delivery_stamped", "channel_routable", "session_active", "keyword_valid",
    ]);
    expect(data.doctor.healthy).toBe(true);
  });

  it("denies members without the rewards capability", async () => {
    const res = await handleChatGiveawayState(apiRequest("/api/giveaways/chat"), {}, deps({
      requireSiteCapability: async () => ({ role: "moderator", res: new Response("forbidden", { status: 403 }) }),
    }));
    expect(res.status).toBe(403);
  });
});

describe("Chat Giveaway response rules", () => {
  const activeKick = (rules = {}) => ({
    id: "gs-1", site_id: siteA.id, provider: "kick", status: "active",
    rules, winner_entry_id: null, drawn_at: null, winner_finalized_at: null,
  });
  function responseRulesDeps({ session = activeKick(), updated = session, ownerPlan = "pro" } = {}) {
    const calls = [];
    const d = deps({
      one: async (sql, params) => {
        const text = String(sql);
        calls.push({ text, params });
        if (text.includes("FROM users")) return { plan: ownerPlan, plan_expires_at: null, status: "active" };
        if (text.startsWith("UPDATE chat_giveaway_sessions")) return updated;
        if (text.includes("FROM chat_giveaway_sessions")) return session;
        return null;
      },
      query: async () => [],
    });
    return { d, calls };
  }
  const updateResponseRules = (body, d) =>
    handleChatGiveawayUpdateResponseRules(apiRequest("/api/giveaways/chat/response-rules", body), {}, d);

  it("updates only the three response rules on an active Kick session", async () => {
    const { d, calls } = responseRulesDeps({ session: activeKick({ entryMode: "chat", winnerRepeat: "again" }) });
    const res = await updateResponseRules({
      sessionId: "gs-1", winnerMustRespond: true, responseTimeout: 30, autoReroll: true,
      // Entry-side rules in the body are ignored: they merge from the session.
      entryMode: "verified", subscriberOnly: true, winnerRepeat: "once",
    }, d);
    expect(res.status).toBe(200);
    const update = calls.find((c) => c.text.startsWith("UPDATE chat_giveaway_sessions"));
    expect(update.text).toContain("SET rules = $3::jsonb");
    expect(update.text).toContain("provider = 'kick'");
    expect(update.text).toContain("status <> 'cancelled'");
    expect(update.params[0]).toBe("gs-1");
    expect(update.params[1]).toBe(siteA.id);
    expect(update.params[2]).toEqual(giveawayRules({
      entryMode: "chat", winnerRepeat: "again",
      winnerMustRespond: true, responseTimeout: 30, autoReroll: true,
    }));
    const data = await res.json();
    expect(data.session.id).toBe("gs-1");
    expect(data.connection.connected).toBe(true);
  });

  it("rejects auto re-roll without a required winner response", async () => {
    const { d, calls } = responseRulesDeps();
    const res = await updateResponseRules({ sessionId: "gs-1", winnerMustRespond: false, responseTimeout: 30, autoReroll: true }, d);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Auto re-roll requires winner response verification.");
    expect(calls.some((c) => c.text.startsWith("UPDATE chat_giveaway_sessions"))).toBe(false);
  });

  it("requires a sessionId and a session owned by the site", async () => {
    const res = await updateResponseRules({}, deps());
    expect(res.status).toBe(400);
    const missing = await updateResponseRules({ sessionId: "gs-nope" }, responseRulesDeps({ session: null }).d);
    expect(missing.status).toBe(404);
  });

  it("updates response rules after the current winner is finalized", async () => {
    const finalized = { ...activeKick({ entryMode: "chat" }), winner_finalized_at: "2026-09-28T00:05:00Z" };
    const { d, calls } = responseRulesDeps({ session: finalized, updated: finalized });
    const res = await updateResponseRules({
      sessionId: "gs-1", winnerMustRespond: true, responseTimeout: 60, autoReroll: false,
    }, d);
    expect(res.status).toBe(200);
    const update = calls.find((c) => c.text.startsWith("UPDATE chat_giveaway_sessions"));
    expect(update.text).not.toContain("winner_finalized_at IS NULL");
    expect((await res.json()).session.id).toBe("gs-1");
  });

  it("returns 409 when response rules cannot change after the giveaway ends or for a manual session", async () => {
    for (const session of [
      { ...activeKick(), status: "cancelled" },
      { ...activeKick(), provider: "manual" },
    ]) {
      const { d, calls } = responseRulesDeps({ session, updated: null });
      const res = await updateResponseRules({ sessionId: "gs-1", winnerMustRespond: true, responseTimeout: 60, autoReroll: false }, d);
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("Winner verification can't change after the giveaway ends.");
      expect(calls.some((c) => c.text.startsWith("UPDATE chat_giveaway_sessions"))).toBe(true);
    }
  });

  it("gates advanced response rules on the site owner's plan", async () => {
    const { d, calls } = responseRulesDeps({ ownerPlan: "free" });
    const res = await updateResponseRules({ sessionId: "gs-1", winnerMustRespond: false, responseTimeout: 30, autoReroll: false }, d);
    expect(res.status).toBe(403);
    expect(calls.some((c) => c.text.includes("FROM users"))).toBe(true);
    expect(calls.some((c) => c.text.startsWith("UPDATE chat_giveaway_sessions"))).toBe(false);
  });
});

describe("Chat Giveaway draw history", () => {
  const kickEntries = [
    { id: "e1", giveaway_session_id: "gs-1", provider: "kick", provider_user_id: "u1", username: "a", avatar_url: null, message: "!win", badges: [], entered_at: "t1", eligibility_status: "eligible" },
    { id: "e2", giveaway_session_id: "gs-1", provider: "kick", provider_user_id: "u2", username: "b", avatar_url: null, message: "!win", badges: [], entered_at: "t2", eligibility_status: "eligible" },
  ];
  function drawDeps({ session, entries = kickEntries, updatedRows = null }) {
    const statements = [];
    const d = deps({
      one: async (text) => (String(text).startsWith("UPDATE") ? null : session),
      query: async () => entries,
      transaction: (fn) => fn(async (sql, params) => {
        const text = String(sql);
        statements.push({ text, params });
        if (text.includes("FROM chat_giveaway_entries e")) return entries;
        if (text.includes("UPDATE chat_giveaway_sessions")) {
          return updatedRows ?? [{ ...session, status: "completed", winner_entry_id: params[1] }];
        }
        if (text.includes("FROM chat_giveaway_sessions")) return [session];
        if (text.includes("FROM chat_giveaway_draws")) return [];
        return [];
      }),
    });
    return { d, statements };
  }
  const drawInsert = (statements) => statements.find((s) => s.text.startsWith("INSERT INTO chat_giveaway_draws"));

  it("records a 'draw' reason for the first draw and 'reroll' with the replaced entrant", async () => {
    const session = { id: "gs-1", site_id: siteA.id, status: "active", rules: {}, winner_entry_id: null, drawn_at: null };
    const { d, statements } = drawDeps({ session });
    const res = await handleChatGiveawayDraw(apiRequest("/api/giveaways/chat/draw", { sessionId: "gs-1" }), {}, d);
    expect(res.status).toBe(200);
    const firstInsert = drawInsert(statements);
    expect(firstInsert.params.slice(3)).toEqual([
      kickEntries.find((entry) => entry.id === firstInsert.params[1]).username,
      "draw",
      null,
    ]);

    const drawnAt = "2026-09-28T00:00:00.000Z";
    const drawn = { ...session, status: "completed", winner_entry_id: "e1", drawn_at: drawnAt };
    const { d: d2, statements: s2 } = drawDeps({ session: drawn });
    const res2 = await handleChatGiveawayDraw(apiRequest("/api/giveaways/chat/draw", {
      sessionId: "gs-1", expectedWinnerEntryId: "e1", expectedDrawnAt: drawnAt,
    }), {}, d2);
    expect(res2.status).toBe(200);
    const secondInsert = drawInsert(s2);
    expect(secondInsert.params.slice(3)).toEqual([
      kickEntries.find((entry) => entry.id === secondInsert.params[1]).username,
      "reroll",
      "e1",
    ]);
  });

  it("records an 'auto_reroll' reason for the timed-out draw", async () => {
    const session = {
      id: "gs-1", site_id: siteA.id, status: "completed", rules: { winnerMustRespond: true, responseTimeout: 30, autoReroll: true },
      winner_entry_id: "e1", drawn_at: "2026-09-28T00:00:00.000Z",
      winner_confirmed_at: null, winner_finalized_at: null,
      winner_response_deadline: "2000-01-01T00:00:00.000Z",
    };
    const { d, statements } = drawDeps({ session });
    const res = await handleChatGiveawayDraw(apiRequest("/api/giveaways/chat/draw", { sessionId: "gs-1", automatic: true }), {}, d);
    expect(res.status).toBe(200);
    const insert = drawInsert(statements);
    expect(insert.params.slice(3)).toEqual([
      kickEntries.find((entry) => entry.id === insert.params[1]).username,
      "auto_reroll",
      "e1",
    ]);
  });

  it("forwards next=true for a finalized winner draw", async () => {
    const drawnAt = "2026-09-28T00:00:00.000Z";
    const session = {
      id: "gs-1", site_id: siteA.id, status: "active", rules: {},
      winner_entry_id: "e1", drawn_at: drawnAt,
      winner_finalized_at: "2026-09-28T00:05:00Z",
    };
    const { d, statements } = drawDeps({
      session,
      updatedRows: [{ ...session, winner_entry_id: "e2", status: "active" }],
    });
    const res = await handleChatGiveawayDraw(apiRequest("/api/giveaways/chat/draw", {
      sessionId: "gs-1", next: true, expectedWinnerEntryId: "e1", expectedDrawnAt: drawnAt,
    }), {}, d);
    expect(res.status).toBe(200);
    const update = statements.find((s) => s.text.includes("UPDATE chat_giveaway_sessions"));
    expect(update.text).toContain("winner_finalized_at IS NOT NULL");
    expect(drawInsert(statements).params.slice(4)).toEqual(["draw", null]);
  });

  it("records no draw row when the compare-and-swap misses", async () => {
    const session = {
      id: "gs-1", site_id: siteA.id, status: "completed", rules: {},
      winner_entry_id: "e1", drawn_at: "2026-09-28T00:00:00.000Z", winner_finalized_at: null,
    };
    const { d, statements } = drawDeps({ session, updatedRows: [] });
    const res = await handleChatGiveawayDraw(apiRequest("/api/giveaways/chat/draw", {
      sessionId: "gs-1", expectedWinnerEntryId: "e1", expectedDrawnAt: "2026-09-28T00:00:00.000Z",
    }), {}, d);
    expect(res.status).toBe(409);
    expect(drawInsert(statements)).toBeUndefined();
  });

  it("a manually-added winner never arms a response window", async () => {
    const manual = [{ id: "m1", giveaway_session_id: "gs-1", provider: "manual", provider_user_id: "manual:alice", username: "alice", avatar_url: null, message: "", badges: [], entered_at: "t1", eligibility_status: "eligible" }];
    const session = { id: "gs-1", site_id: siteA.id, status: "active", rules: { winnerMustRespond: true, responseTimeout: 30 }, winner_entry_id: null, drawn_at: null };
    const { d, statements } = drawDeps({ session, entries: manual });
    const res = await handleChatGiveawayDraw(apiRequest("/api/giveaways/chat/draw", { sessionId: "gs-1" }), {}, d);
    expect(res.status).toBe(200);
    const update = statements.find((s) => s.text.includes("UPDATE chat_giveaway_sessions"));
    expect(update.params.slice(0, 5)).toEqual(["gs-1", "m1", siteA.id, false, null]);
    expect(drawInsert(statements).params.slice(3)).toEqual(["alice", "draw", null]);
  });
});

describe("Chat Giveaway Clear list", () => {
  function clearDeps({ lockedSession = null, loadedSession = lockedSession } = {}) {
    const statements = [];
    const d = deps({
      transaction: (fn) => fn(async (sql, params) => {
        const text = String(sql);
        statements.push({ text, params });
        if (text.includes("FOR UPDATE")) return lockedSession ? [lockedSession] : [];
        if (text.startsWith("DELETE FROM chat_giveaway_entries")) return [];
        if (text.startsWith("UPDATE chat_giveaway_sessions")) return loadedSession ? [loadedSession] : [];
        return [];
      }),
      one: async (sql) => (String(sql).includes("chat_giveaway_sessions") ? loadedSession : null),
      query: async (sql) => (String(sql).includes("chat_giveaway_draws") ? [] : []),
    });
    return { d, statements };
  }

  it("deletes participants and resets the current draw while preserving the session", async () => {
    const session = {
      id: "gs-1", site_id: siteA.id, status: "active", winner_entry_id: null,
      winner_finalized_at: null, rules: {},
    };
    const { d, statements } = clearDeps({ lockedSession: session });
    const res = await handleChatGiveawayClearEntries(apiRequest("/api/giveaways/chat/entries/clear", {
      sessionId: session.id, siteId: siteA.id,
    }), {}, d);
    expect(res.status).toBe(200);
    expect(statements.some(({ text }) => text.startsWith("DELETE FROM chat_giveaway_entries"))).toBe(true);
    const update = statements.find(({ text }) => text.startsWith("UPDATE chat_giveaway_sessions"));
    expect(update.text).toContain("winner_entry_id = NULL");
    expect(update.text).toContain("drawn_at = NULL");
    expect(update.text).toContain("winner_confirmed_at = NULL");
    expect(update.text).toContain("winner_confirmation_message = NULL");
    expect(update.text).toContain("winner_finalized_at = NULL");
    expect(update.text).toContain("winner_finalized_by = NULL");
    expect(update.text).toContain("winner_response_deadline = NULL");
    expect(update.text).toContain("auto_reroll_exhausted_at = NULL");
  });

  it("refuses to clear entries while the current winner is unconfirmed", async () => {
    const session = {
      id: "gs-1", site_id: siteA.id, status: "active", winner_entry_id: "e1",
      winner_finalized_at: null, rules: {},
    };
    const { d, statements } = clearDeps({ lockedSession: session });
    const res = await handleChatGiveawayClearEntries(apiRequest("/api/giveaways/chat/entries/clear", {
      sessionId: session.id, siteId: siteA.id,
    }), {}, d);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Confirm or re-roll the current winner before clearing the list.");
    expect(statements.some(({ text }) => text.startsWith("DELETE FROM chat_giveaway_entries"))).toBe(false);
  });

  it("returns 404 when the session belongs to another site", async () => {
    const { d } = clearDeps({ lockedSession: null });
    const res = await handleChatGiveawayClearEntries(apiRequest("/api/giveaways/chat/entries/clear", {
      sessionId: "gs-other", siteId: siteA.id,
    }), {}, d);
    expect(res.status).toBe(404);
  });
});

describe("runGiveawayTimeouts sweep", () => {
  it("logs and continues when one session's transaction throws", async () => {
    const seen = [];
    const errors = [];
    const origError = console.error;
    console.error = (...a) => errors.push(a.join(" "));
    let counts;
    try {
      counts = await runGiveawayTimeouts({
        queryImpl: async () => [{ id: "s1" }, { id: "s2" }],
        transaction: async (fn) => fn(async (text, params) => {
          if (String(text).includes("FOR UPDATE")) {
            seen.push(params[0]);
            if (params[0] === "s1") throw new Error("lock lost");
            return [];
          }
          return [];
        }),
      });
    } finally {
      console.error = origError;
    }
    // s1's failure is logged with its id and does not stop s2 from processing.
    expect(seen).toEqual(["s1", "s2"]);
    expect(counts).toEqual({ rerolled: 0, exhausted: 0, failed: 1 });
    expect(errors.join("\n")).toContain("s1");
    expect(errors.join("\n")).toContain("lock lost");
  });
});

describe("linked-account exclude/include", () => {
  const E1 = "11111111-1111-4111-8111-111111111111";
  const E2 = "22222222-2222-4222-8222-222222222222";

  function linkedDeps({ session = {}, entries = [] } = {}) {
    const statements = [];
    return {
      statements,
      d: deps({
        one: async () => ({ id: "gs-1", site_id: siteA.id, status: "active", ...session }),
        query: async (sql) => {
          if (String(sql).includes("FROM account_links")) return [];
          return entries;
        },
        transaction: async (fn) => fn(async (sql, params) => {
          statements.push({ text: String(sql), params });
          const text = String(sql);
          if (text.includes("FOR UPDATE") && text.includes("chat_giveaway_sessions")) {
            return [{ id: "gs-1", site_id: siteA.id, status: "active", ...session }];
          }
          if (text.includes("FOR UPDATE") && text.includes("chat_giveaway_entries")) {
            return entries.filter((e) => (params?.[1] || []).includes(e.id));
          }
          if (text.startsWith("UPDATE chat_giveaway_entries")) {
            const row = entries.find((e) => e.id === params?.[1]);
            if (!row) return [];
            if (text.includes("eligibility_reason='excluded_linked_account'") &&
                row.eligibility_reason !== "excluded_linked_account") return [];
            return [row];
          }
          if (text.includes("INSERT INTO audit_log")) return [{ id: "a1" }];
          if (text.includes("FROM chat_giveaway_entries e")) return entries;
          if (text.includes("FROM account_links")) return [];
          if (text.includes("FROM chat_giveaway_draws")) return [];
          return [];
        }),
      }),
    };
  }

  it("excludes linked entries and writes audit rows", async () => {
    const entries = [
      { id: E1, giveaway_session_id: "gs-1", eligibility_status: "eligible" },
      { id: E2, giveaway_session_id: "gs-1", eligibility_status: "eligible" },
    ];
    const { d, statements } = linkedDeps({ entries });
    const res = await handleChatGiveawayExcludeLinkedEntries(
      apiRequest("/api/giveaways/chat/entries/exclude", { sessionId: "gs-1", siteId: siteA.id, entryIds: [E1, E2] }), {}, d);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.excluded.sort()).toEqual([E1, E2].sort());
    const audits = statements.filter((s) => s.text.includes("audit_log"));
    expect(audits).toHaveLength(2);
    expect(audits[0].text).toContain("giveaway_entry_excluded_linked");
  });

  it("409s when the current winner is in the exclude list", async () => {
    const { d } = linkedDeps({
      session: { winner_entry_id: E1 },
      entries: [
        { id: E1, giveaway_session_id: "gs-1", eligibility_status: "eligible" },
        { id: E2, giveaway_session_id: "gs-1", eligibility_status: "eligible" },
      ],
    });
    const res = await handleChatGiveawayExcludeLinkedEntries(
      apiRequest("/api/giveaways/chat/entries/exclude", { sessionId: "gs-1", siteId: siteA.id, entryIds: [E1, E2] }), {}, d);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Re-roll before excluding the current winner.");
  });

  it("404s when an entry id is not part of the session", async () => {
    const { d } = linkedDeps({ entries: [{ id: E1, giveaway_session_id: "gs-1", eligibility_status: "eligible" }] });
    const res = await handleChatGiveawayExcludeLinkedEntries(
      apiRequest("/api/giveaways/chat/entries/exclude", { sessionId: "gs-1", siteId: siteA.id, entryIds: [E1, E2] }), {}, d);
    expect(res.status).toBe(404);
  });

  it("include reinstates only excluded_linked_account entries and audits it", async () => {
    const entries = [
      { id: E1, giveaway_session_id: "gs-1", eligibility_status: "rejected", eligibility_reason: "excluded_linked_account" },
    ];
    const { d, statements } = linkedDeps({ entries });
    const res = await handleChatGiveawayIncludeLinkedEntry(
      apiRequest("/api/giveaways/chat/entries/include", { sessionId: "gs-1", siteId: siteA.id, entryId: E1 }), {}, d);
    expect(res.status).toBe(200);
    expect(statements.some((s) => s.text.includes("giveaway_entry_included"))).toBe(true);
    expect(statements.some((s) => s.text.includes("eligibility_status='eligible'"))).toBe(true);
  });

  it("leaves a vpn_detected rejection untouched and later include still 409s", async () => {
    const entries = [
      { id: E1, giveaway_session_id: "gs-1", eligibility_status: "eligible", username: "normaluser" },
      { id: E2, giveaway_session_id: "gs-1", eligibility_status: "rejected", eligibility_reason: "vpn_detected", username: "vpnuser" },
    ];
    const { d, statements } = linkedDeps({ entries });
    const res = await handleChatGiveawayExcludeLinkedEntries(
      apiRequest("/api/giveaways/chat/entries/exclude", { sessionId: "gs-1", siteId: siteA.id, entryIds: [E1, E2] }), {}, d);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.excluded).toEqual([E1]);
    expect(body.skipped).toEqual([E2]);
    // No audit row and no UPDATE for the vpn-rejected entry.
    const updates = statements.filter((s) => s.text.includes("eligibility_reason='excluded_linked_account'"));
    expect(updates).toHaveLength(1);
    expect(updates[0].params[0]).toBe(E1);
    const audits = statements.filter((s) => s.text.includes("audit_log"));
    expect(audits).toHaveLength(1);
    expect(audits[0].params[2].username).toBeDefined();

    const res2 = await handleChatGiveawayIncludeLinkedEntry(
      apiRequest("/api/giveaways/chat/entries/include", { sessionId: "gs-1", siteId: siteA.id, entryId: E2 }), {}, d);
    expect(res2.status).toBe(409);
  });

  it("include 409s for an entry that was never linked-excluded", async () => {
    const entries = [{ id: E1, giveaway_session_id: "gs-1", eligibility_status: "eligible" }];
    // UPDATE...RETURNING finds nothing (the predicate requires the excluded reason).
    const { d } = linkedDeps({ entries });
    const res = await handleChatGiveawayIncludeLinkedEntry(
      apiRequest("/api/giveaways/chat/entries/include", { sessionId: "gs-1", siteId: siteA.id, entryId: E1 }), {}, d);
    expect(res.status).toBe(409);
  });
});
