// Tournament chat registration: the Kick `chat.message.sent` webhook is the
// only writer of chat-sourced entries. `ingestTournamentChatMessage` routes a
// channel through the verified site binding (never trusting payload site ids),
// matches the entry keyword, and adds the sender under the shared entry rules.
//
// Run: bun test src/__tests__/tournament-chat-webhook.test.js

import { beforeAll, describe, expect, it, mock } from "bun:test";
import { addTournamentEntryTx, ingestTournamentChatMessage, ingestTournamentChatMessageTx } from "../handlers/tournaments.js";
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
    const { messageId, ...rest } = outcome;
    expect(rest).toEqual({
      routed: true, matched: true, entered: true,
      duplicate: false, rejected: null, tournamentId: "tournament-1",
      senderUsername: "viewer",
      ownerUserId: undefined, broadcasterUserId: undefined,
    });
    expect(typeof messageId).toBe("string");
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

async function signedRequest(eventType, payload, { signWith = privateKey, timestamp = new Date().toISOString(), messageId = crypto.randomUUID() } = {}) {
  const body = JSON.stringify(payload);
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

// A tx whose `one` claims any receipt (returns a row) and answers nothing
// else — enough for the webhook's claim before the injected ingests run.
const claimedTx = {
  one: mock(async () => ({ message_id: "m-1" })),
  query: mock(async () => []),
  unsafe: mock(async () => []),
};
const passThroughTx = async (fn) => fn(claimedTx);

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
        withTransaction: passThroughTx,
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tournament).toEqual(outcome);
    expect(body.duplicate).toBe(false);
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

// ---------------------------------------------------------------------------
// Delivery idempotency: the provider_webhook_receipts claim lives inside the
// same transaction as the chat side effects, so a receipt commits only when
// everything committed. The fakes below model that claim/rollback behavior.
// ---------------------------------------------------------------------------

// A fake "database" shared across transactions: receipts commit on success and
// roll back when the callback throws, mirroring BEGIN/COMMIT.
function chatDb() {
  const committedReceipts = new Set();
  const state = { entryStatus: null, entryWrites: 0 };
  const makeTx = (staged) => ({
    one: async (sql, params = []) => {
      const text = String(sql);
      if (text.includes("provider_webhook_receipts")) {
        if (committedReceipts.has(params[0]) || staged.has(params[0])) return undefined;
        staged.add(params[0]);
        return { message_id: params[0] };
      }
      if (text.includes("community_channels")) return ROUTE;
      if (text.includes("INSERT INTO tournament_entries")) {
        state.entryWrites += 1;
        state.entryStatus = "pending";
        return { id: "entry-1", display_name: "viewer", status: "pending" };
      }
      if (text.includes("UPDATE tournament_entries")) {
        state.entryWrites += 1;
        return { id: "entry-1", display_name: "viewer", status: state.entryStatus };
      }
      if (text.includes("count(*)")) return { count: 0 };
      if (text.includes("FROM tournament_entries")) {
        return state.entryStatus ? { id: "entry-1", display_name: "viewer", status: state.entryStatus } : undefined;
      }
      if (text.includes("FROM tournaments")) return { id: "tournament-1", signup_state: "open", entry_cap: null };
      return undefined;
    },
    query: async () => [],
    unsafe: async () => [],
  });
  const withTransaction = async (fn) => {
    const staged = new Set();
    const out = await fn(makeTx(staged));
    for (const id of staged) committedReceipts.add(id);
    return out;
  };
  return { committedReceipts, state, withTransaction };
}

describe("Kick webhook delivery idempotency", () => {
  const webhookDeps = (db, overrides = {}) => ({
    ingestChatMessage: async () => ({ routed: true, matched: true, entered: true }),
    ingestTournamentMessage: (payload, env, tx) => ingestTournamentChatMessageTx(tx, payload),
    withTransaction: db.withTransaction,
    ...overrides,
  });

  it("processes a redelivered message id exactly once", async () => {
    const db = chatDb();
    const messageId = crypto.randomUUID();
    const payload = chatPayload("!join");
    const first = await handleKickWebhook(
      await signedRequest("chat.message.sent", payload, { messageId }),
      { KICK_WEBHOOK_PUBLIC_KEY: publicKeyPem },
      webhookDeps(db),
    );
    const second = await handleKickWebhook(
      await signedRequest("chat.message.sent", payload, { messageId }),
      { KICK_WEBHOOK_PUBLIC_KEY: publicKeyPem },
      webhookDeps(db),
    );
    expect((await first.json()).duplicate).toBe(false);
    expect(await second.json()).toEqual({ ok: true, duplicate: true });
    expect(db.state.entryWrites).toBe(1);
  });

  it("never revives a removed entry when a delivered message is retried", async () => {
    const db = chatDb();
    const messageId = crypto.randomUUID();
    const payload = chatPayload("!join");
    const first = await handleKickWebhook(
      await signedRequest("chat.message.sent", payload, { messageId }),
      { KICK_WEBHOOK_PUBLIC_KEY: publicKeyPem },
      webhookDeps(db),
    );
    expect((await first.json()).tournament.entered).toBe(true);
    // Organizer removes the entry after the first delivery.
    db.state.entryStatus = "removed";
    const second = await handleKickWebhook(
      await signedRequest("chat.message.sent", payload, { messageId }),
      { KICK_WEBHOOK_PUBLIC_KEY: publicKeyPem },
      webhookDeps(db),
    );
    expect((await second.json()).duplicate).toBe(true);
    // The receipt conflict short-circuited before any entry write.
    expect(db.state.entryWrites).toBe(1);
    expect(db.state.entryStatus).toBe("removed");
  });

  it("lets exactly one of two concurrent deliveries process", async () => {
    const committed = new Set();
    let release;
    const gate = new Promise((r) => { release = r; });
    let gatePassed = false;
    const makeTx = () => ({
      one: async (sql, params = []) => {
        const text = String(sql);
        if (text.includes("provider_webhook_receipts")) {
          // First claimer waits at the gate like a row lock; whoever resumes
          // first commits the claim before the loser re-checks.
          if (!gatePassed) await gate;
          if (committed.has(params[0])) return undefined;
          committed.add(params[0]);
          return { message_id: params[0] };
        }
        return undefined;
      },
      query: async () => [],
      unsafe: async () => [],
    });
    const ingestTournamentMessage = mock(async () => ({ entered: true }));
    const deps = {
      ingestChatMessage: async () => ({}),
      ingestTournamentMessage,
      withTransaction: async (fn) => fn(makeTx()),
    };
    const messageId = crypto.randomUUID();
    const payload = chatPayload("!join");
    const [r1, r2] = [
      handleKickWebhook(await signedRequest("chat.message.sent", payload, { messageId }), { KICK_WEBHOOK_PUBLIC_KEY: publicKeyPem }, deps),
      handleKickWebhook(await signedRequest("chat.message.sent", payload, { messageId }), { KICK_WEBHOOK_PUBLIC_KEY: publicKeyPem }, deps),
    ];
    await new Promise((r) => setTimeout(r, 10));
    gatePassed = true;
    release();
    const results = await Promise.all([r1, r2]);
    const bodies = await Promise.all(results.map((r) => r.json()));
    expect(bodies.filter((b) => b.duplicate === false)).toHaveLength(1);
    expect(bodies.filter((b) => b.duplicate === true)).toHaveLength(1);
    expect(ingestTournamentMessage).toHaveBeenCalledTimes(1);
  });

  it("rolls the receipt back when processing fails so a retry reprocesses", async () => {
    const db = chatDb();
    const messageId = crypto.randomUUID();
    const payload = chatPayload("!join");
    let attempts = 0;
    const deps = webhookDeps(db, {
      ingestTournamentMessage: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("database unavailable");
        return { entered: true };
      },
    });
    const first = await handleKickWebhook(
      await signedRequest("chat.message.sent", payload, { messageId }),
      { KICK_WEBHOOK_PUBLIC_KEY: publicKeyPem },
      deps,
    );
    expect(first.status).toBe(500);
    // The failed transaction discarded its staged claim.
    expect(db.committedReceipts.size).toBe(0);

    const retry = await handleKickWebhook(
      await signedRequest("chat.message.sent", payload, { messageId }),
      { KICK_WEBHOOK_PUBLIC_KEY: publicKeyPem },
      deps,
    );
    expect(retry.status).toBe(200);
    expect((await retry.json()).duplicate).toBe(false);
    expect(db.committedReceipts.has(messageId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Chat replies: after an entry commits (joined, full or waitlisted), the webhook answers in
// the streamer's chat through replyDeps. Replies must never fail the webhook.
// ---------------------------------------------------------------------------
describe("Kick webhook → tournament chat reply", () => {
  const CONNECTION = {
    user_id: "owner-1",
    external_user_id: "111",
    access_token_enc: "enc-access",
    refresh_token_enc: "enc-refresh",
    token_expires_at: null,
  };
  const replyDeps = (overrides = {}) => ({
    rateLimit: mock(async () => ({ ok: true })),
    dbOne: mock(async () => CONNECTION),
    dbRun: mock(async () => []),
    getAccessToken: mock(async () => ({
      accessToken: "kick-token", accessEnc: "enc-access", refreshEnc: "enc-refresh", expiresAt: null,
    })),
    storeTokens: mock(async () => {}),
    postChatMessage: mock(async () => ({})),
    ...overrides,
  });
  const fullOutcome = (extra = {}) => ({
    routed: true, matched: true, entered: false, duplicate: false, rejected: null,
    tournamentId: "tournament-1", full: true,
    senderUsername: "viewer", messageId: "msg-9", ownerUserId: "owner-1", broadcasterUserId: "111",
    ...extra,
  });
  const send = async (outcome, deps) => handleKickWebhook(
    await signedRequest("chat.message.sent", chatPayload("!join")),
    { KICK_WEBHOOK_PUBLIC_KEY: publicKeyPem },
    {
      ingestChatMessage: async () => ({}),
      ingestTournamentMessage: async () => outcome,
      withTransaction: passThroughTx,
      replyDeps: deps,
    },
  );

  it("replies 'Signups are full.' after a full entry commits", async () => {
    const deps = replyDeps();
    const res = await send(fullOutcome(), deps);
    expect(res.status).toBe(200);
    expect(deps.postChatMessage).toHaveBeenCalledTimes(1);
    const [token, input] = deps.postChatMessage.mock.calls[0];
    expect(token).toBe("kick-token");
    expect(input).toEqual({
      broadcasterUserId: "111",
      content: "@viewer Signups are full.",
      replyToMessageId: "msg-9",
    });
  });

  it("replies with the waitlist position for a waitlisted entry", async () => {
    const deps = replyDeps();
    const res = await send(fullOutcome({ full: false, waitlisted: true, waitlistPosition: 3 }), deps);
    expect(res.status).toBe(200);
    expect(deps.postChatMessage.mock.calls[0][1].content).toBe(
      "@viewer Signups are full — you're on the waitlist (#3)."
    );
  });

  const joinedOutcome = (extra = {}) => fullOutcome({ full: false, entered: true, tournamentTitle: "Friday Cup", ...extra });
  const joinDeps = ({ players = 4, others = [], since = null, ...overrides } = {}) => replyDeps({
    dbOne: mock(async (sql) => (String(sql).includes("creator_connections")
      ? CONNECTION
      : { at: "2026-10-02T17:00:00.000Z", players })),
    dbQuery: mock(async () => others),
    kvGet: mock(async () => since),
    kvPut: mock(async () => {}),
    ...overrides,
  });

  it("confirms a successful join in chat while replies are available", async () => {
    const deps = joinDeps();
    const res = await send(joinedOutcome(), deps);
    expect(res.status).toBe(200);
    expect(deps.postChatMessage).toHaveBeenCalledTimes(1);
    expect(deps.postChatMessage.mock.calls[0][1]).toEqual({
      broadcasterUserId: "111",
      content: "@viewer You're in for Friday Cup! 4 players so far.",
      replyToMessageId: "msg-9",
    });
    expect(deps.kvPut).toHaveBeenCalledWith(
      expect.anything(), "tournament-join-ack:tournament-1", "2026-10-02T17:00:00.000Z", expect.any(Number),
    );
  });

  it("names joins that arrived while replies were throttled in the next confirmation", async () => {
    const since = "2026-10-02T16:59:10.000Z";
    const deps = joinDeps({
      players: 9,
      since,
      others: [{ display_name: "kai", total: 6 }, { display_name: "lux", total: 6 }, { display_name: "zed", total: 6 }],
    });
    await send(joinedOutcome(), deps);
    expect(deps.postChatMessage.mock.calls[0][1].content).toBe(
      "@viewer You're in for Friday Cup, along with kai, lux, zed and 3 others. 9 players so far."
    );
    const [sql, params] = deps.dbQuery.mock.calls[0];
    expect(String(sql)).toContain("source='chat'");
    expect(params).toEqual(["tournament-1", since, "viewer"]);
  });

  it("does not confirm a throttled join individually or move the confirmation marker", async () => {
    const deps = joinDeps({ rateLimit: mock(async () => ({ ok: false })) });
    await send(joinedOutcome(), deps);
    expect(deps.postChatMessage).not.toHaveBeenCalled();
    expect(deps.dbQuery).not.toHaveBeenCalled();
    expect(deps.kvPut).not.toHaveBeenCalled();
  });

  it("keeps the marker when the confirmation could not be posted, so the names carry over", async () => {
    const errorSpy = mock(() => {});
    const realError = console.error;
    console.error = errorSpy;
    try {
      const deps = joinDeps({ postChatMessage: mock(async () => { throw new Error("Kick chat post failed 500: boom"); }) });
      const res = await send(joinedOutcome(), deps);
      expect(res.status).toBe(200);
      expect(deps.kvPut).not.toHaveBeenCalled();
    } finally {
      console.error = realError;
    }
  });

  it("never replies to a duplicate !join", async () => {
    const deps = joinDeps();
    await send(fullOutcome({ full: false, duplicate: true }), deps);
    expect(deps.postChatMessage).not.toHaveBeenCalled();
    expect(deps.dbOne).not.toHaveBeenCalled();
  });

  it("logs tournament_chat_reply_failed and still returns 200 when the post fails", async () => {
    const errorSpy = mock(() => {});
    const realError = console.error;
    console.error = errorSpy;
    try {
      const deps = replyDeps({ postChatMessage: mock(async () => { throw new Error("Kick chat post failed 500: boom"); }) });
      const res = await send(fullOutcome(), deps);
      expect(res.status).toBe(200);
      const events = errorSpy.mock.calls.map(([line]) => JSON.parse(String(line)).event);
      expect(events).toContain("tournament_chat_reply_failed");
    } finally {
      console.error = realError;
    }
  });

  it("marks 401/403 failures as needing a Kick reconnect for chat write", async () => {
    const errorSpy = mock(() => {});
    const realError = console.error;
    console.error = errorSpy;
    try {
      const deps = replyDeps({ postChatMessage: mock(async () => { throw new Error("Kick chat post failed 401: unauthorized"); }) });
      const res = await send(fullOutcome(), deps);
      expect(res.status).toBe(200);
      const failed = errorSpy.mock.calls
        .map(([line]) => JSON.parse(String(line)))
        .find((event) => event.event === "tournament_chat_reply_failed");
      expect(failed.reason).toBe("reconnect_kick_for_chat_write");
      expect(failed.status).toBe(401);
    } finally {
      console.error = realError;
    }
  });

  it("throttles replies per tournament and logs an info event", async () => {
    const infoSpy = mock(() => {});
    const realInfo = console.info;
    console.info = infoSpy;
    try {
      const deps = replyDeps({ rateLimit: mock(async () => ({ ok: false })) });
      const res = await send(fullOutcome(), deps);
      expect(res.status).toBe(200);
      expect(deps.postChatMessage).not.toHaveBeenCalled();
      const events = infoSpy.mock.calls.map(([line]) => JSON.parse(String(line)).event);
      expect(events).toContain("tournament_chat_reply_throttled");
    } finally {
      console.info = realInfo;
    }
  });

  it("reconnect reason when the creator connection has no stored tokens", async () => {
    const errorSpy = mock(() => {});
    const realError = console.error;
    console.error = errorSpy;
    try {
      const deps = replyDeps({ dbOne: mock(async () => null) });
      const res = await send(fullOutcome(), deps);
      expect(res.status).toBe(200);
      expect(deps.postChatMessage).not.toHaveBeenCalled();
      const failed = errorSpy.mock.calls
        .map(([line]) => JSON.parse(String(line)))
        .find((event) => event.event === "tournament_chat_reply_failed");
      expect(failed.reason).toBe("reconnect_kick_for_chat_write");
    } finally {
      console.error = realError;
    }
  });
});
