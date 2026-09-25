// Tournament signup hard-cap and undersubscribed-bracket behavior against a
// real migrated Postgres: concurrent entrants race for the last slot under
// the tournament row lock, bracket selection seeds BYE auto-advance, and a
// scored match resolves a downstream BYE. Connects as the superuser so the
// seeded schema is fully exercised. Skips when TOURNAMENT_TEST_DATABASE_URL
// (or AUDIT_TEST_DATABASE_URL) is unset.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import {
  addTournamentEntryTx,
  handleSelectTournamentEntries,
  handleUpdateMatchScore,
} from "../handlers/tournaments.js";

const databaseUrl = process.env.TOURNAMENT_TEST_DATABASE_URL || process.env.AUDIT_TEST_DATABASE_URL || "";
const integrationIt = (name, fn) => (databaseUrl ? it : it.skip)(name, fn, 60000);
const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
let sql;

const USER = { id: crypto.randomUUID() };

// A withTransaction-compatible wrapper exposing the shape handlers expect.
const wrapTx = (tx) => ({
  one: (text, params) => tx.unsafe(text, params).then((rows) => rows[0]),
  query: (text, params) => tx.unsafe(text, params),
  unsafe: (text, params) => tx.unsafe(text, params),
});

const handlerDeps = () => ({
  requireUser: async () => ({ user: USER, res: null }),
  one: (text, params) => sql.unsafe(text, params).then((rows) => rows[0]),
  query: (text, params) => sql.unsafe(text, params),
  requireSiteCapabilityImpl: async () => ({ res: null }),
  withTransaction: (fn) => sql.begin((tx) => fn(wrapTx(tx))),
  logAudit: async () => {},
});

async function seedSite() {
  const ownerId = crypto.randomUUID();
  const siteId = crypto.randomUUID();
  await sql`INSERT INTO users (id, email, display_name, plan, plan_expires_at, status, email_verified)
    VALUES (${ownerId}, ${`cap-${siteId.slice(0, 8)}-${suffix}@yourrank.test`}, 'Cap owner', 'pro', now() + interval '1 day', 'active', true)`;
  await sql`INSERT INTO sites (id, user_id, slug, name, published, is_draft)
    VALUES (${siteId}, ${ownerId}, ${`cap-${siteId.slice(0, 8)}-${suffix}`}, 'Cap site', true, false)`;
  return siteId;
}

async function seedTournament(siteId, { bracketSize = 8, entryCap = null, signupState = "open" } = {}) {
  const [row] = await sql`INSERT INTO tournaments
      (site_id, title, bracket_size, signup_state, entry_cap, status)
    VALUES (${siteId}, 'Cap cup', ${bracketSize}, ${signupState}, ${entryCap}, 'draft')
    RETURNING id`;
  await sql`INSERT INTO tournament_open_signups (site_id, tournament_id)
    VALUES (${siteId}, ${row.id}) ON CONFLICT DO NOTHING`;
  return row.id;
}

const post = (path, body) => new Request(`https://yourrank.site${path}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}),
});

beforeAll(async () => {
  if (!databaseUrl) return;
  const parsed = new URL(databaseUrl);
  if (!["127.0.0.1", "localhost", "[::1]", "postgres"].includes(parsed.hostname) || !/test|e2e/.test(parsed.pathname)) {
    throw new Error("A disposable local test database is required");
  }
  sql = postgres(databaseUrl, { max: 4, prepare: false, onnotice: () => {} });
});

afterAll(async () => {
  if (!sql) return;
  await sql`DELETE FROM sites WHERE slug LIKE ${`cap-%-${suffix}`}`;
  await sql`DELETE FROM users WHERE email LIKE ${`cap-%-${suffix}@yourrank.test`}`;
  await sql.end({ timeout: 0 });
});

describe("tournament signup cap (Postgres)", () => {
  it("references the real handlers", () => {
    expect(typeof addTournamentEntryTx).toBe("function");
    expect(typeof handleSelectTournamentEntries).toBe("function");
  });

  integrationIt("two concurrent entrants race for the last slot: exactly one wins and signups lock", async () => {
    const siteId = await seedSite();
    const tournamentId = await seedTournament(siteId, { entryCap: 10, signupState: "open" });
    for (let i = 0; i < 9; i++) {
      await sql`INSERT INTO tournament_entries (tournament_id, display_name, source, status)
        VALUES (${tournamentId}, ${`seeded-${i}`}, 'chat', 'pending')`;
    }

    const outcomes = await Promise.allSettled([
      sql.begin((tx) => addTournamentEntryTx(wrapTx(tx), tournamentId, {
        displayName: "racer-a", viewerId: null, source: "chat", trustScore: null, altFlag: false, altReason: null,
      })),
      sql.begin((tx) => addTournamentEntryTx(wrapTx(tx), tournamentId, {
        displayName: "racer-b", viewerId: null, source: "chat", trustScore: null, altFlag: false, altReason: null,
      })),
    ]);
    const results = outcomes.map((o) => (o.status === "fulfilled" ? o.value : { error: o.reason?.message, status: 500 }));
    const wins = results.filter((r) => r.entry && !r.duplicate);
    // The loser either overflows the cap ("signups are full") or arrives
    // after the winner's lock fired ("signups are not open") — both are 409.
    const losses = results.filter((r) => r.status === 409 && !r.entry);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);

    const [tournament] = await sql`SELECT signup_state FROM tournaments WHERE id=${tournamentId}`;
    expect(tournament.signup_state).toBe("locked");
    const holders = await sql`SELECT count(*)::int AS n FROM tournament_open_signups WHERE tournament_id=${tournamentId}`;
    expect(holders[0].n).toBe(0);
    const entries = await sql`SELECT count(*)::int AS n FROM tournament_entries
      WHERE tournament_id=${tournamentId} AND status IN ('pending','confirmed','selected')`;
    expect(entries[0].n).toBe(10);
  });

  integrationIt("selects 2 of N eligible for an 8-cap bracket and crowns via the real final", async () => {
    const siteId = await seedSite();
    const tournamentId = await seedTournament(siteId, { bracketSize: 8, signupState: "locked" });
    for (const name of ["Alice", "Bob"]) {
      await sql`INSERT INTO tournament_entries (tournament_id, display_name, source, status)
        VALUES (${tournamentId}, ${name}, 'chat', 'pending')`;
    }

    const selected = await handleSelectTournamentEntries(
      post(`/api/tournaments/${tournamentId}/entries/select`, { mode: "random" }),
      {},
      handlerDeps()
    );
    expect(selected.status).toBe(200);
    expect((await selected.json()).entries).toHaveLength(2);

    const matches = await sql`SELECT round_number, match_index, player1_name, player2_name, status, winner_name
      FROM tournament_matches WHERE tournament_id=${tournamentId}
      ORDER BY round_number, match_index`;
    expect(matches).toHaveLength(7);
    const final = matches.find((m) => m.round_number === 3);
    expect(final.status).toBe("pending");
    expect([final.player1_name, final.player2_name].sort()).toEqual(["Alice", "Bob"]);
    expect(matches.every((m) => m.status === "pending" && m.player1_name !== "BYE" && m.player2_name !== "BYE" || m.status === "completed")).toBe(true);

    const scored = await handleUpdateMatchScore(
      post(`/api/tournaments/${tournamentId}/score`, { matchId: (await sql`SELECT id FROM tournament_matches WHERE tournament_id=${tournamentId} AND round_number=3`)[0].id, player1Score: 1, player2Score: 0 }),
      {},
      handlerDeps()
    );
    expect(scored.status).toBe(200);
    const [tournament] = await sql`SELECT status, winner_name FROM tournaments WHERE id=${tournamentId}`;
    expect(tournament.status).toBe("completed");
    expect(["Alice", "Bob"]).toContain(tournament.winner_name);
  });

  integrationIt("auto-advances a winner into a downstream BYE match after scoring", async () => {
    const siteId = await seedSite();
    const tournamentId = await seedTournament(siteId, { bracketSize: 8, signupState: "locked" });
    for (const name of ["P1", "P2", "P3"]) {
      await sql`INSERT INTO tournament_entries (tournament_id, display_name, source, status)
        VALUES (${tournamentId}, ${name}, 'chat', 'pending')`;
    }
    const selected = await handleSelectTournamentEntries(
      post(`/api/tournaments/${tournamentId}/entries/select`, { mode: "random" }),
      {},
      handlerDeps()
    );
    expect(selected.status).toBe(200);

    // 3 players in an 8-slot bracket: one real r1 match; its winner faces a
    // BYE in r2 and must auto-advance once scored.
    const [realMatch] = await sql`SELECT id, player1_name, player2_name FROM tournament_matches
      WHERE tournament_id=${tournamentId} AND status='pending' AND player1_name <> 'BYE' AND player2_name <> 'BYE'
        AND player1_name <> 'TBD' AND player2_name <> 'TBD'`;
    expect(realMatch).toBeTruthy();
    const scored = await handleUpdateMatchScore(
      post(`/api/tournaments/${tournamentId}/score`, { matchId: realMatch.id, player1Score: 2, player2Score: 1 }),
      {},
      handlerDeps()
    );
    expect(scored.status).toBe(200);

    // After scoring, no pending match may still contain a BYE.
    const pendingBye = await sql`SELECT count(*)::int AS n FROM tournament_matches
      WHERE tournament_id=${tournamentId} AND status='pending'
        AND (player1_name='BYE' OR player2_name='BYE')`;
    expect(pendingBye[0].n).toBe(0);
    const [tournament] = await sql`SELECT status FROM tournaments WHERE id=${tournamentId}`;
    expect(tournament.status).toBe("active");
  });
});
