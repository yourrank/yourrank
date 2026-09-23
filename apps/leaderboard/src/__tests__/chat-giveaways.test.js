import { giveawayRules, GIVEAWAY_CAPABILITIES } from "@yourrank/shared/giveaway-eligibility";
import { beforeAll, describe, expect, it } from "bun:test";
import { handleKickWebhook } from "../handlers/kick-webhook.js";
import {
  handleChatGiveawayDraw,
  handleChatGiveawayFinalize,
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
    for (const p of ["GET /api/giveaways/chat", "POST /api/giveaways/chat/start", "POST /api/giveaways/chat/stop", "POST /api/giveaways/chat/draw", "POST /api/giveaways/chat/finalize", "POST /api/giveaways/chat/entries/remove"]) {
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
    expect(update.text).toContain("status = 'completed'");
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
        if (text.startsWith("UPDATE")) { updates.push({ text, params }); return null; }
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
        if (text.startsWith("UPDATE")) { updates.push({ text, params }); return null; }
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
        if (text.startsWith("UPDATE")) return null;
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
        if (text.startsWith("UPDATE")) { updates.push({ text, params }); return null; }
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
        if (text.startsWith("UPDATE")) { updates.push({ text, params }); return null; }
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
