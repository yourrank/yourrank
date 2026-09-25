import { describe, expect, it, mock } from "bun:test";
import {
  handleAddTournamentEntry,
  handleBlockTournamentEntry,
  handleCreateTournament,
  handleOpenTournamentSignups,
  handleLockTournamentSignups,
  handleSelectTournamentEntries,
  handleListTournamentEntries,
  handleRemoveTournamentEntry,
  handleRestoreTournamentEntry,
  handleUpdateTournamentSettings,
} from "../handlers/tournaments.js";

const USER = { id: "owner-1", email: "owner@example.com" };
const TOURNAMENT = {
  id: "tournament-1",
  site_id: "site-1",
  site_user_id: "owner-1",
  signup_state: "open",
  entry_cap: null,
  entry_fee: 0,
  chat_channel: "streamerchannel",
};

function request(path, body) {
  return new Request(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function deps({ oneValues = [], queryValues = [], txOneValues = [], txQueryValues = [], authorized = true } = {}) {
  const one = mock(async (sql) => String(sql).includes("FROM users")
    ? { plan: "pro", plan_expires_at: null, status: "active" }
    : oneValues.shift());
  const query = mock(async () => queryValues.shift() || []);
  const txOne = mock(async (sql) => String(sql).includes("FROM users")
    ? { plan: "pro", plan_expires_at: null, status: "active" }
    : txOneValues.shift());
  const txQuery = mock(async () => txQueryValues.shift() || []);
  return {
    one,
    query,
    requireUser: mock(async () => ({ user: USER, res: null })),
    requireSiteCapabilityImpl: mock(async () => (
      authorized ? { res: null } : { res: new Response("Forbidden", { status: 403 }) }
    )),
    withTransaction: mock(async (fn) => fn({ one: txOne, query: txQuery, unsafe: mock(async () => []) })),
    logAudit: mock(async () => {}),
    rateLimit: mock(async () => ({ ok: true })),
    clientIp: mock(() => "127.0.0.1"),
    _mocks: { one, query, txOne, txQuery },
  };
}

describe("tournament entry lifecycle", () => {
  // Answers the transaction reads updateSignupState makes for the open path:
  // lock-holder FOR UPDATE, legacy-open scan, lock INSERT, state UPDATE; and
  // DELETE + UPDATE for the lock path.
  function signupTx({ holder = null, other = null, lock = { site_id: "site-1" } } = {}) {
    const calls = [];
    const tx = {
      one: mock(async (sql, params) => {
        const text = String(sql);
        calls.push(text);
        if (text.includes("tournament_open_signups") && text.includes("FOR UPDATE")) return holder;
        if (text.includes("DELETE FROM tournament_open_signups")) return { site_id: params[0] };
        if (text.includes("INSERT INTO tournament_open_signups")) return lock;
        if (text.includes("id<>")) return other;
        if (text.includes("UPDATE tournaments")) return { id: params[1], signup_state: params[0] };
        return undefined;
      }),
      query: mock(async () => []),
      unsafe: mock(async () => []),
    };
    return { tx, calls };
  }

  it("opens signups and records the state transition", async () => {
    const { tx } = signupTx();
    const d = deps({ oneValues: [TOURNAMENT] });
    d.withTransaction = mock(async (fn) => fn(tx));
    d.loadChatGiveawayConnection = mock(async () => ({
      connected: true, chatReady: true, channelName: "streamerchannel", externalChannelId: "111",
    }));
    d.reconcileKickWebhookDelivery = mock(async () => ({
      status: "ok", subscriptions: { rewardEvents: true, chatEvents: true }, failedEvents: [],
    }));
    const response = await handleOpenTournamentSignups(request("/api/tournaments/tournament-1/signups/open"), {}, d);
    expect(response.status).toBe(200);
    expect((await response.json()).tournament.signup_state).toBe("open");
    expect(d.requireSiteCapabilityImpl).toHaveBeenCalled();
    expect(d.reconcileKickWebhookDelivery).toHaveBeenCalledTimes(1);
  });

  it("allows only one open tournament per site", async () => {
    const open = () => request("/api/tournaments/tournament-1/signups/open");
    const openDeps = (tx) => {
      const d = deps({ oneValues: [TOURNAMENT] });
      d.withTransaction = mock(async (fn) => fn(tx));
      d.loadChatGiveawayConnection = mock(async () => ({
        connected: true, chatReady: true, channelName: "streamerchannel", externalChannelId: "111",
      }));
      d.reconcileKickWebhookDelivery = mock(async () => ({
        status: "ok", subscriptions: { rewardEvents: true, chatEvents: true }, failedEvents: [],
      }));
      return d;
    };

    // Another tournament already holds the open row.
    const held = signupTx({ holder: { tournament_id: "tournament-a", signup_state: "open", status: "active" } });
    const heldResponse = await handleOpenTournamentSignups(open(), {}, openDeps(held.tx));
    expect(heldResponse.status).toBe(409);
    expect((await heldResponse.json()).error).toBe(
      "Another tournament already has open signups. Lock or finish it before opening this one."
    );
    expect(held.calls.some((sql) => sql.includes("SET signup_state"))).toBe(false);

    // A legacy open tournament without a lock row is also a conflict.
    const legacy = signupTx({ other: { id: "tournament-b" } });
    const legacyResponse = await handleOpenTournamentSignups(open(), {}, openDeps(legacy.tx));
    expect(legacyResponse.status).toBe(409);

    // Two opens race for the lock row: the claim decides, one wins.
    const won = signupTx();
    const lost = signupTx({ lock: null });
    const [wonResponse, lostResponse] = await Promise.all([
      handleOpenTournamentSignups(open(), {}, openDeps(won.tx)),
      handleOpenTournamentSignups(open(), {}, openDeps(lost.tx)),
    ]);
    expect(wonResponse.status).toBe(200);
    expect(lostResponse.status).toBe(409);
    expect(lost.calls.some((sql) => sql.includes("SET signup_state"))).toBe(false);

    // A PK violation from a concurrent claim surfaces as the same conflict.
    const raced = deps({ oneValues: [TOURNAMENT] });
    raced.withTransaction = mock(async () => { throw Object.assign(new Error("duplicate key"), { code: "23505" }); });
    raced.loadChatGiveawayConnection = mock(async () => ({
      connected: true, chatReady: true, channelName: "streamerchannel", externalChannelId: "111",
    }));
    raced.reconcileKickWebhookDelivery = mock(async () => ({
      status: "ok", subscriptions: { rewardEvents: true, chatEvents: true }, failedEvents: [],
    }));
    const racedResponse = await handleOpenTournamentSignups(open(), {}, raced);
    expect(racedResponse.status).toBe(409);

    // Re-opening the tournament that already holds the row is idempotent.
    const self = signupTx({
      holder: { tournament_id: "tournament-1", signup_state: "open", status: "draft" },
      lock: null,
    });
    const selfResponse = await handleOpenTournamentSignups(open(), {}, openDeps(self.tx));
    expect(selfResponse.status).toBe(200);
    expect(self.calls.some((sql) => sql.includes("SET signup_state"))).toBe(true);
  });

  it("releases the open-signups row when signups are locked", async () => {
    const { tx, calls } = signupTx();
    const d = deps({ oneValues: [TOURNAMENT] });
    d.withTransaction = mock(async (fn) => fn(tx));
    const response = await handleLockTournamentSignups(request("/api/tournaments/tournament-1/signups/lock"), {}, d);
    expect(response.status).toBe(200);
    const lockDelete = calls.findIndex((sql) => sql.includes("DELETE FROM tournament_open_signups"));
    const stateUpdate = calls.findIndex((sql) => sql.includes("UPDATE tournaments"));
    expect(lockDelete).toBeGreaterThanOrEqual(0);
    expect(stateUpdate).toBeGreaterThan(lockDelete);
  });

  it("requires a routable Kick channel and confirmed chat events to open signups", async () => {
    const open = () => request("/api/tournaments/tournament-1/signups/open");

    const notConnected = deps({ oneValues: [TOURNAMENT] });
    notConnected.loadChatGiveawayConnection = mock(async () => ({
      connected: false, chatReady: false, channelName: null, externalChannelId: null,
    }));
    notConnected.reconcileKickWebhookDelivery = mock(async () => ({ status: "not_connected" }));
    const notConnectedResponse = await handleOpenTournamentSignups(open(), {}, notConnected);
    expect(notConnectedResponse.status).toBe(409);
    expect((await notConnectedResponse.json()).error).toContain("Connect your Kick channel");
    expect(notConnected.reconcileKickWebhookDelivery).not.toHaveBeenCalled();

    const mismatch = deps({ oneValues: [TOURNAMENT] });
    mismatch.loadChatGiveawayConnection = mock(async () => ({
      connected: true, chatReady: true, channelName: "other-channel", externalChannelId: "999",
    }));
    mismatch.reconcileKickWebhookDelivery = mock(async () => ({ status: "ok", subscriptions: { chatEvents: true }, failedEvents: [] }));
    const mismatchResponse = await handleOpenTournamentSignups(open(), {}, mismatch);
    expect(mismatchResponse.status).toBe(409);
    expect((await mismatchResponse.json()).error).toContain("other-channel");

    const chatNotReady = deps({ oneValues: [TOURNAMENT] });
    chatNotReady.loadChatGiveawayConnection = mock(async () => ({
      connected: true, chatReady: false, channelName: "streamerchannel", externalChannelId: "111",
    }));
    chatNotReady.reconcileKickWebhookDelivery = mock(async () => ({
      status: "ok", subscriptions: { rewardEvents: true, chatEvents: false }, failedEvents: [],
    }));
    const chatNotReadyResponse = await handleOpenTournamentSignups(open(), {}, chatNotReady);
    expect(chatNotReadyResponse.status).toBe(409);
    expect((await chatNotReadyResponse.json()).error).toContain("chat events");
    // Reconciliation ran exactly once and the state UPDATE never happened:
    // only the access and plan lookups hit `one`.
    expect(chatNotReady.reconcileKickWebhookDelivery).toHaveBeenCalledTimes(1);
    expect(chatNotReady._mocks.one).toHaveBeenCalledTimes(2);
  });

  it("refuses to open signups until a chat channel is stored", async () => {
    const d = deps({ oneValues: [{ ...TOURNAMENT, chat_channel: null }] });
    const response = await handleOpenTournamentSignups(request("/api/tournaments/tournament-1/signups/open"), {}, d);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("Kick channel");
    // No state transition may happen: only the access and plan lookups ran.
    expect(d._mocks.one).toHaveBeenCalledTimes(2);
  });

  it("persists the chat channel through settings", async () => {
    const d = deps({
      oneValues: [
        { ...TOURNAMENT, chat_channel: null },
        { id: TOURNAMENT.id, chat_channel: "streamerchannel" },
      ],
    });
    const response = await handleUpdateTournamentSettings(
      request("/api/tournaments/tournament-1/settings", { chatChannel: "https://kick.com/StreamerChannel" }),
      {},
      d,
    );
    expect(response.status).toBe(200);
    const update = d._mocks.one.mock.calls[2];
    expect(update[0]).toContain("chat_channel=$1");
    expect(update[1][0]).toBe("StreamerChannel");
  });

  it("enforces the signup cap as a hard limit and locks when it fills", async () => {
    // The last slot is accepted, locks signups, and releases the holder row.
    const last = deps({
      oneValues: [TOURNAMENT],
      txOneValues: [
        { id: TOURNAMENT.id, signup_state: "open", entry_cap: 1 },
        undefined,
        { count: 0 },
        { id: "tournament-1" }, // signup_state='locked' update
        { site_id: "site-1" }, // lock-row delete after the auto-lock
        { id: "entry-1", tournament_id: TOURNAMENT.id, display_name: "Alice", status: "pending" },
      ],
    });
    const lastResponse = await handleAddTournamentEntry(
      request("/api/tournaments/tournament-1/entries", { displayName: "Alice", source: "chat" }),
      {},
      last
    );
    expect(lastResponse.status).toBe(200);
    expect((await lastResponse.json()).entry.status).toBe("pending");
    const lastSql = last._mocks.txOne.mock.calls.map(([sql]) => String(sql));
    expect(lastSql.some((sql) => sql.includes("signup_state='locked'"))).toBe(true);
    expect(lastSql.some((sql) => sql.includes("DELETE FROM tournament_open_signups"))).toBe(true);

    // The next entrant is rejected outright — no waitlist row is created and
    // the open-signups row is still released.
    const over = deps({
      oneValues: [TOURNAMENT],
      txOneValues: [
        { id: TOURNAMENT.id, signup_state: "open", entry_cap: 1 },
        undefined,
        { count: 1 },
        { id: "tournament-1" },
        { site_id: "site-1" },
      ],
    });
    const overResponse = await handleAddTournamentEntry(
      request("/api/tournaments/tournament-1/entries", { displayName: "Bob", source: "chat" }),
      {},
      over
    );
    expect(overResponse.status).toBe(409);
    expect((await overResponse.json()).error).toBe("Tournament signups are full.");
    const overSql = over._mocks.txOne.mock.calls.map(([sql]) => String(sql));
    expect(overSql.some((sql) => sql.includes("INSERT INTO tournament_entries"))).toBe(false);
    expect(overSql.some((sql) => sql.includes("DELETE FROM tournament_open_signups"))).toBe(true);
  });

  it("reserves the internal BYE sentinel name", async () => {
    const d = deps({
      oneValues: [TOURNAMENT],
      txOneValues: [{ id: TOURNAMENT.id, signup_state: "open", entry_cap: null }],
    });
    const response = await handleAddTournamentEntry(
      request("/api/tournaments/tournament-1/entries", { displayName: "__YOURRANK_INTERNAL_BYE__", source: "manual" }),
      {},
      d
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("That name is reserved.");
  });

  it("accepts a player literally named BYE as a normal entrant", async () => {
    const d = deps({
      oneValues: [TOURNAMENT],
      txOneValues: [
        { id: TOURNAMENT.id, signup_state: "open", entry_cap: null },
        undefined, // no existing entry with that name
        { count: 0 },
        { id: "entry-1", tournament_id: TOURNAMENT.id, display_name: "BYE", status: "pending" },
      ],
    });
    const response = await handleAddTournamentEntry(
      request("/api/tournaments/tournament-1/entries", { displayName: " bye ", source: "manual" }),
      {},
      d
    );
    expect(response.status).toBe(200);
    expect((await response.json()).entry.status).toBe("pending");
  });

  it("refuses to restore an entry when the signup limit is reached", async () => {
    const d = deps({
      oneValues: [TOURNAMENT],
      txOneValues: [
        { id: TOURNAMENT.id, signup_state: "open", entry_cap: 5 },
        { id: "entry-1", display_name: "Alice", status: "removed" },
        { count: 5 },
      ],
    });
    const response = await handleRestoreTournamentEntry(
      request("/api/tournaments/tournament-1/entries/entry-1/restore"),
      {},
      d
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("Signup limit reached. Raise the limit before restoring this entry.");
  });

  it("keeps blocked names from re-entering", async () => {
    const d = deps({
      oneValues: [TOURNAMENT],
      txOneValues: [
        { id: TOURNAMENT.id, signup_state: "open", entry_cap: null },
        { id: "entry-1", display_name: "Alice", status: "blocked" },
      ],
    });
    const response = await handleAddTournamentEntry(
      request("/api/tournaments/tournament-1/entries", { displayName: "Alice", source: "chat" }),
      {},
      d
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("blocked");
  });

  it("refuses to add entries while signups are closed or locked", async () => {
    // Entries (manual ones included) are only accepted while signups are open;
    // the guard lives inside the transaction so the chat webhook shares it.
    for (const signupState of ["closed", "locked"]) {
      const d = deps({
        oneValues: [TOURNAMENT],
        txOneValues: [{ id: TOURNAMENT.id, signup_state: signupState, entry_cap: null }],
      });
      const response = await handleAddTournamentEntry(
        request("/api/tournaments/tournament-1/entries", { displayName: "ManualName", source: "manual" }),
        {},
        d
      );
      expect(response.status).toBe(409);
      expect((await response.json()).error).toContain("signups are not open");
      expect(d._mocks.txOne).toHaveBeenCalledTimes(1);
    }
  });

  it("supports non-destructive remove, block, and restore transitions", async () => {
    for (const [handler, nextStatus] of [
      [handleRemoveTournamentEntry, "removed"],
      [handleBlockTournamentEntry, "blocked"],
    ]) {
      const d = deps({
        oneValues: [TOURNAMENT],
        txOneValues: [
          { id: TOURNAMENT.id, signup_state: "open", entry_cap: null },
          { id: "entry-1", status: "pending" },
          { id: "entry-1", status: nextStatus },
        ],
      });
      const response = await handler(request("/api/tournaments/tournament-1/entries/entry-1/action"), {}, d);
      expect(response.status).toBe(200);
      expect((await response.json()).entry.status).toBe(nextStatus);
    }

    const d = deps({
      oneValues: [TOURNAMENT],
      txOneValues: [
        { id: TOURNAMENT.id, signup_state: "open", entry_cap: null },
        { id: "entry-1", display_name: "Alice", status: "blocked" },
        { count: 0 },
        { id: "entry-1", status: "pending" },
      ],
    });
    const response = await handleRestoreTournamentEntry(
      request("/api/tournaments/tournament-1/entries/entry-1/restore"),
      {},
      d
    );
    expect(response.status).toBe(200);
    expect((await response.json()).entry.status).toBe("pending");
  });

  it("returns exactly N distinct server-selected entries", async () => {
    const eligible = Array.from({ length: 22 }, (_, i) => ({ id: `entry-${i + 1}`, display_name: `P${i + 1}` }));
    const d = deps({
      oneValues: [TOURNAMENT],
      txOneValues: [{ ...TOURNAMENT, bracket_size: 8, signup_state: "locked" }, { count: 0 }],
      txQueryValues: [eligible, eligible.slice(0, 8).map((e) => ({ ...e, status: "selected" }))],
    });
    const response = await handleSelectTournamentEntries(
      request("/api/tournaments/tournament-1/entries/select", { mode: "random" }),
      {},
      d
    );
    expect(response.status).toBe(200);
    const entries = (await response.json()).entries;
    expect(entries).toHaveLength(8);
    // Exactly 8 ids went into the status='selected' update.
    const updateCall = d._mocks.txQuery.mock.calls.find(([sql]) => String(sql).includes("status='selected'"));
    expect(updateCall[1][0]).toHaveLength(8);
    const eligibleSql = String(d._mocks.txQuery.mock.calls[0][0]);
    expect(eligibleSql).toContain("action='people_review_allow'");
    expect(eligibleSql).toContain("entity_id=tournament_entries.id::text");
  });

  it("rejects a non-owner from mutating another site's entries", async () => {
    const d = deps({ oneValues: [TOURNAMENT], authorized: false });
    const response = await handleRemoveTournamentEntry(
      request("/api/tournaments/tournament-1/entries/entry-1/remove"),
      {},
      d
    );
    expect(response.status).toBe(403);
    expect(d._mocks.txOne).not.toHaveBeenCalled();
  });

  it("requires authentication and site ownership to read entries", async () => {
    const unauthenticated = deps();
    unauthenticated.requireUser = mock(async () => ({
      user: null,
      res: new Response("Unauthorized", { status: 401 }),
    }));
    const unauthenticatedResponse = await handleListTournamentEntries(
      request("/api/tournaments/tournament-1/entries"),
      {},
      unauthenticated
    );
    expect(unauthenticatedResponse.status).toBe(401);
    expect(unauthenticated._mocks.one).not.toHaveBeenCalled();

    const foreign = deps({ oneValues: [TOURNAMENT], authorized: false });
    const foreignResponse = await handleListTournamentEntries(
      request("/api/tournaments/tournament-1/entries"),
      {},
      foreign
    );
    expect(foreignResponse.status).toBe(403);
    expect(foreign._mocks.query).not.toHaveBeenCalled();
  });

  it("preserves untouched tournament settings during a partial update", async () => {
    const stored = {
      ...TOURNAMENT,
      format: "2v2",
      entry_cap: 12,
      anti_alt_enabled: false,
      require_login: true,
      min_credits: 25,
      entry_fee: 10,
      entry_keyword: "!enter",
    };
    const updated = { ...stored, anti_alt_enabled: true };
    const d = deps({ oneValues: [stored, updated] });
    const response = await handleUpdateTournamentSettings(
      request("/api/tournaments/tournament-1/settings", { antiAltEnabled: true }),
      {},
      d
    );
    expect(response.status).toBe(200);
    expect((await response.json()).tournament).toEqual(updated);
    const [sql, params] = d._mocks.one.mock.calls[2];
    const setClause = sql.split("RETURNING")[0];
    expect(setClause).toContain("anti_alt_enabled");
    expect(setClause).not.toContain("require_login");
    expect(setClause).not.toContain("min_credits");
    expect(params).toEqual([true, TOURNAMENT.id]);
  });

  it("does not create fake participants or matches for an entry-list tournament", async () => {
    const txOne = mock(async () => ({
      id: "tournament-1",
      title: "Community Tournament",
      bracket_size: 8,
      participants_json: [],
    }));
    const txUnsafe = mock(async () => []);
    const d = {
      requireUser: mock(async () => ({ user: USER, res: null })),
      getBoardById: mock(async () => ({ id: "site-1", user_id: USER.id })),
      one: mock(async () => ({ plan: "pro", plan_expires_at: null, status: "active" })),
      requireSiteCapabilityImpl: mock(async () => ({ res: null })),
      withTransaction: mock(async (fn) => fn({ one: txOne, unsafe: txUnsafe })),
      logAudit: mock(async () => {}),
    };
    const response = await handleCreateTournament(
      request("/api/tournaments", {
        siteId: "site-1",
        title: "Community Tournament",
        participants: [],
      }),
      {},
      d
    );
    expect(response.status).toBe(200);
    // participants_json is jsonb: the array is bound natively, never pre-serialised.
    expect(txOne.mock.calls[0][1][4]).toEqual([]);
    expect(txUnsafe).not.toHaveBeenCalled();
  });

  it("creates a real-participant bracket with a supported participant count", async () => {
    const txOne = mock(async () => ({
      id: "tournament-1",
      title: "Community Tournament",
      bracket_size: 4,
      participants_json: ["Alice", "Bob", "Carol", "Dave"],
    }));
    const txUnsafe = mock(async () => []);
    const d = {
      requireUser: mock(async () => ({ user: USER, res: null })),
      getBoardById: mock(async () => ({ id: "site-1", user_id: USER.id })),
      one: mock(async () => ({ plan: "pro", plan_expires_at: null, status: "active" })),
      requireSiteCapabilityImpl: mock(async () => ({ res: null })),
      withTransaction: mock(async (fn) => fn({ one: txOne, unsafe: txUnsafe })),
      logAudit: mock(async () => {}),
    };
    const response = await handleCreateTournament(
      request("/api/tournaments", {
        siteId: "site-1",
        bracketSize: 4,
        participants: ["Alice", "Bob", "Carol", "Dave"],
      }),
      {},
      d
    );
    expect(response.status).toBe(200);
    expect(txUnsafe).toHaveBeenCalledTimes(3);
  });

  it("seeds the bracket when entries are selected randomly", async () => {
    const eligible = [
      { id: "entry-1", display_name: "Alice" },
      { id: "entry-2", display_name: "Bob" },
      { id: "entry-3", display_name: "Carol" },
      { id: "entry-4", display_name: "Dave" },
    ];
    const txUnsafe = mock(async () => []);
    let oneCall = 0;
    let queryCall = 0;
    const d = {
      requireUser: mock(async () => ({ user: USER, res: null })),
      one: mock(async (sql) => String(sql).includes("FROM users")
        ? { plan: "pro", plan_expires_at: null, status: "active" }
        : TOURNAMENT),
      withTransaction: mock(async (fn) => fn({
        one: mock(async () => (++oneCall === 1 ? { ...TOURNAMENT, bracket_size: 4, signup_state: "locked" } : { count: 0 })),
        query: mock(async () => (++queryCall === 1 ? eligible : eligible.map((e) => ({ ...e, status: "selected" })))),
        unsafe: txUnsafe,
      })),
      logAudit: mock(async () => {}),
      requireSiteCapabilityImpl: mock(async () => ({ res: null })),
    };
    const response = await handleSelectTournamentEntries(
      request("/api/tournaments/tournament-1/entries/select", { mode: "random" }),
      {},
      d
    );
    expect(response.status).toBe(200);
    const unsafeSQL = txUnsafe.mock.calls.map((call) => call[0]).join(" ");
    expect(unsafeSQL).toContain("UPDATE tournaments SET participants_json");
    expect(unsafeSQL).not.toContain("bracket_size=");
    expect(unsafeSQL).toContain("INSERT INTO tournament_matches");
    // Seeded rows carry their resolved status/winner (BYE auto-advance).
    expect(unsafeSQL).toContain("winner_name");
  });

  it("enforces the participant-select rules", async () => {
    const locked = { ...TOURNAMENT, bracket_size: 8, signup_state: "locked", entry_fee: 0 };
    const select = (body, over) => handleSelectTournamentEntries(
      request("/api/tournaments/tournament-1/entries/select", body),
      {},
      over,
    );

    // Fewer than 2 eligible → 409.
    const thin = deps({
      oneValues: [TOURNAMENT],
      txOneValues: [locked, { count: 0 }],
      txQueryValues: [[{ id: "e1", display_name: "A" }]],
    });
    const thinResponse = await select({ mode: "random" }, thin);
    expect(thinResponse.status).toBe(409);
    expect((await thinResponse.json()).error).toBe("Need at least 2 eligible players to start.");

    // Signups still open → 409.
    const open = deps({
      oneValues: [TOURNAMENT],
      txOneValues: [{ ...locked, signup_state: "open" }],
    });
    expect((await select({ mode: "random" }, open)).status).toBe(409);

    // Bracket already exists → 409.
    const bracket = deps({
      oneValues: [TOURNAMENT],
      txOneValues: [locked, { count: 3 }],
    });
    expect((await select({ mode: "random" }, bracket)).status).toBe(409);

    const eligible = Array.from({ length: 10 }, (_, i) => ({ id: `e${i + 1}`, display_name: `P${i + 1}` }));

    // Manual: 8 valid ids → exactly those are updated.
    const ids = eligible.slice(0, 8).map((e) => e.id);
    const manual = deps({
      oneValues: [TOURNAMENT],
      txOneValues: [locked, { count: 0 }],
      txQueryValues: [eligible, eligible.slice(0, 8).map((e) => ({ ...e, status: "selected" }))],
    });
    const manualResponse = await select({ mode: "manual", entryIds: ids }, manual);
    expect(manualResponse.status).toBe(200);
    const updateCall = manual._mocks.txQuery.mock.calls.find(([sql]) => String(sql).includes("status='selected'"));
    expect(updateCall[1][0].sort()).toEqual(ids.slice().sort());

    // 9 ids when only 8 spots are open and 10 eligible → 400.
    const nine = deps({
      oneValues: [TOURNAMENT],
      txOneValues: [locked, { count: 0 }],
      txQueryValues: [eligible],
    });
    const nineResponse = await select({ mode: "manual", entryIds: eligible.slice(0, 9).map((e) => e.id) }, nine);
    expect(nineResponse.status).toBe(400);
    expect((await nineResponse.json()).error).toBe("Select exactly 8 participants.");

    // An ineligible (removed/blocked/foreign) id → 400.
    const bad = deps({
      oneValues: [TOURNAMENT],
      txOneValues: [locked, { count: 0 }],
      txQueryValues: [eligible],
    });
    const badResponse = await select({ mode: "manual", entryIds: [...ids.slice(0, 7), "entry-foreign"] }, bad);
    expect(badResponse.status).toBe(400);
    expect((await badResponse.json()).error).toBe("One or more selected entries are not eligible.");

    // Duplicate ids → 400.
    const dup = deps({
      oneValues: [TOURNAMENT],
      txOneValues: [locked, { count: 0 }],
      txQueryValues: [eligible],
    });
    const dupResponse = await select({ mode: "manual", entryIds: [ids[0], ids[0], ...ids.slice(1, 7)] }, dup);
    expect(dupResponse.status).toBe(400);
    expect((await dupResponse.json()).error).toBe("Duplicate entry IDs.");
  });

  it("rejects an unsupported selection mode before touching anything", async () => {
    const d = deps({ oneValues: [TOURNAMENT] });
    const response = await handleSelectTournamentEntries(
      request("/api/tournaments/tournament-1/entries/select", { mode: "manul" }),
      {},
      d
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Unsupported selection mode.");
    expect(d.withTransaction.mock.calls).toHaveLength(0);
  });

  it("selects every eligible player when they all fit the bracket", async () => {
    const locked = { ...TOURNAMENT, bracket_size: 8, signup_state: "locked", entry_fee: 0 };
    const eligible = [
      { id: "e1", display_name: "BYE" }, // a real player named BYE is eligible
      ...Array.from({ length: 4 }, (_, i) => ({ id: `e${i + 2}`, display_name: `P${i + 2}` })),
    ];
    const d = deps({
      oneValues: [TOURNAMENT],
      txOneValues: [locked, { count: 0 }],
      txQueryValues: [eligible, eligible.map((e) => ({ ...e, status: "selected" }))],
    });
    const response = await handleSelectTournamentEntries(
      request("/api/tournaments/tournament-1/entries/select", { mode: "random" }),
      {},
      d
    );
    expect(response.status).toBe(200);
    const updateCall = d._mocks.txQuery.mock.calls.find(([sql]) => String(sql).includes("status='selected'"));
    expect(updateCall[1][0].sort()).toEqual(eligible.map((e) => e.id).sort());
  });

  it("refuses manual selection when every eligible player fits the bracket", async () => {
    const locked = { ...TOURNAMENT, bracket_size: 8, signup_state: "locked", entry_fee: 0 };
    const eligible = Array.from({ length: 5 }, (_, i) => ({ id: `e${i + 1}`, display_name: `P${i + 1}` }));
    const d = deps({
      oneValues: [TOURNAMENT],
      txOneValues: [locked, { count: 0 }],
      txQueryValues: [eligible],
    });
    const response = await handleSelectTournamentEntries(
      request("/api/tournaments/tournament-1/entries/select", { mode: "manual", entryIds: ["e1", "e2"] }),
      {},
      d
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("All eligible players fit the bracket; use random selection.");
    const updates = d._mocks.txQuery.mock.calls.filter(([sql]) => String(sql).includes("status='selected'"));
    expect(updates).toHaveLength(0);
  });

  it("rejects lowering the signup limit below active registrations", async () => {
    const d = deps({
      oneValues: [TOURNAMENT],
      txOneValues: [
        { id: TOURNAMENT.id, signup_state: "locked", entry_cap: null, status: "draft" },
        { count: 20 },
      ],
    });
    const response = await handleUpdateTournamentSettings(
      request("/api/tournaments/tournament-1/settings", { entryCap: 10 }),
      {},
      d
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Signup limit cannot be lower than the current 20 registrations.");
  });

  it("allows a signup limit below the bracket size", async () => {
    const stored = { ...TOURNAMENT, bracket_size: 8, signup_state: "locked" };
    const updated = { ...stored, entry_cap: 4 };
    const d = deps({
      oneValues: [stored],
      txOneValues: [
        { id: stored.id, signup_state: "locked", entry_cap: null, status: "draft" },
        { count: 2 },
        updated,
      ],
    });
    const response = await handleUpdateTournamentSettings(
      request("/api/tournaments/tournament-1/settings", { entryCap: 4 }),
      {},
      d
    );
    expect(response.status).toBe(200);
    expect((await response.json()).tournament.entry_cap).toBe(4);
  });

  it("locks signups when the new cap is already reached on an open tournament", async () => {
    const stored = { ...TOURNAMENT, bracket_size: 8, signup_state: "open" };
    const applied = { ...stored, entry_cap: 4 };
    const lockedRow = { ...applied, signup_state: "locked" };
    const d = deps({
      oneValues: [stored],
      txOneValues: [
        { id: stored.id, signup_state: "open", entry_cap: null, status: "draft" },
        { count: 4 },
        applied,
        lockedRow,
      ],
    });
    const unsafe = mock(async () => []);
    d.withTransaction = mock(async (fn) => fn({ one: d._mocks.txOne, query: d._mocks.txQuery, unsafe }));
    const response = await handleUpdateTournamentSettings(
      request("/api/tournaments/tournament-1/settings", { entryCap: 4 }),
      {},
      d
    );
    expect(response.status).toBe(200);
    const { tournament } = await response.json();
    expect(tournament.signup_state).toBe("locked");
    expect(tournament.entry_cap).toBe(4);
    const txSql = d._mocks.txOne.mock.calls.map(([sql]) => String(sql));
    expect(txSql.some((sql) => sql.includes("FOR UPDATE"))).toBe(true);
    expect(txSql.some((sql) => sql.includes("signup_state='locked'"))).toBe(true);
    const unsafeSql = unsafe.mock.calls.map(([sql]) => String(sql));
    expect(unsafeSql.some((sql) => sql.includes("DELETE FROM tournament_open_signups"))).toBe(true);
  });
});

describe("tournament lifecycle foundation", () => {
  function createDeps(txOne) {
    const txUnsafe = mock(async () => []);
    return {
      txUnsafe,
      deps: {
        requireUser: mock(async () => ({ user: USER, res: null })),
        getBoardById: mock(async () => ({ id: "site-1", user_id: USER.id })),
        one: mock(async () => ({ plan: "pro", plan_expires_at: null, status: "active" })),
        requireSiteCapabilityImpl: mock(async () => ({ res: null })),
        withTransaction: mock(async (fn) => fn({ one: txOne, unsafe: txUnsafe })),
        logAudit: mock(async () => {}),
      },
    };
  }

  it("creates an entry-list tournament as a draft with the selected values and chat channel", async () => {
    const txOne = mock(async (sql, params) => ({ id: "tournament-1", status: params[13], bracket_size: params[3] }));
    const { deps: d, txUnsafe } = createDeps(txOne);
    const response = await handleCreateTournament(
      request("/api/tournaments", {
        siteId: "site-1",
        title: "Friday Cup",
        gameName: "Fortnite",
        format: "1v1",
        bracketSize: 4,
        entryCap: null,
        chatChannel: "https://kick.com/36_ates",
        entryKeyword: "!cup",
      }),
      {},
      d
    );
    expect(response.status).toBe(200);
    const [sql, params] = txOne.mock.calls[0];
    expect(sql).toContain("chat_channel");
    expect(params.slice(0, 4)).toEqual(["site-1", "Friday Cup", "Fortnite", 4]);
    expect(params[5]).toBeNull();
    expect(params[6]).toBe("1v1");
    expect(params[11]).toBe("!cup");
    expect(params[12]).toBe("36_ates");
    expect(params[13]).toBe("draft");
    expect(txUnsafe).not.toHaveBeenCalled();
  });

  it("keeps a tournament with explicit participants active and treats bracket size as separate from the signup cap", async () => {
    const txOne = mock(async (sql, params) => ({ id: "tournament-1", status: params[13] }));
    const { deps: d } = createDeps(txOne);
    const response = await handleCreateTournament(
      request("/api/tournaments", { siteId: "site-1", bracketSize: 8, entryCap: 40 }),
      {},
      d
    );
    expect(response.status).toBe(200);
    const [, params] = txOne.mock.calls[0];
    expect(params[3]).toBe(8);
    expect(params[5]).toBe(40);
    expect(params[13]).toBe("draft");

    const seeded = mock(async (sql, params) => ({ id: "tournament-2", status: params[13] }));
    const { deps: d2 } = createDeps(seeded);
    await handleCreateTournament(
      request("/api/tournaments", { siteId: "site-1", participants: ["A", "B", "C", "D"] }),
      {},
      d2
    );
    expect(seeded.mock.calls[0][1][13]).toBe("active");
  });

  it("rejects an unsupported bracket size instead of falling back", async () => {
    const txOne = mock(async (sql, params) => ({ id: "tournament-1", bracket_size: params[3] }));
    const { deps: d } = createDeps(txOne);
    const response = await handleCreateTournament(request("/api/tournaments", { siteId: "site-1", bracketSize: 6 }), {}, d);
    expect(response.status).toBe(400);
    expect(txOne).not.toHaveBeenCalled();

    const defaultTxOne = mock(async (sql, params) => ({ id: "tournament-2", bracket_size: params[3] }));
    const { deps: defaults } = createDeps(defaultTxOne);
    const okResponse = await handleCreateTournament(request("/api/tournaments", { siteId: "site-1" }), {}, defaults);
    expect(okResponse.status).toBe(200);
    expect(defaultTxOne.mock.calls[0][1][3]).toBe(8);
  });

  it("rejects formats that cannot be created", async () => {
    for (const format of ["2v2", "swiss"]) {
      const txOne = mock(async () => ({ id: "tournament-1" }));
      const { deps: d } = createDeps(txOne);
      const response = await handleCreateTournament(
        request("/api/tournaments", { siteId: "site-1", format }),
        {},
        d
      );
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain("Unsupported tournament format.");
      expect(txOne).not.toHaveBeenCalled();
    }

    const draft = { ...TOURNAMENT, status: "draft", signup_state: "closed", format: "bracket", bracket_size: 8 };
    const settings = deps({ oneValues: [draft, { entries: 0, matches: 0 }] });
    const settingsResponse = await handleUpdateTournamentSettings(
      request("/api/tournaments/tournament-1/settings", { format: "2v2" }),
      {},
      settings
    );
    expect(settingsResponse.status).toBe(400);
    expect((await settingsResponse.json()).error).toContain("Unsupported tournament format.");
  });

  it("marks the tournament active when the selection seeds the bracket", async () => {
    const picked = [
      { id: "entry-1", display_name: "Alice" },
      { id: "entry-2", display_name: "Bob" },
      { id: "entry-3", display_name: "Carol" },
      { id: "entry-4", display_name: "Dave" },
    ];
    const d = deps({
      oneValues: [{ ...TOURNAMENT, signup_state: "locked" }],
      txOneValues: [
        { id: TOURNAMENT.id, bracket_size: 4, format: "bracket", status: "draft", signup_state: "locked", entry_fee: 0 },
        { count: 0 },
      ],
      txQueryValues: [picked, picked],
    });
    const unsafe = mock(async () => []);
    d.withTransaction = mock(async (fn) => fn({ one: d._mocks.txOne, query: d._mocks.txQuery, unsafe }));
    const response = await handleSelectTournamentEntries(
      request("/api/tournaments/tournament-1/entries/select", { mode: "random" }),
      {},
      d
    );
    expect(response.status).toBe(200);
    const update = unsafe.mock.calls.find(([sql]) => String(sql).includes("UPDATE tournaments"));
    expect(update[0]).toContain("status='active'");
    expect(update[0]).not.toContain("bracket_size=");
    expect(update[1][0].slice().sort()).toEqual(["Alice", "Bob", "Carol", "Dave"]);
    expect(update[1][1]).toBe(TOURNAMENT.id);
    // Seeding uses the stored bracket size: a 4-player bracket is 3 matches.
    const inserts = unsafe.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO tournament_matches"));
    expect(inserts).toHaveLength(3);
  });

  it("requires locked signups and no existing bracket before selecting", async () => {
    const openPick = deps({
      oneValues: [TOURNAMENT],
      txOneValues: [{ id: TOURNAMENT.id, bracket_size: 4, status: "draft", signup_state: "open", entry_fee: 0 }],
    });
    const openResponse = await handleSelectTournamentEntries(
      request("/api/tournaments/tournament-1/entries/select", { mode: "random" }),
      {},
      openPick
    );
    expect(openResponse.status).toBe(409);
    expect((await openResponse.json()).error).toContain("Lock signups");

    const seededPick = deps({
      oneValues: [TOURNAMENT],
      txOneValues: [
        { id: TOURNAMENT.id, bracket_size: 4, status: "draft", signup_state: "locked", entry_fee: 0 },
        { count: 2 },
      ],
    });
    const seededResponse = await handleSelectTournamentEntries(
      request("/api/tournaments/tournament-1/entries/select", { mode: "random" }),
      {},
      seededPick
    );
    expect(seededResponse.status).toBe(409);
    expect((await seededResponse.json()).error).toContain("Bracket already exists");
  });

  it("changes format and bracket size only while nothing depends on them", async () => {
    const draft = { ...TOURNAMENT, status: "draft", signup_state: "closed", format: "bracket", bracket_size: 8 };
    const ok = deps({ oneValues: [draft, { entries: 0, matches: 0 }, { ...draft, format: "1v1", bracket_size: 4 }] });
    const okResponse = await handleUpdateTournamentSettings(
      request("/api/tournaments/tournament-1/settings", { format: "1v1", bracketSize: 4 }),
      {},
      ok
    );
    expect(okResponse.status).toBe(200);
    const [sql, params] = ok._mocks.one.mock.calls[3];
    expect(sql.split("RETURNING")[0]).toContain("bracket_size");
    expect(sql.split("RETURNING")[0]).toContain("format");
    expect(params).toEqual([4, "1v1", TOURNAMENT.id]);

    const withEntries = deps({ oneValues: [{ ...draft, signup_state: "open" }, { entries: 3, matches: 0 }] });
    const formatResponse = await handleUpdateTournamentSettings(
      request("/api/tournaments/tournament-1/settings", { format: "2v2" }),
      {},
      withEntries
    );
    expect(formatResponse.status).toBe(409);
    expect((await formatResponse.json()).error).toContain("Format is locked");

    const sizeStillOpen = deps({ oneValues: [{ ...draft, signup_state: "open" }, { entries: 3, matches: 0 }, { ...draft, bracket_size: 16 }] });
    const sizeResponse = await handleUpdateTournamentSettings(
      request("/api/tournaments/tournament-1/settings", { bracketSize: 16 }),
      {},
      sizeStillOpen
    );
    expect(sizeResponse.status).toBe(200);

    const seeded = deps({ oneValues: [{ ...draft, status: "active", signup_state: "locked" }, { entries: 8, matches: 7 }] });
    const lockedResponse = await handleUpdateTournamentSettings(
      request("/api/tournaments/tournament-1/settings", { bracketSize: 4 }),
      {},
      seeded
    );
    expect(lockedResponse.status).toBe(409);
    expect((await lockedResponse.json()).error).toContain("Bracket size is locked");

    const unsupported = deps({ oneValues: [draft, { entries: 0, matches: 0 }] });
    const unsupportedResponse = await handleUpdateTournamentSettings(
      request("/api/tournaments/tournament-1/settings", { bracketSize: 6 }),
      {},
      unsupported
    );
    expect(unsupportedResponse.status).toBe(400);
  });

  it("treats legacy active/no-bracket tournaments as unlocked for bracket size and format", async () => {
    // Legacy rows predate the draft state: status='active' with signups closed
    // and zero matches never had a bracket, so neither field may be locked.
    const legacy = { ...TOURNAMENT, status: "active", signup_state: "closed", bracket_size: 8, format: "bracket" };

    const resized = deps({ oneValues: [legacy, { entries: 0, matches: 0 }, { ...legacy, bracket_size: 16 }] });
    const resizedResponse = await handleUpdateTournamentSettings(
      request("/api/tournaments/tournament-1/settings", { bracketSize: 16 }),
      {},
      resized
    );
    expect(resizedResponse.status).toBe(200);
    const [resizeSql] = resized._mocks.one.mock.calls[3];
    expect(resizeSql.split("RETURNING")[0]).toContain("bracket_size");

    const reformatted = deps({ oneValues: [legacy, { entries: 0, matches: 0 }, { ...legacy, format: "1v1" }] });
    const formatResponse = await handleUpdateTournamentSettings(
      request("/api/tournaments/tournament-1/settings", { format: "1v1" }),
      {},
      reformatted
    );
    expect(formatResponse.status).toBe(200);

    const withMatches = deps({ oneValues: [legacy, { entries: 8, matches: 7 }] });
    const matchedResponse = await handleUpdateTournamentSettings(
      request("/api/tournaments/tournament-1/settings", { bracketSize: 16 }),
      {},
      withMatches
    );
    expect(matchedResponse.status).toBe(409);

    const finished = deps({ oneValues: [{ ...legacy, status: "completed" }, { entries: 0, matches: 0 }] });
    const finishedResponse = await handleUpdateTournamentSettings(
      request("/api/tournaments/tournament-1/settings", { bracketSize: 16 }),
      {},
      finished
    );
    expect(finishedResponse.status).toBe(409);
  });
});
