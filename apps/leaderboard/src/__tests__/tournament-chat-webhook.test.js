// Tournament chat registration: the Kick `chat.message.sent` webhook is the
// only writer of chat-sourced entries. `ingestTournamentChatMessage` routes a
// channel through the verified site binding (never trusting payload site ids),
// matches the entry keyword, and adds the sender under the shared entry rules.
//
// Run: bun test src/__tests__/tournament-chat-webhook.test.js

import { beforeAll, describe, expect, it, mock } from "bun:test";
import { addTournamentEntryTx, ingestTournamentChatMessage } from "../handlers/tournaments.js";
import { handleKickWebhook } from "../handlers/kick-webhook.js";

const ROUTE = { id: "tournament-1", entry_keyword: "!join" };

const chatPayload = (content = "!join", channelSlug = "kickcup") => ({
  message_id: crypto.randomUUID(),
  broadcaster: { user_id: 111, channel_slug: channelSlug, username: "streamer" },
  sender: { user_id: 222, username: "viewer" },
  content,
});

function fakeTx({
  route = ROUTE,
  tournament = { id: "tournament-1", signup_state: "open", entry_cap: null },
  existing = null,
  eligibleCount = 0,
} = {}) {
  const calls = [];
  const tx = {
    one: mock(async (sql) => {
      const text = String(sql);
      calls.push(text);
      if (text.includes("community_channels")) return route;
      if (text.includes("INSERT INTO tournament_entries")) {
        return { id: "entry-1", tournament_id: tournament.id, display_name: "viewer", source: "chat", status: "pending" };
      }
      if (text.includes("UPDATE tournament_entries")) {
        return { ...(existing || {}), status: "pending" };
      }
      if (text.includes("count(*)")) return { count: eligibleCount };
      if (text.includes("FROM tournament_entries")) return existing;
      if (text.includes("FROM tournaments")) return tournament;
      return undefined;
    }),
    query: mock(async () => []),
    unsafe: mock(async () => []),
  };
  return { tx, calls };
}

const ingest = (payload, tx) => ingestTournamentChatMessage(payload, { withTransaction: async (fn) => fn(tx) });
const inserted = (calls) => calls.some((sql) => sql.includes("INSERT INTO tournament_entries"));

describe("ingestTournamentChatMessage", () => {
  it("enters the sender when signups are open and the channel matches", async () => {
    const { tx, calls } = fakeTx();
    const outcome = await ingest(chatPayload("!join"), tx);
    expect(outcome).toEqual({
      routed: true, matched: true, entered: true,
      duplicate: false, rejected: null, tournamentId: "tournament-1",
    });
    expect(inserted(calls)).toBe(true);
  });

  it("matches only the first whitespace token, case-insensitively", async () => {
    const upper = fakeTx();
    expect((await ingest(chatPayload("!JOIN please"), upper.tx)).entered).toBe(true);
    expect(inserted(upper.calls)).toBe(true);

    for (const content of ["!joinx", "hello", "join now"]) {
      const { tx, calls } = fakeTx();
      const outcome = await ingest(chatPayload(content), tx);
      expect(outcome).toMatchObject({ routed: true, matched: false, entered: false });
      expect(inserted(calls)).toBe(false);
    }
  });

  it("routes by the verified channel binding, not the payload site", async () => {
    const { tx, calls } = fakeTx({ route: null });
    const outcome = await ingest(chatPayload("!join"), tx);
    expect(outcome).toMatchObject({ routed: false, matched: false, entered: false });
    expect(inserted(calls)).toBe(false);
  });

  it("ignores payloads without a channel id", async () => {
    const { tx } = fakeTx();
    const outcome = await ingest({ sender: { user_id: 222 }, content: "!join" }, tx);
    expect(outcome.routed).toBe(false);
    expect(tx.one).not.toHaveBeenCalled();
  });

  it("treats a repeated !join and a redelivered webhook as duplicates", async () => {
    const existing = { id: "entry-1", display_name: "viewer", status: "pending" };
    const { tx, calls } = fakeTx({ existing });
    const outcome = await ingest(chatPayload("!join"), tx);
    expect(outcome).toMatchObject({ routed: true, matched: true, entered: false, duplicate: true });
    expect(inserted(calls)).toBe(false);

    // Same payload delivered twice: the first inserts, the second sees the row.
    const first = fakeTx();
    expect((await ingest(chatPayload("!join"), first.tx)).entered).toBe(true);
    const second = fakeTx({ existing: { id: "entry-1", display_name: "viewer", status: "pending" } });
    expect((await ingest(chatPayload("!join"), second.tx)).duplicate).toBe(true);
    expect(inserted(second.calls)).toBe(false);
  });

  it("reports a blocked sender as rejected instead of entering", async () => {
    const { tx, calls } = fakeTx({ existing: { id: "entry-1", display_name: "viewer", status: "blocked" } });
    const outcome = await ingest(chatPayload("!join"), tx);
    expect(outcome).toMatchObject({ matched: true, entered: false, duplicate: false });
    expect(outcome.rejected).toContain("blocked");
    expect(inserted(calls)).toBe(false);
  });
});

describe("addTournamentEntryTx", () => {
  it("refuses entries while signups are closed or locked", async () => {
    for (const signupState of ["closed", "locked"]) {
      const { tx } = fakeTx({ tournament: { id: "tournament-1", signup_state: signupState, entry_cap: null } });
      const result = await addTournamentEntryTx(tx, "tournament-1", {
        displayName: "viewer", viewerId: null, source: "chat",
        trustScore: null, altFlag: false, altReason: null,
      });
      expect(result).toEqual({ error: "Tournament signups are not open.", status: 409 });
      expect(tx.one).toHaveBeenCalledTimes(1);
    }
  });
});

// ---------------------------------------------------------------------------
// /webhooks/kick: signature verification gates the tournament ingest — nothing
// but the signed webhook request is involved in registering an entry.
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

describe("Kick webhook → tournament ingest", () => {
  it("feeds a validly signed chat event into the tournament ingest", async () => {
    const outcome = { routed: true, matched: true, entered: true, duplicate: false, rejected: null, tournamentId: "tournament-1" };
    const ingestTournamentMessage = mock(async () => outcome);
    const res = await handleKickWebhook(
      await signedRequest("chat.message.sent", chatPayload("!join")),
      { KICK_WEBHOOK_PUBLIC_KEY: publicKeyPem },
      {
        ingestChatMessage: async () => ({ routed: true, matched: true, entered: true }),
        ingestTournamentMessage,
      },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).tournament).toEqual(outcome);
    expect(ingestTournamentMessage).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid signature before the tournament ingest", async () => {
    const forged = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"],
    );
    const ingestTournamentMessage = mock(async () => ({}));
    const res = await handleKickWebhook(
      await signedRequest("chat.message.sent", chatPayload("!join"), { signWith: forged.privateKey }),
      { KICK_WEBHOOK_PUBLIC_KEY: publicKeyPem },
      { ingestChatMessage: async () => ({}), ingestTournamentMessage },
    );
    expect(res.status).toBe(401);
    expect(ingestTournamentMessage).not.toHaveBeenCalled();
  });

  it("rejects unsigned requests before the tournament ingest", async () => {
    const ingestTournamentMessage = mock(async () => ({}));
    const res = await handleKickWebhook(
      new Request("https://yourrank.site/webhooks/kick", { method: "POST", body: JSON.stringify(chatPayload("!join")) }),
      { KICK_WEBHOOK_PUBLIC_KEY: publicKeyPem },
      { ingestChatMessage: async () => ({}), ingestTournamentMessage },
    );
    expect(res.status).toBe(400);
    expect(ingestTournamentMessage).not.toHaveBeenCalled();
  });
});
