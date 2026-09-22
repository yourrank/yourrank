// Real-Postgres coverage for the server-backed Chat Giveaway model: verified
// channel -> site routing, one active session per site, one entry per stable
// Kick user per session, stop/disconnect preserving history. Self-skips when
// AUDIT_TEST_DATABASE_URL is unset; CI runs it against the migrated schema.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import {
  ingestChatGiveawayMessage,
  loadChannelEventDelivery,
  loadChatGiveawayConnection,
  markChannelEventSubscriptions,
  stopActiveChatGiveaways,
} from "@yourrank/shared/chat-giveaways";
import {
  linkCommunityChannel,
  linkCreatorConnection,
  revokeCommunityChannel,
} from "@yourrank/shared/provider-connections";

const url = process.env.AUDIT_TEST_DATABASE_URL || "";
const integrationIt = (name, fn) => (url ? it : it.skip)(name, fn, 60000);

const ownerA = crypto.randomUUID();
const ownerB = crypto.randomUUID();
const siteA = crypto.randomUUID();
const siteB = crypto.randomUUID();
const channelA = `cg-${crypto.randomUUID()}`;
const channelB = `cg-${crypto.randomUUID()}`;
let sql;
const run = (text, params = []) => sql.unsafe(text, params);

const msg = (channel, user, content, username = `viewer-${user}`) => ({
  provider: "kick", externalChannelId: channel, senderUserId: user, senderUsername: username,
  senderAvatarUrl: null, badges: [], content,
});

async function startSession(siteId, keyword = "!win") {
  const [row] = await sql`INSERT INTO chat_giveaway_sessions (site_id, keyword, created_by)
    VALUES (${siteId}, ${keyword}, ${siteId === siteA ? ownerA : ownerB}) RETURNING id, status`;
  return row;
}
const entries = (sessionId) => sql`SELECT provider_user_id, username FROM chat_giveaway_entries WHERE giveaway_session_id=${sessionId} ORDER BY entered_at`;

beforeAll(async () => {
  if (!url) return;
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1", "postgres"].includes(parsed.hostname) || !/test|e2e/.test(parsed.pathname)) throw new Error("Disposable local database required");
  sql = postgres(url, { max: 3, prepare: false });
  await sql`INSERT INTO users (id, email, status, email_verified) VALUES
    (${ownerA}, ${`${ownerA}@test.example`}, 'active', true),
    (${ownerB}, ${`${ownerB}@test.example`}, 'active', true)`;
  await sql`INSERT INTO sites (id, user_id, slug, name, published, is_draft) VALUES
    (${siteA}, ${ownerA}, ${`a-${siteA.slice(0, 30)}`}, 'Site A', true, false),
    (${siteB}, ${ownerB}, ${`b-${siteB.slice(0, 30)}`}, 'Site B', true, false)`;
  for (const [userId, siteId, channel] of [[ownerA, siteA, channelA], [ownerB, siteB, channelB]]) {
    const connectionId = await linkCreatorConnection(run, {
      userId, provider: "kick", externalUserId: channel, username: `streamer-${channel.slice(-4)}`,
      accessTokenEnc: "enc", refreshTokenEnc: null, tokenExpiresAt: null,
    });
    await linkCommunityChannel(run, {
      siteId, provider: "kick", externalChannelId: channel, externalChannelName: `streamer-${channel.slice(-4)}`,
      creatorConnectionId: connectionId, verified: true,
    });
  }
});

afterAll(async () => {
  if (!sql) return;
  await sql`DELETE FROM sites WHERE id IN (${siteA}, ${siteB})`;
  await sql`DELETE FROM users WHERE id IN (${ownerA}, ${ownerB})`;
  await sql.end({ timeout: 0 });
});

describe("Chat Giveaways (Postgres)", () => {
  integrationIt("connection is ready only after the chat subscription is recorded", async () => {
    expect(await loadChatGiveawayConnection(run, siteA)).toMatchObject({ connected: true, chatReady: false, externalChannelId: channelA });
    expect(await loadChannelEventDelivery(run, siteA)).toEqual({ rewardEventsSubscribedAt: null, chatEventsSubscribedAt: null, checkedAt: null });

    // A reconciliation that found chat missing records the check without marking chat ready.
    await markChannelEventSubscriptions(run, siteA, "kick", { rewardEvents: true, chatEvents: false });
    expect(await loadChatGiveawayConnection(run, siteA)).toMatchObject({ connected: true, chatReady: false });
    let delivery = await loadChannelEventDelivery(run, siteA);
    expect(delivery.rewardEventsSubscribedAt).not.toBeNull();
    expect(delivery.chatEventsSubscribedAt).toBeNull();
    expect(delivery.checkedAt).not.toBeNull();

    await markChannelEventSubscriptions(run, siteA, "kick", { rewardEvents: true, chatEvents: true });
    expect(await loadChatGiveawayConnection(run, siteA)).toMatchObject({ connected: true, chatReady: true });
    delivery = await loadChannelEventDelivery(run, siteA);
    expect(delivery.chatEventsSubscribedAt).not.toBeNull();

    // Site B's channel is untouched by site A's reconciliation.
    expect(await loadChannelEventDelivery(run, siteB)).toEqual({ rewardEventsSubscribedAt: null, chatEventsSubscribedAt: null, checkedAt: null });
    await markChannelEventSubscriptions(run, siteB, "kick", { rewardEvents: true, chatEvents: true });
  });

  integrationIt("collects one entry per stable Kick user, case-insensitively, exact token only", async () => {
    const session = await startSession(siteA);
    expect(await ingestChatGiveawayMessage(run, msg(channelA, "u1", "hello chat"))).toMatchObject({ matched: false, entered: false });
    expect(await ingestChatGiveawayMessage(run, { ...msg(channelA, "u1", "!WIN"), badges: [{ type: "vip" }] })).toMatchObject({ entered: true });
    expect(await ingestChatGiveawayMessage(run, msg(channelA, "u1", "!win again", "renamed-u1"))).toMatchObject({ entered: false, duplicate: true });
    expect(await ingestChatGiveawayMessage(run, msg(channelA, "u2", "!winner"))).toMatchObject({ matched: false, entered: false });
    expect(await ingestChatGiveawayMessage(run, msg(channelA, "u2", "!win"))).toMatchObject({ entered: true });
    expect(await entries(session.id)).toEqual([
      { provider_user_id: "u1", username: "viewer-u1" },
      { provider_user_id: "u2", username: "viewer-u2" },
    ]);
    expect(await sql`SELECT badges FROM chat_giveaway_entries WHERE giveaway_session_id=${session.id} AND provider_user_id='u1'`).toEqual([{ badges: [{ type: "vip" }] }]);
    // The database enforces it even when the application path is bypassed.
    const duplicate = await sql`INSERT INTO chat_giveaway_entries (giveaway_session_id, provider_user_id, username) VALUES (${session.id}, 'u1', 'x')`
      .then(() => null, (err) => err);
    expect(duplicate).toMatchObject({ code: "23505" });
  });

  integrationIt("only one active giveaway per site; a second start fails instead of replacing it", async () => {
    await expect(startSession(siteA, "!other")).rejects.toMatchObject({ code: "23P01" });
    const active = await sql`SELECT keyword FROM chat_giveaway_sessions WHERE site_id=${siteA} AND status='active'`;
    expect(active).toEqual([{ keyword: "!win" }]);
    // Another site is unaffected.
    const b = await startSession(siteB);
    expect(b.status).toBe("active");
  });

  integrationIt("channel A never feeds site B and vice versa", async () => {
    const [a] = await sql`SELECT id FROM chat_giveaway_sessions WHERE site_id=${siteA} AND status='active'`;
    const [b] = await sql`SELECT id FROM chat_giveaway_sessions WHERE site_id=${siteB} AND status='active'`;
    const outcome = await ingestChatGiveawayMessage(run, msg(channelA, "u3", "!win"));
    expect(outcome).toMatchObject({ entered: true, sessionId: a.id });
    expect(await entries(b.id)).toEqual([]);
    expect(await ingestChatGiveawayMessage(run, msg(channelB, "u3", "!win"))).toMatchObject({ entered: true, sessionId: b.id });
    expect((await entries(a.id)).map((e) => e.provider_user_id)).toEqual(["u1", "u2", "u3"]);
    // An unverified copy of channel A bound to site B must not route.
    await sql`UPDATE community_channels SET verified_at = NULL WHERE site_id=${siteB}`;
    expect(await ingestChatGiveawayMessage(run, msg(channelB, "u4", "!win"))).toMatchObject({ routed: false });
    await sql`UPDATE community_channels SET verified_at = now() WHERE site_id=${siteB}`;
  });

  integrationIt("stopping keeps entrants and rejects new ones", async () => {
    const [a] = await sql`SELECT id FROM chat_giveaway_sessions WHERE site_id=${siteA} AND status='active'`;
    await sql`UPDATE chat_giveaway_sessions SET status='stopped', stopped_at=now() WHERE id=${a.id}`;
    expect(await ingestChatGiveawayMessage(run, msg(channelA, "u5", "!win"))).toMatchObject({ routed: false, entered: false });
    expect(await entries(a.id)).toHaveLength(3);
    // Entries persist independently of any dashboard: re-reading yields the same rows.
    expect((await entries(a.id)).map((e) => e.provider_user_id)).toEqual(["u1", "u2", "u3"]);
    // Site can start a fresh one after stopping.
    const next = await startSession(siteA, "!again");
    expect(next.status).toBe("active");
  });

  integrationIt("finalizing stamps who confirmed and persists across re-reads", async () => {
    // Uses site A's stopped "!win" session so site B's active giveaway is untouched.
    const [a] = await sql`SELECT id FROM chat_giveaway_sessions WHERE site_id=${siteA} AND status='stopped'`;
    const [e] = await sql`SELECT id FROM chat_giveaway_entries WHERE giveaway_session_id=${a.id} AND provider_user_id='u1'`;
    const [s] = await sql`UPDATE chat_giveaway_sessions
      SET winner_entry_id=${e.id}, drawn_at=now(), winner_finalized_at=now(), winner_finalized_by=${ownerA},
          status='completed'
      WHERE id=${a.id} RETURNING winner_finalized_at, winner_finalized_by`;
    expect(s.winner_finalized_at).not.toBeNull();
    expect(s.winner_finalized_by).toBe(ownerA);
    const [reread] = await sql`SELECT winner_finalized_at, winner_finalized_by FROM chat_giveaway_sessions WHERE id=${a.id}`;
    expect(reread.winner_finalized_at).not.toBeNull();
    expect(reread.winner_finalized_by).toBe(ownerA);
  });

  integrationIt("disconnecting Kick stops collection, clears readiness, and preserves history", async () => {
    await stopActiveChatGiveaways(run, siteA);
    await revokeCommunityChannel(run, siteA, "kick");
    expect(await loadChatGiveawayConnection(run, siteA)).toMatchObject({ connected: false, chatReady: false });
    expect(await sql`SELECT count(*)::int AS n FROM chat_giveaway_sessions WHERE site_id=${siteA} AND status='active'`).toEqual([{ n: 0 }]);
    expect(await ingestChatGiveawayMessage(run, msg(channelA, "u6", "!win"))).toMatchObject({ routed: false });
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM chat_giveaway_entries e
      JOIN chat_giveaway_sessions s ON s.id = e.giveaway_session_id WHERE s.site_id=${siteA}`;
    expect(n).toBe(3);
    // Site B's active giveaway keeps collecting.
    expect(await ingestChatGiveawayMessage(run, msg(channelB, "u7", "!win"))).toMatchObject({ entered: true });
  });
});
