import { describe, expect, it, mock } from "bun:test";
import {
  handleAddTournamentEntry,
  handleBlockTournamentEntry,
  handleCreateTournament,
  handleOpenTournamentSignups,
  handleLockTournamentSignups,
  handleRandomPickTournamentEntries,
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

  it("puts entries on the waitlist and locks at the cap", async () => {
    const first = deps({
      oneValues: [TOURNAMENT],
      txOneValues: [
        { id: TOURNAMENT.id, signup_state: "open", entry_cap: 1 },
        undefined,
        { count: 0 },
        { id: "entry-1", tournament_id: TOURNAMENT.id, display_name: "Alice", status: "pending" },
      ],
    });
    const firstResponse = await handleAddTournamentEntry(
      request("/api/tournaments/tournament-1/entries", { displayName: "Alice", source: "chat" }),
      {},
      first
    );
    expect(firstResponse.status).toBe(200);
    expect((await firstResponse.json()).entry.status).toBe("pending");

    const second = deps({
      oneValues: [TOURNAMENT],
      txOneValues: [
        { id: TOURNAMENT.id, signup_state: "open", entry_cap: 1 },
        undefined,
        { count: 1 },
        { id: "tournament-1" },
        { site_id: "site-1" }, // lock-row delete after the auto-lock
        { id: "entry-2", tournament_id: TOURNAMENT.id, display_name: "Bob", status: "waitlist" },
      ],
    });
    const secondResponse = await handleAddTournamentEntry(
      request("/api/tournaments/tournament-1/entries", { displayName: "Bob", source: "chat" }),
      {},
      second
    );
    expect(secondResponse.status).toBe(200);
    expect((await secondResponse.json()).entry.status).toBe("waitlist");
    expect(second._mocks.txOne).toHaveBeenCalledTimes(6);
    // The auto-lock also releases the site's open-signups row.
    expect(second._mocks.txOne.mock.calls.some(([sql]) => String(sql).includes("DELETE FROM tournament_open_signups"))).toBe(true);
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
    const picked = [
      { id: "entry-1", display_name: "Alice" },
      { id: "entry-2", display_name: "Bob" },
      { id: "entry-3", display_name: "Carol" },
      { id: "entry-4", display_name: "Dave" },
    ];
    const selected = picked.map((entry) => ({ ...entry, status: "selected" }));
    const d = deps({
      oneValues: [TOURNAMENT],
      txOneValues: [{ ...TOURNAMENT, bracket_size: 4, signup_state: "locked" }, { count: 0 }, { count: 4 }],
      txQueryValues: [picked, selected],
    });
    const response = await handleRandomPickTournamentEntries(
      request("/api/tournaments/tournament-1/entries/random-pick", { count: 4 }),
      {},
      d
    );
    expect(response.status).toBe(200);
    const entries = (await response.json()).entries;
    expect(entries).toHaveLength(4);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(4);
    expect(d._mocks.txQuery.mock.calls[0][0]).toContain("ORDER BY random()");
    expect(d._mocks.txQuery.mock.calls[0][0]).toContain("action='people_review_allow'");
    expect(d._mocks.txQuery.mock.calls[0][0]).toContain("entity_id=tournament_entries.id::text");
    expect(d._mocks.txQuery.mock.calls[0][1]).toEqual([TOURNAMENT.id, 4, true]);
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

  it("seeds the bracket when entries are randomly picked", async () => {
    const picked = [
      { id: "entry-1", display_name: "Alice" },
      { id: "entry-2", display_name: "Bob" },
      { id: "entry-3", display_name: "Carol" },
      { id: "entry-4", display_name: "Dave" },
    ];
    const selected = picked.map((entry) => ({ ...entry, status: "selected" }));
    const txUnsafe = mock(async () => []);
    let oneCall = 0;
    let queryCall = 0;
    const d = {
      requireUser: mock(async () => ({ user: USER, res: null })),
      one: mock(async (sql) => String(sql).includes("FROM users")
        ? { plan: "pro", plan_expires_at: null, status: "active" }
        : TOURNAMENT),
      withTransaction: mock(async (fn) => fn({
        one: mock(async () => (++oneCall === 1 ? { ...TOURNAMENT, bracket_size: 4, signup_state: "locked" } : { count: oneCall === 2 ? 0 : 4 })),
        query: mock(async () => (++queryCall === 1 ? picked : selected)),
        unsafe: txUnsafe,
      })),
      logAudit: mock(async () => {}),
      requireSiteCapabilityImpl: mock(async () => ({ res: null })),
    };
    const response = await handleRandomPickTournamentEntries(
      request("/api/tournaments/tournament-1/entries/random-pick", { count: 4 }),
      {},
      d
    );
    expect(response.status).toBe(200);
    const unsafeSQL = txUnsafe.mock.calls.map((call) => call[0]).join(" ");
    expect(unsafeSQL).toContain("UPDATE tournaments SET participants_json");
    expect(unsafeSQL).not.toContain("bracket_size=");
    expect(unsafeSQL).toContain("INSERT INTO tournament_matches");
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

  it("marks the tournament active when the random pick seeds the bracket", async () => {
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
        { count: 4 },
      ],
      txQueryValues: [picked, picked],
    });
    const unsafe = mock(async () => []);
    d.withTransaction = mock(async (fn) => fn({ one: d._mocks.txOne, query: d._mocks.txQuery, unsafe }));
    const response = await handleRandomPickTournamentEntries(
      request("/api/tournaments/tournament-1/entries/random-pick", { count: 4 }),
      {},
      d
    );
    expect(response.status).toBe(200);
    const update = unsafe.mock.calls.find(([sql]) => String(sql).includes("UPDATE tournaments"));
    expect(update[0]).toContain("status='active'");
    expect(update[0]).not.toContain("bracket_size=");
    expect(update[1]).toEqual([["Alice", "Bob", "Carol", "Dave"], TOURNAMENT.id]);
    // Seeding uses the stored bracket size: a 4-player bracket is 3 matches.
    const inserts = unsafe.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO tournament_matches"));
    expect(inserts).toHaveLength(3);
  });

  it("requires locked signups, no existing bracket, and a pick equal to the bracket size", async () => {
    const openPick = deps({
      oneValues: [TOURNAMENT],
      txOneValues: [{ id: TOURNAMENT.id, bracket_size: 4, status: "draft", signup_state: "open", entry_fee: 0 }],
    });
    const openResponse = await handleRandomPickTournamentEntries(
      request("/api/tournaments/tournament-1/entries/random-pick", { count: 4 }),
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
    const seededResponse = await handleRandomPickTournamentEntries(
      request("/api/tournaments/tournament-1/entries/random-pick", { count: 4 }),
      {},
      seededPick
    );
    expect(seededResponse.status).toBe(409);
    expect((await seededResponse.json()).error).toContain("Bracket already exists");

    const mismatch = deps({
      oneValues: [TOURNAMENT],
      txOneValues: [
        { id: TOURNAMENT.id, bracket_size: 8, status: "draft", signup_state: "locked", entry_fee: 0 },
        { count: 0 },
      ],
    });
    const mismatchResponse = await handleRandomPickTournamentEntries(
      request("/api/tournaments/tournament-1/entries/random-pick", { count: 4 }),
      {},
      mismatch
    );
    expect(mismatchResponse.status).toBe(400);
    expect((await mismatchResponse.json()).error).toContain("bracket size of 8");
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
