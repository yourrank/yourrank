import { describe, expect, it, mock } from "bun:test";
import {
  handleAddTournamentEntry,
  handleBlockTournamentEntry,
  handleCreateTournament,
  handleOpenTournamentSignups,
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
  const one = mock(async () => oneValues.shift());
  const query = mock(async () => queryValues.shift() || []);
  const txOne = mock(async () => txOneValues.shift());
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
  it("opens signups and records the state transition", async () => {
    const d = deps({
      oneValues: [TOURNAMENT, { id: TOURNAMENT.id, signup_state: "open" }],
    });
    const response = await handleOpenTournamentSignups(request("/api/tournaments/tournament-1/signups/open"), {}, d);
    expect(response.status).toBe(200);
    expect((await response.json()).tournament.signup_state).toBe("open");
    expect(d.requireSiteCapabilityImpl).toHaveBeenCalled();
  });

  it("refuses to open signups until a chat channel is stored", async () => {
    const d = deps({ oneValues: [{ ...TOURNAMENT, chat_channel: null }] });
    const response = await handleOpenTournamentSignups(request("/api/tournaments/tournament-1/signups/open"), {}, d);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("Kick channel");
    // No state transition may happen: only the access lookup ran.
    expect(d._mocks.one).toHaveBeenCalledTimes(1);
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
    const update = d._mocks.one.mock.calls[1];
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
    expect(second._mocks.txOne).toHaveBeenCalledTimes(5);
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

  it("keeps a hand-added entry pending while signups are closed", async () => {
    const d = deps({
      oneValues: [TOURNAMENT],
      txOneValues: [
        { id: TOURNAMENT.id, signup_state: "closed", entry_cap: null },
        undefined,
        { count: 0 },
        { id: "entry-1", tournament_id: TOURNAMENT.id, display_name: "ManualName", status: "pending" },
      ],
    });
    const response = await handleAddTournamentEntry(
      request("/api/tournaments/tournament-1/entries", { displayName: "ManualName", source: "manual" }),
      {},
      d
    );
    expect(response.status).toBe(200);
    expect((await response.json()).entry.status).toBe("pending");
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
      txOneValues: [{ ...TOURNAMENT, bracket_size: 4 }, { count: 4 }],
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
    const [sql, params] = d._mocks.one.mock.calls[1];
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
      one: mock(async () => TOURNAMENT),
      withTransaction: mock(async (fn) => fn({
        one: mock(async () => (++oneCall === 1 ? { ...TOURNAMENT, bracket_size: 4 } : { count: 4 })),
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
    expect(unsafeSQL).toContain("DELETE FROM tournament_matches");
    expect(unsafeSQL).toContain("INSERT INTO tournament_matches");
  });
});
