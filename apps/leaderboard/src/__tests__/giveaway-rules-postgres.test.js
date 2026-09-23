// Real PostgreSQL coverage for persisted giveaway eligibility and verification.
// Self-skips in the regular database-free suite; CI's migration dry-run supplies
// AUDIT_TEST_DATABASE_URL after applying the complete migration chain.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { ingestChatGiveawayMessage } from "@yourrank/shared/chat-giveaways";
import { handleGiveawayVerification } from "../handlers/giveaway-verification.js";
import { handleChatGiveawayDraw, handleChatGiveawayStart } from "../handlers/chat-giveaways.js";
import { giveawayIpHash } from "../handlers/giveaway-verification.js";

const url = process.env.AUDIT_TEST_DATABASE_URL || "";
const integrationIt = (name, fn) => (url ? it : it.skip)(name, fn, 60000);
const ownerId = crypto.randomUUID();
const otherOwnerId = crypto.randomUUID();
const siteId = crypto.randomUUID();
const otherSiteId = crypto.randomUUID();
const channelId = `giveaway-${crypto.randomUUID()}`;
let sql;
const run = (text, params = []) => sql.unsafe(text, params);
const one = async (text, params = []) => (await run(text, params))[0] || null;
const query = run;
const transaction = (fn) => sql.begin((tx) => fn((text, params = []) => tx.unsafe(text, params)));

function actor(viewerId, kickId, username = `viewer-${kickId}`) {
  return { id: viewerId, identities: [{ provider: "kick", externalUserId: kickId, username, linkedAt: "2026-09-01T00:00:00.000Z" }] };
}

async function createViewer(kickId) {
  // Keep reruns deterministic after an interrupted test process.
  await sql`DELETE FROM viewers WHERE kick_user_id=${kickId}`;
  const id = crypto.randomUUID();
  // The viewer identity mirror trigger writes the canonical linked identity.
  await sql`INSERT INTO viewers (id, kick_user_id, kick_username, kick_linked_at) VALUES (${id}, ${kickId}, ${`viewer-${kickId}`}, now())`;
  return { id, actor: actor(id, kickId) };
}

async function createSession(rules, status = "active", targetSite = siteId) {
  await sql`UPDATE chat_giveaway_sessions SET status='stopped', stopped_at=now()
    WHERE site_id=${targetSite} AND status='active'`;
  const [session] = await sql`INSERT INTO chat_giveaway_sessions (site_id, keyword, status, created_by, rules)
    VALUES (${targetSite}, ${`!${crypto.randomUUID().slice(0, 8)}`}, ${status}, ${targetSite === siteId ? ownerId : otherOwnerId}, ${sql.json(rules)})
    RETURNING id, site_id, keyword, status, rules, verification_salt`;
  return session;
}

function chatMessage(userId, badges = []) {
  return { provider: "kick", externalChannelId: channelId, senderUserId: userId,
    senderUsername: `viewer-${userId}`, senderAvatarUrl: null, badges, content: "!enter" };
}

async function addChatEntry(session, userId, badges = []) {
  // Use the configured session keyword, preserving real webhook matching.
  return ingestChatGiveawayMessage(run, { ...chatMessage(userId, badges), content: session.keyword });
}

async function stopSession(session) {
  await sql`UPDATE chat_giveaway_sessions SET status='stopped', stopped_at=now() WHERE id=${session.id}`;
}

async function verify(session, viewerActor, ip, extra = {}, method = "POST") {
  const request = new Request(`https://yourrank.site/api/viewer/giveaway?sessionId=${session.id}`, {
    method,
    headers: { "content-type": "application/json", "cf-connecting-ip": ip, origin: "https://yourrank.site" },
    ...(method === "POST" ? { body: JSON.stringify({ sessionId: session.id, ...extra }) } : {}),
  });
  return handleGiveawayVerification(request, {}, {
    one, query, transaction,
    resolveViewer: async () => ({ viewer: viewerActor, cookie: null }),
    rateLimit: async () => ({ ok: true }),
  });
}

function creatorDeps() {
  const user = { id: ownerId };
  const site = { id: siteId, user_id: ownerId };
  return {
    requireUser: async () => ({ user, res: null }),
    getByUser: async () => site,
    getBoardById: async (_env, userId, id) => userId === ownerId && id === siteId ? site : null,
    requireSiteCapability: async () => ({ res: null }),
    one, query, transaction,
    loadChatGiveawayConnection: async () => ({ connected: true, chatReady: true, externalChannelId: channelId }),
  };
}

beforeAll(async () => {
  if (!url) return;
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1", "postgres"].includes(parsed.hostname) || !/test|e2e/i.test(parsed.pathname)) {
    throw new Error("AUDIT_TEST_DATABASE_URL must point to a disposable local database");
  }
  sql = postgres(url, { max: 8, prepare: false });
  await sql`INSERT INTO users (id, email, status, email_verified) VALUES
    (${ownerId}, ${`${ownerId}@giveaway.test`}, 'active', true),
    (${otherOwnerId}, ${`${otherOwnerId}@giveaway.test`}, 'active', true)`;
  await sql`INSERT INTO sites (id, user_id, slug, name, published, is_draft) VALUES
    (${siteId}, ${ownerId}, ${`gw-${siteId.slice(0, 28)}`}, 'Giveaway test site', true, false),
    (${otherSiteId}, ${otherOwnerId}, ${`gw-${otherSiteId.slice(0, 28)}`}, 'Other giveaway site', true, false)`;
  const connectionId = await sql.begin((tx) => tx`INSERT INTO creator_connections
    (user_id, provider, external_user_id, username, access_token_enc, status, linked_at)
    VALUES (${ownerId}, 'kick', ${channelId}, 'giveaway-test', 'test-token', 'active', now()) RETURNING id`
    .then((rows) => rows[0].id));
  await sql`INSERT INTO community_channels (site_id, provider, external_channel_id, external_channel_name,
    creator_connection_id, status, verified_at, chat_events_subscribed_at)
    VALUES (${siteId}, 'kick', ${channelId}, 'giveaway-test', ${connectionId}, 'active', now(), now())`;
});

afterAll(async () => {
  if (!sql) return;
  await sql`DELETE FROM sites WHERE id IN (${siteId}, ${otherSiteId})`;
  await sql`DELETE FROM users WHERE id IN (${ownerId}, ${otherOwnerId})`;
  await sql.end({ timeout: 0 });
});

describe("Giveaway entry rules (Postgres)", () => {
  integrationIt("accepts normal chat entries and persists authoritative rules at start", async () => {
    const d = creatorDeps();
    const start = await handleChatGiveawayStart(new Request("https://yourrank.site/api/giveaways/chat/start", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ keyword: "!chat", rules: { entryMode: "chat" } }),
    }), {}, d);
    expect(start.status).toBe(200);
    const { session } = await start.json();
    expect(session.rules).toMatchObject({ entryMode: "chat", onePerIp: false });
    const outcome = await ingestChatGiveawayMessage(run, { ...chatMessage("chat-user"), content: session.keyword });
    expect(outcome).toMatchObject({ entered: true, matched: true });
    expect(await one("SELECT eligibility_status FROM chat_giveaway_entries WHERE giveaway_session_id=$1", [session.id]))
      .toMatchObject({ eligibility_status: "eligible" });
    await stopSession(session);
  });

  integrationIt("rejects unlinked members and admits the authenticated linked YourRank + Kick identity", async () => {
    const session = await createSession({ entryMode: "members" });
    const unlinked = await addChatEntry(session, "members-unlinked");
    expect(unlinked.entered).toBe(true);
    expect(await one("SELECT eligibility_status, eligibility_reason FROM chat_giveaway_entries WHERE giveaway_session_id=$1 AND provider_user_id='members-unlinked'", [session.id]))
      .toMatchObject({ eligibility_status: "rejected", eligibility_reason: "not_yourrank_member" });
    await createViewer("members-linked");
    await addChatEntry(session, "members-linked");
    expect(await one("SELECT eligibility_status FROM chat_giveaway_entries WHERE giveaway_session_id=$1 AND provider_user_id='members-linked'", [session.id]))
      .toMatchObject({ eligibility_status: "eligible" });
    await stopSession(session);
  });

  integrationIt("holds Verified Entry pending until authenticated identity verification", async () => {
    const session = await createSession({ entryMode: "verified" });
    const linked = await createViewer("verified-user");
    await addChatEntry(session, "verified-user");
    expect(await one("SELECT eligibility_status, eligibility_reason FROM chat_giveaway_entries WHERE giveaway_session_id=$1", [session.id]))
      .toMatchObject({ eligibility_status: "pending_verification", eligibility_reason: "verification_required" });
    const response = await verify(session, linked.actor, "192.0.2.12");
    expect(await response.json()).toMatchObject({ status: "eligible" });
    expect(await one("SELECT eligibility_status, viewer_id, verified_at FROM chat_giveaway_entries WHERE giveaway_session_id=$1", [session.id]))
      .toMatchObject({ eligibility_status: "eligible", viewer_id: linked.id });
    await stopSession(session);
  });

  integrationIt("cannot verify another Kick identity, cross-site session, or bypass YourRank authentication", async () => {
    const session = await createSession({ entryMode: "verified" });
    const entryOwner = await createViewer("identity-owner");
    const attacker = await createViewer("different-kick-account");
    await addChatEntry(session, "identity-owner");
    const before = await one("SELECT eligibility_status, viewer_id FROM chat_giveaway_entries WHERE giveaway_session_id=$1", [session.id]);
    const forged = await verify(session, attacker.actor, "192.0.2.13", { providerUserId: "identity-owner", viewerId: entryOwner.id });
    expect(await forged.json()).toMatchObject({ status: "pending_verification", reason: "entry_required" });
    expect(await one("SELECT eligibility_status, viewer_id FROM chat_giveaway_entries WHERE giveaway_session_id=$1", [session.id])).toEqual(before);
    expect(await (await verify(session, null, "192.0.2.13", { providerUserId: "identity-owner" })).json())
      .toMatchObject({ status: "pending_verification", reason: "not_yourrank_member" });

    const otherSiteSession = await createSession({ entryMode: "verified" }, "active", otherSiteId);
    await sql`INSERT INTO chat_giveaway_entries (giveaway_session_id, provider_user_id, username, eligibility_status)
      VALUES (${otherSiteSession.id}, 'identity-owner', 'identity-owner', 'pending_verification')`;
    const crossSite = await verify(session, entryOwner.actor, "192.0.2.13", { sessionId: otherSiteSession.id });
    expect(crossSite.status).toBe(400);
    expect(await one("SELECT eligibility_status FROM chat_giveaway_entries WHERE giveaway_session_id=$1", [otherSiteSession.id]))
      .toMatchObject({ eligibility_status: "pending_verification" });
    await stopSession(session);
    await stopSession(otherSiteSession);
  });

  integrationIt("enforces one account per IP under concurrent verification and permits shared IP when disabled", async () => {
    const first = await createViewer("ip-first");
    const second = await createViewer("ip-second");
    const enforced = await createSession({ entryMode: "verified", onePerIp: true });
    await addChatEntry(enforced, "ip-first");
    await addChatEntry(enforced, "ip-second");
    const [left, right] = await Promise.all([
      verify(enforced, first.actor, "192.0.2.21"),
      verify(enforced, second.actor, "192.0.2.21"),
    ]);
    const outcomes = await Promise.all([left.json(), right.json()]);
    expect(outcomes.map((x) => x.status).sort()).toEqual(["eligible", "rejected"]);
    expect(outcomes.find((x) => x.reason === "duplicate_ip")).toBeTruthy();
    const [hash] = await sql`SELECT ip_hash FROM chat_giveaway_entries WHERE giveaway_session_id=${enforced.id} AND eligibility_status='eligible'`;
    expect(hash.ip_hash).toBe(await giveawayIpHash("192.0.2.21", enforced.verification_salt));
    const serialized = JSON.stringify(await sql`SELECT * FROM chat_giveaway_entries WHERE giveaway_session_id=${enforced.id}`);
    expect(serialized).not.toContain("192.0.2.21");
    expect(serialized).not.toMatch(/"(?:raw_ip|ip_address)"\s*:/i);

    const allowed = await createSession({ entryMode: "verified", onePerIp: false });
    await addChatEntry(allowed, "ip-first");
    await addChatEntry(allowed, "ip-second");
    expect((await Promise.all([
      verify(allowed, first.actor, "192.0.2.21"), verify(allowed, second.actor, "192.0.2.21"),
    ])).map((r) => r.status)).toEqual([200, 200]);
    expect(await sql`SELECT count(*)::int AS n FROM chat_giveaway_entries WHERE giveaway_session_id=${allowed.id} AND eligibility_status='eligible' AND ip_hash IS NULL`)
      .toEqual([{ n: 2 }]);
    await stopSession(enforced);
    await stopSession(allowed);
  });

  integrationIt("normalizes IPs, scopes hashes per giveaway, and never accepts a client hash", async () => {
    const viewer = await createViewer("scoped-ip");
    const a = await createSession({ entryMode: "verified", onePerIp: true });
    await addChatEntry(a, "scoped-ip");
    await verify(a, viewer.actor, "2001:db8::1", { ipHash: "client-controlled" });
    const [entryA] = await sql`SELECT ip_hash FROM chat_giveaway_entries WHERE giveaway_session_id=${a.id}`;
    expect(entryA.ip_hash).toBe(await giveawayIpHash("2001:0db8:0:0:0:0:0:1", a.verification_salt));
    expect(entryA.ip_hash).not.toBe("client-controlled");
    const b = await createSession({ entryMode: "verified", onePerIp: true });
    await addChatEntry(b, "scoped-ip");
    await verify(b, viewer.actor, "2001:0db8:0:0:0:0:0:1");
    const [entryB] = await sql`SELECT ip_hash FROM chat_giveaway_entries WHERE giveaway_session_id=${b.id}`;
    expect(entryB.ip_hash).not.toBe(entryA.ip_hash);
    await stopSession(a);
    await stopSession(b);
  });

  integrationIt("applies subscriber, VIP, and previous-winner exclusions from persisted server facts", async () => {
    const subscriber = await createSession({ entryMode: "chat", subscriberOnly: true });
    await addChatEntry(subscriber, "not-subscriber");
    await addChatEntry(subscriber, "is-subscriber", [{ type: "subscriber" }]);
    expect(await sql`SELECT provider_user_id, eligibility_status, eligibility_reason FROM chat_giveaway_entries
      WHERE giveaway_session_id=${subscriber.id} ORDER BY provider_user_id`).toEqual([
      { provider_user_id: "is-subscriber", eligibility_status: "eligible", eligibility_reason: null },
      { provider_user_id: "not-subscriber", eligibility_status: "rejected", eligibility_reason: "subscriber_required" },
    ]);
    const vip = await createSession({ entryMode: "chat", vipOnly: true });
    await addChatEntry(vip, "not-vip");
    await addChatEntry(vip, "is-vip", [{ type: "vip" }]);
    expect(await one("SELECT eligibility_reason FROM chat_giveaway_entries WHERE giveaway_session_id=$1 AND provider_user_id='not-vip'", [vip.id]))
      .toMatchObject({ eligibility_reason: "vip_required" });
    const prior = await createSession({ entryMode: "chat" });
    await sql`INSERT INTO chat_giveaway_draws (giveaway_session_id, provider_user_id) VALUES (${prior.id}, 'old-winner')`;
    await stopSession(prior);
    const current = await createSession({ entryMode: "chat", excludePreviousWinners: true });
    await addChatEntry(current, "old-winner");
    expect(await one("SELECT eligibility_status, eligibility_reason FROM chat_giveaway_entries WHERE giveaway_session_id=$1", [current.id]))
      .toMatchObject({ eligibility_status: "rejected", eligibility_reason: "previous_winner" });
    await stopSession(subscriber);
    await stopSession(vip);
    await stopSession(current);
  });

  integrationIt("rejects unsupported rules and draws only server-eligible entries despite forged client IDs", async () => {
    const invalid = await handleChatGiveawayStart(new Request("https://yourrank.site/api/giveaways/chat/start", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ keyword: "!bad", rules: { entryMode: "verified", vpnDetection: true } }),
    }), {}, creatorDeps());
    expect(invalid.status).toBe(400);

    const session = await createSession({ entryMode: "verified" });
    const eligible = await createViewer("draw-eligible");
    await addChatEntry(session, "draw-eligible");
    await verify(session, eligible.actor, "192.0.2.41");
    await addChatEntry(session, "draw-pending");
    const [eligibleRow] = await sql`SELECT id FROM chat_giveaway_entries WHERE giveaway_session_id=${session.id} AND provider_user_id='draw-eligible'`;
    const [pendingRow] = await sql`SELECT id FROM chat_giveaway_entries WHERE giveaway_session_id=${session.id} AND provider_user_id='draw-pending'`;
    const draw = await handleChatGiveawayDraw(new Request("https://yourrank.site/api/giveaways/chat/draw", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: session.id, eligibleEntryIds: [pendingRow.id] }),
    }), {}, creatorDeps());
    expect(draw.status).toBe(200);
    expect(await one("SELECT winner_entry_id, rules FROM chat_giveaway_sessions WHERE id=$1", [session.id]))
      .toMatchObject({ winner_entry_id: eligibleRow.id, rules: { entryMode: "verified" } });
    await stopSession(session);
  });

  integrationIt("enforces new check constraints, indexes, and foreign keys", async () => {
    const session = await createSession({ entryMode: "chat" });
    const viewer = await createViewer("fk-viewer");
    const [entry] = await sql`INSERT INTO chat_giveaway_entries (giveaway_session_id, provider_user_id, username, viewer_id)
      VALUES (${session.id}, 'fk-entry', 'fk-entry', ${viewer.id}) RETURNING id`;
    const badStatus = await sql`UPDATE chat_giveaway_entries SET eligibility_status='unknown' WHERE id=${entry.id}`
      .then(() => null, (error) => error);
    expect(badStatus).toMatchObject({ code: "23514" });
    const badViewer = await sql`UPDATE chat_giveaway_entries SET viewer_id=${crypto.randomUUID()} WHERE id=${entry.id}`
      .then(() => null, (error) => error);
    expect(badViewer).toMatchObject({ code: "23503" });
    expect(await sql`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname='idx_chat_giveaway_verified_ip'`)
      .toEqual([{ indexname: "idx_chat_giveaway_verified_ip" }]);
    await sql`DELETE FROM viewers WHERE id=${viewer.id}`;
    expect(await one("SELECT viewer_id FROM chat_giveaway_entries WHERE id=$1", [entry.id])).toEqual({ viewer_id: null });
    await stopSession(session);
  });
});
