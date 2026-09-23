import { describe, expect, it } from "bun:test";
import {
  KICK_CHAT_MESSAGE_EVENT,
  KICK_CREATOR_WEBHOOK_EVENTS,
  KICK_REWARD_REDEMPTION_EVENT,
  chatMessageMatchesKeyword,
  ingestChatGiveawayMessage,
  kickChatMessageToIngestInput,
  loadChatGiveawayConnection,
  normalizeGiveawayKeyword,
  resolveChatEventTime,
} from "../chat-giveaways.js";
import { ensureKickWebhookSubscriptions } from "../kick-oauth.js";

describe("chat giveaway keyword matching", () => {
  it("is exact-token and case-insensitive", () => {
    expect(chatMessageMatchesKeyword("!win", "!win")).toBe(true);
    expect(chatMessageMatchesKeyword("!WIN", "!win")).toBe(true);
    expect(chatMessageMatchesKeyword("  !Win please ", "!win")).toBe(true);
    expect(chatMessageMatchesKeyword("gl !win gl", "!WIN")).toBe(true);
  });

  it("does not accept substrings such as !winner for !win", () => {
    expect(chatMessageMatchesKeyword("!winner", "!win")).toBe(false);
    expect(chatMessageMatchesKeyword("!winning", "!win")).toBe(false);
    expect(chatMessageMatchesKeyword("win", "!win")).toBe(false);
    expect(chatMessageMatchesKeyword("", "!win")).toBe(false);
    expect(chatMessageMatchesKeyword("!win", "")).toBe(false);
  });

  it("normalizes keywords to a bounded lowercase token", () => {
    expect(normalizeGiveawayKeyword("  !WIN ")).toBe("!win");
    expect(normalizeGiveawayKeyword("x".repeat(100))).toHaveLength(64);
  });
});

describe("required Kick creator webhook events", () => {
  it("keeps rewards and adds chat messages", () => {
    expect(KICK_CREATOR_WEBHOOK_EVENTS).toEqual([KICK_REWARD_REDEMPTION_EVENT, KICK_CHAT_MESSAGE_EVENT]);
    expect(KICK_CHAT_MESSAGE_EVENT).toBe("chat.message.sent");
    expect(KICK_REWARD_REDEMPTION_EVENT).toBe("channel.reward.redemption.updated");
  });
});

describe("ensureKickWebhookSubscriptions", () => {
  it("reuses existing webhook subscriptions and only subscribes missing events", async () => {
    const subscribed: string[] = [];
    const result = await ensureKickWebhookSubscriptions("tok", KICK_CREATOR_WEBHOOK_EVENTS, {
      list: async () => [{ id: "1", event: KICK_REWARD_REDEMPTION_EVENT, version: 1, method: "webhook" }],
      subscribe: async (_token, event) => { subscribed.push(event); },
    });
    expect(subscribed).toEqual([KICK_CHAT_MESSAGE_EVENT]);
    expect(result).toEqual({ subscribed: KICK_CREATOR_WEBHOOK_EVENTS, failed: [] });
  });

  it("reports each failed event truthfully and falls back to subscribing when listing fails", async () => {
    const subscribed: string[] = [];
    const result = await ensureKickWebhookSubscriptions("tok", KICK_CREATOR_WEBHOOK_EVENTS, {
      list: async () => { throw new Error("list 500"); },
      subscribe: async (_token, event) => {
        subscribed.push(event);
        if (event === KICK_CHAT_MESSAGE_EVENT) throw new Error("chat 500");
      },
    });
    expect(subscribed).toEqual(KICK_CREATOR_WEBHOOK_EVENTS);
    expect(result.subscribed).toEqual([KICK_REWARD_REDEMPTION_EVENT]);
    expect(result.failed).toEqual([{ event: KICK_CHAT_MESSAGE_EVENT, error: "chat 500" }]);
  });
});

describe("kickChatMessageToIngestInput", () => {
  it("routes by broadcaster user id and identifies the sender by stable user id", () => {
    const input = kickChatMessageToIngestInput({
      message_id: "m1",
      broadcaster: { user_id: 111, username: "streamer" },
      sender: { user_id: 222, username: "Viewer", profile_picture: "https://cdn/a.png", identity: { badges: [{ type: "vip" }] } },
      content: "!WIN",
      created_at: "2026-09-24T00:00:00Z",
    });
    expect(input).toEqual({
      provider: "kick",
      externalChannelId: "111",
      senderUserId: "222",
      senderUsername: "Viewer",
      senderAvatarUrl: "https://cdn/a.png",
      badges: [{ type: "vip" }],
      content: "!WIN",
      occurredAt: "2026-09-24T00:00:00Z",
    });
  });

  it("does not carry any site id from the payload", () => {
    const input = kickChatMessageToIngestInput({ broadcaster: { user_id: 1 }, sender: { user_id: 2 }, content: "x" });
    expect(Object.keys(input)).not.toContain("siteId");
  });
});

// In-memory stand-in for the routed-session query + entry insert, mirroring the
// database uniqueness on (giveaway_session_id, provider_user_id).
function fakeDb(sessionsByChannel: Record<string, Array<{ id: string; site_id: string; keyword: string; status: string }>>) {
  const entries = new Set<string>();
  const inserts: unknown[][] = [];
  const run = async (sql: string, params: unknown[] = []) => {
    if (sql.startsWith("SELECT gs.id")) {
      const [provider, channel] = params as [string, string];
      expect(provider).toBe("kick");
      return (sessionsByChannel[channel] || []).map((s) => ({
        ...s, winner_entry_id: null, winner_confirmed_at: null, winner_provider_user_id: null,
      }));
    }
    if (sql.startsWith("INSERT INTO chat_giveaway_entries")) {
      const key = `${params[0]}:${params[2]}`;
      inserts.push(params);
      if (entries.has(key)) return [];
      entries.add(key);
      return [{ id: crypto.randomUUID() }];
    }
    throw new Error(`unexpected sql: ${sql}`);
  };
  return { run, entries, inserts };
}

const message = (channel: string, user: string, content: string) => ({
  provider: "kick" as const,
  externalChannelId: channel,
  senderUserId: user,
  senderUsername: `user-${user}`,
  senderAvatarUrl: null,
  badges: [],
  content,
});

describe("ingestChatGiveawayMessage", () => {
  it("creates an entrant for a matching keyword and ignores non-matching messages", async () => {
    const db = fakeDb({ "chan-a": [{ id: "gs-a", site_id: "site-a", keyword: "!win", status: "active" }] });
    expect(await ingestChatGiveawayMessage(db.run, message("chan-a", "u1", "hello everyone"))).toMatchObject({
      routed: true, matched: false, entered: false, sessionId: "gs-a",
    });
    expect(await ingestChatGiveawayMessage(db.run, message("chan-a", "u1", "!WIN"))).toMatchObject({
      routed: true, matched: true, entered: true, duplicate: false, sessionId: "gs-a",
    });
    expect(await ingestChatGiveawayMessage(db.run, message("chan-a", "u2", "!winner"))).toMatchObject({
      matched: false, entered: false,
    });
    expect(db.entries.size).toBe(1);
  });

  it("dedupes by stable provider user id, not username", async () => {
    const db = fakeDb({ "chan-a": [{ id: "gs-a", site_id: "site-a", keyword: "!win", status: "active" }] });
    await ingestChatGiveawayMessage(db.run, { ...message("chan-a", "u1", "!win"), senderUsername: "Alice" });
    const again = await ingestChatGiveawayMessage(db.run, { ...message("chan-a", "u1", "!win"), senderUsername: "Alice_renamed" });
    expect(again).toMatchObject({ matched: true, entered: false, duplicate: true });
    const other = await ingestChatGiveawayMessage(db.run, { ...message("chan-a", "u9", "!win"), senderUsername: "Alice" });
    expect(other).toMatchObject({ entered: true });
    expect(db.entries.size).toBe(2);
    expect(db.inserts.every((params) => params[2] === "u1" || params[2] === "u9")).toBe(true);
  });

  it("never routes channel A's chat into another site's giveaway", async () => {
    const db = fakeDb({
      "chan-a": [{ id: "gs-a", site_id: "site-a", keyword: "!win", status: "active" }],
      "chan-b": [{ id: "gs-b", site_id: "site-b", keyword: "!win", status: "active" }],
    });
    const outcome = await ingestChatGiveawayMessage(db.run, message("chan-a", "u1", "!win"));
    expect(outcome.sessionId).toBe("gs-a");
    expect(db.inserts).toHaveLength(1);
    expect(db.inserts[0][0]).toBe("gs-a");
    // Unknown / unverified channel: nothing is routed at all.
    expect(await ingestChatGiveawayMessage(db.run, message("chan-unknown", "u1", "!win"))).toMatchObject({
      routed: false, entered: false, sessionId: null,
    });
  });

  it("stops creating entrants once the session is no longer active", async () => {
    const db = fakeDb({ "chan-a": [{ id: "gs-a", site_id: "site-a", keyword: "!win", status: "stopped" }] });
    // Stopped sessions are not returned by the routed query in production;
    // even if one is, it must not accept entries.
    const outcome = await ingestChatGiveawayMessage(db.run, message("chan-a", "u1", "!win"));
    expect(outcome.entered).toBe(false);
    expect(db.inserts).toHaveLength(0);
  });

  it("ignores messages without a stable sender id", async () => {
    const db = fakeDb({ "chan-a": [{ id: "gs-a", site_id: "site-a", keyword: "!win", status: "active" }] });
    expect(await ingestChatGiveawayMessage(db.run, { ...message("chan-a", "", "!win") })).toMatchObject({ routed: false });
  });
});

describe("resolveChatEventTime", () => {
  const now = new Date("2026-09-28T12:00:00.000Z");
  it("uses the provider timestamp when it is valid and not in the future", () => {
    expect(resolveChatEventTime("2026-09-28T11:59:40.000Z", now)).toEqual(new Date("2026-09-28T11:59:40.000Z"));
    expect(resolveChatEventTime("2026-09-28T12:00:00.000Z", now)).toEqual(now);
  });
  it("falls back to processing time for missing or invalid input", () => {
    for (const bad of [null, undefined, "", "not-a-date"]) {
      expect(resolveChatEventTime(bad, now)).toEqual(now);
    }
  });
  it("falls back for timestamps more than 60s in the future but honors small skew", () => {
    expect(resolveChatEventTime("2026-09-28T12:02:00.000Z", now)).toEqual(now);
    expect(resolveChatEventTime("2026-09-28T12:00:30.000Z", now)).toEqual(new Date("2026-09-28T12:00:30.000Z"));
  });
});

describe("ingestChatGiveawayMessage winner confirmation", () => {
  const completed = {
    id: "gs-a", site_id: "site-a", keyword: "!win", status: "completed",
    winner_entry_id: "e1", winner_confirmed_at: null, winner_provider_user_id: "u1",
  };
  function winnerDb(updateRows = [{ id: "gs-a" }]) {
    const updates: { sql: string; params: unknown[] }[] = [];
    const run = async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM chat_giveaway_sessions gs")) return [completed];
      if (sql.startsWith("UPDATE chat_giveaway_sessions")) {
        updates.push({ sql, params });
        return updateRows;
      }
      throw new Error(`unexpected sql: ${sql}`);
    };
    return { run, updates };
  }

  it("stamps the winner's confirmation with the provider event time", async () => {
    const db = winnerDb();
    const occurredAt = new Date(Date.now() - 10_000).toISOString();
    const outcome = await ingestChatGiveawayMessage(db.run, { ...message("chan-a", "u1", "here!"), occurredAt });
    expect(outcome.winnerConfirmed).toBe(true);
    expect(db.updates).toHaveLength(1);
    const { sql, params } = db.updates[0];
    expect(params).toEqual(["gs-a", "here!", occurredAt, "kick", "u1"]);
    // The deadline is enforced in SQL against drawn_at, not just on routing.
    expect(sql).toContain("winner_response_required = true");
    expect(sql).toContain("winner_finalized_at IS NULL");
    expect(sql).toContain("winner.provider_user_id = $5");
    expect(sql).toContain("$3::timestamptz >= drawn_at");
    expect(sql).toContain("$3::timestamptz <= drawn_at + make_interval(secs => COALESCE(winner_response_timeout_seconds, 60))");
  });

  it("still uses the provider timestamp when the webhook was delivered late", async () => {
    const db = winnerDb();
    // Sent 10s after the draw but processed much later: the provider time wins.
    const occurredAt = new Date(Date.now() - 50_000).toISOString();
    const outcome = await ingestChatGiveawayMessage(db.run, { ...message("chan-a", "u1", "still here"), occurredAt });
    expect(outcome.winnerConfirmed).toBe(true);
    expect(db.updates[0].params[2]).toBe(occurredAt);
  });

  it("falls back to processing time when the provider timestamp is unusable", async () => {
    const db = winnerDb();
    const before = Date.now();
    await ingestChatGiveawayMessage(db.run, { ...message("chan-a", "u1", "hi"), occurredAt: "garbage" });
    expect(Date.parse(String(db.updates[0].params[2]))).toBeGreaterThanOrEqual(before);
    const futureDb = winnerDb();
    await ingestChatGiveawayMessage(futureDb.run, { ...message("chan-a", "u1", "hi"), occurredAt: new Date(Date.now() + 120_000).toISOString() });
    expect(Date.parse(String(futureDb.updates[0].params[2]))).toBeLessThan(Date.now() + 61_000);
  });

  it("reports winnerConfirmed false when the deadline predicate rejects the update", async () => {
    const db = winnerDb([]);
    const outcome = await ingestChatGiveawayMessage(db.run, { ...message("chan-a", "u1", "too late") });
    expect(outcome.winnerConfirmed).toBe(false);
    expect(db.updates).toHaveLength(1);
  });

  it("ignores a message from someone who is not the drawn winner", async () => {
    const db = winnerDb();
    const outcome = await ingestChatGiveawayMessage(db.run, message("chan-a", "u9", "not the winner"));
    expect(outcome.winnerConfirmed).toBe(false);
    expect(db.updates).toHaveLength(0);
  });
});

describe("loadChatGiveawayConnection", () => {
  it("is connected only through a routable verified binding, and chat-ready only once subscribed", async () => {
    const rows = [{ external_channel_id: "111", external_channel_name: "streamer", chat_events_subscribed_at: null, routable: true }];
    const run = async () => rows;
    expect(await loadChatGiveawayConnection(run, "site-a")).toEqual({
      connected: true, chatReady: false, channelName: "streamer", externalChannelId: "111",
    });
    rows[0].chat_events_subscribed_at = "2026-09-24T00:00:00Z";
    expect((await loadChatGiveawayConnection(run, "site-a")).chatReady).toBe(true);
    rows[0].routable = false;
    expect(await loadChatGiveawayConnection(run, "site-a")).toEqual({
      connected: false, chatReady: false, channelName: null, externalChannelId: null,
    });
    expect(await loadChatGiveawayConnection(async () => [], "site-a")).toMatchObject({ connected: false });
  });
});
