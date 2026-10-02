// Viewer-facing tournament surfaces: the sanitized public bracket shape, the
// /api/public/:slug/tournament handler, the public/stream page renderer and the
// champion chat announcement when the final is saved.
//
// Run: bun test src/__tests__/tournament-public.test.js

import { describe, expect, it, mock } from "bun:test";
import { publicTournamentView } from "../lib/tournament-public.js";
import { renderPublicTournamentPage, tournamentBodyHtml } from "../pages/tournament-public.js";
import { championAnnouncementText, joinConfirmationText } from "../lib/tournament-chat.js";
import {
  announceTournamentChampion,
  getPublicTournamentView,
  handlePublicTournament,
  handleUpdateMatchScore,
} from "../handlers/tournaments.js";
import { attachRouteContext } from "../middleware/handler.js";

const BYE = "__YOURRANK_INTERNAL_BYE__";
const tournament = (extra = {}) => ({
  id: "tourn-secret-id", title: "Friday Cup", game_name: "Rocket League", bracket_size: 8,
  status: "active", signup_state: "locked", winner_name: null, entry_keyword: "!join",
  chat_channel: "kickcup", entry_fee: 0, anti_alt_enabled: true, ...extra,
});
const m = (round_number, match_index, p1, p2, extra = {}) => ({
  id: `match-${round_number}-${match_index}`, tournament_id: "tourn-secret-id",
  round_number, match_index, player1_name: p1, player2_name: p2,
  player1_score: 0, player2_score: 0, winner_name: null, status: "pending", ...extra,
});
// Five players in an 8-slot bracket: three first-round BYEs.
const fivePlayerMatches = () => [
  m(1, 0, "Nova", "Kai", { status: "completed", player1_score: 2, player2_score: 1, winner_name: "Nova" }),
  m(1, 1, "Lux", BYE, { status: "completed", winner_name: "Lux" }),
  m(1, 2, "Zed", BYE, { status: "completed", winner_name: "Zed" }),
  m(1, 3, "Ivy", BYE, { status: "completed", winner_name: "Ivy" }),
  m(2, 0, "Nova", "Lux"),
  m(2, 1, "Zed", "Ivy"),
  m(3, 0, "TBD", "TBD"),
];

describe("publicTournamentView", () => {
  it("exposes only names, rounds, scores, status and champion", () => {
    const view = publicTournamentView(tournament(), fivePlayerMatches(), { entryCount: 5 });
    const raw = JSON.stringify(view);
    for (const secret of ["tourn-secret-id", "match-", BYE, "entry_fee", "anti_alt", "TBD"]) {
      expect(raw).not.toContain(secret);
    }
    expect(view.status).toBe("live");
    expect(view.rounds.map((r) => r.label)).toEqual(["Quarterfinals", "Semifinals", "Final"]);
    expect(view.rounds[0].matches[0]).toEqual({
      state: "done",
      live: false,
      players: [
        { name: "Nova", bye: false, score: 2, winner: true },
        { name: "Kai", bye: false, score: 1, winner: false },
      ],
    });
    expect(view.rounds[0].matches[1].state).toBe("bye");
    expect(view.rounds[0].matches[1].players[1]).toEqual({ name: null, bye: true, score: null, winner: false });
    expect(view.rounds[2].matches[0].players).toEqual([
      { name: null, bye: false, score: null, winner: false },
      { name: null, bye: false, score: null, winner: false },
    ]);
    expect(view.champion).toBeNull();
    expect(view.joinCommand).toBeNull();
  });

  it("marks exactly the first ready match as live", () => {
    const view = publicTournamentView(tournament(), fivePlayerMatches());
    const live = view.rounds.flatMap((r) => r.matches).filter((x) => x.live);
    expect(live).toHaveLength(1);
    expect(live[0].players.map((p) => p.name)).toEqual(["Nova", "Lux"]);
  });

  it("names the champion, runner-up and final score once finished", () => {
    const matches = fivePlayerMatches();
    matches[6] = m(3, 0, "Nova", "Zed", { status: "completed", player1_score: 1, player2_score: 3, winner_name: "Zed" });
    const view = publicTournamentView(tournament({ status: "completed", winner_name: "Zed" }), matches);
    expect(view).toMatchObject({ status: "finished", champion: "Zed", runnerUp: "Nova", finalScore: "3–1" });
  });

  it("shows the join command only while signups are open", () => {
    const view = publicTournamentView(tournament({ status: "draft", signup_state: "open" }), [], { entryCount: 3 });
    expect(view).toMatchObject({ status: "signups", joinCommand: "!join", chatChannel: "kickcup", entryCount: 3, rounds: [] });
  });
});

describe("GET /api/public/:slug/tournament", () => {
  const site = { id: "site-1", plan: "pro", data: {} };
  const call = (slug, deps) => handlePublicTournament(
    attachRouteContext(new Request(`http://localhost/api/public/${slug}/tournament`), { slug }),
    {},
    { rateLimit: async () => ({ ok: true }), clientIp: () => "1.1.1.1", ...deps },
  );

  it("returns the sanitized current tournament", async () => {
    const one = mock(async (sql) => (String(sql).includes("FROM tournaments") ? tournament() : { entries: 5 }));
    const query = mock(async () => fivePlayerMatches());
    const res = await call("kickcup", { getPublicSite: async () => site, one, query });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.tournament.title).toBe("Friday Cup");
    expect(body.tournament.entryCount).toBe(5);
    expect(JSON.stringify(body)).not.toContain("tourn-secret-id");
    expect(one.mock.calls[0][1]).toEqual(["site-1"]);
    expect(String(one.mock.calls[0][0])).not.toContain("entry_fee");
  });

  it("answers null when the site has no public tournament", async () => {
    const res = await call("kickcup", { getPublicSite: async () => site, one: async () => null, query: async () => [] });
    expect(await res.json()).toEqual({ ok: true, tournament: null });
  });

  it("answers null without querying when the plan lacks tournaments", async () => {
    const one = mock(async () => tournament());
    expect(await getPublicTournamentView({ id: "site-1", plan: "free" }, { one, query: async () => [] })).toBeNull();
    expect(one).not.toHaveBeenCalled();
  });

  it("404s unknown or suspended sites and 401s password-protected ones", async () => {
    expect((await call("nope", { getPublicSite: async () => null })).status).toBe(404);
    expect((await call("gone", { getPublicSite: async () => ({ suspended: true }) })).status).toBe(404);
    expect((await call("locked", { getPublicSite: async () => ({ requiresPassword: true, id: "site-1" }) })).status).toBe(401);
  });

  it("rate limits per client", async () => {
    const res = await call("kickcup", { rateLimit: async () => ({ ok: false }), getPublicSite: async () => site });
    expect(res.status).toBe(429);
  });
});

describe("public tournament page", () => {
  const view = publicTournamentView(tournament(), fivePlayerMatches(), { entryCount: 5 });

  it("renders rounds, the live match and escaped names", () => {
    const html = tournamentBodyHtml(
      publicTournamentView(tournament({ title: "<b>Cup</b>" }), [m(1, 0, "<img src=x>", "Kai")]),
      false,
    );
    expect(html).toContain("&lt;b&gt;Cup&lt;/b&gt;");
    expect(html).toContain("&lt;img src=x&gt;");
    expect(html).not.toContain("<img");
    expect(html).toContain("Live now");
  });

  it("serves a nonce'd page that refreshes from the public API", () => {
    const html = renderPublicTournamentPage({ view, slug: "kickcup", siteName: "Kick Cup", nonce: "n0nce" });
    expect(html).toContain('<script nonce="n0nce">');
    expect(html).toContain('<style nonce="n0nce">');
    expect(html).toContain("/api/public/kickcup/tournament");
    expect(html).toContain('href="/kickcup"');
    expect(html).toContain("Quarterfinals");
    expect(html).not.toContain('class="tp-stream"');
  });

  it("swaps in the server-rendered bracket when the public API reports a change", async () => {
    const html = renderPublicTournamentPage({ view, slug: "kickcup", siteName: "Kick Cup", nonce: "n" });
    const script = html.slice(html.indexOf('<script nonce="n">') + '<script nonce="n">'.length, html.lastIndexOf("</script>"));
    // The inline client must be standalone: bundlers rewrite server functions
    // (e.g. esbuild keepNames adds __name), so none are serialized into it.
    expect(script).not.toContain("tournamentBodyHtml");
    expect(script).not.toContain("__name");
    const root = { innerHTML: "old" };
    let tick = null;
    let current = view;
    const fetched = [];
    const fetchStub = async (url) => {
      fetched.push(url);
      if (url === "/api/public/kickcup/tournament") return { ok: true, json: async () => ({ ok: true, tournament: current }) };
      return { ok: true, text: async () => "<html><div id=\"tp-root\">fresh</div></html>" };
    };
    class DOMParserStub {
      parseFromString(text) {
        return { getElementById: () => ({ innerHTML: /<div id="tp-root">(.*?)<\/div>/.exec(text)[1] }) };
      }
    }
    new Function("document", "fetch", "setInterval", "DOMParser", "location", script)(
      { getElementById: () => root },
      fetchStub,
      (fn) => { tick = fn; },
      DOMParserStub,
      { pathname: "/kickcup/tournament" },
    );
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    tick();
    for (let i = 0; i < 5; i += 1) await settle();
    expect(fetched).toEqual(["/api/public/kickcup/tournament"]);
    expect(root.innerHTML).toBe("old");
    current = { ...view, status: "finished", champion: "Alice" };
    tick();
    for (let i = 0; i < 5; i += 1) await settle();
    expect(fetched.slice(1)).toEqual(["/api/public/kickcup/tournament", "/kickcup/tournament"]);
    expect(root.innerHTML).toBe("fresh");
  });

  it("renders the stream variant without site navigation on a transparent page", () => {
    const html = renderPublicTournamentPage({ view, slug: "kickcup", siteName: "Kick Cup", nonce: "n", stream: true });
    expect(html).toContain('<body class="tp-stream">');
    expect(html).not.toContain('class="tp-nav"');
  });

  it("shows the champion card and an empty state", () => {
    const matches = fivePlayerMatches();
    matches[6] = m(3, 0, "Nova", "Zed", { status: "completed", player1_score: 2, player2_score: 0, winner_name: "Nova" });
    const done = tournamentBodyHtml(publicTournamentView(tournament({ status: "completed", winner_name: "Nova" }), matches), false);
    expect(done).toContain('aria-label="Champion"');
    expect(done).toContain("Beat Zed 2–0 in the final");
    expect(tournamentBodyHtml(null, false)).toContain("No tournament right now");
  });
});

describe("chat copy", () => {
  it("confirms a single join and batches the throttled ones", () => {
    expect(joinConfirmationText({ senderUsername: "nova", title: "Friday Cup", playerCount: 1 }))
      .toBe("@nova You're in for Friday Cup! 1 player so far.");
    expect(joinConfirmationText({ senderUsername: "nova", title: "Friday Cup", others: ["kai"], othersTotal: 1, playerCount: 2 }))
      .toBe("@nova You're in for Friday Cup, along with kai. 2 players so far.");
    expect(joinConfirmationText({ senderUsername: "nova", title: "", others: ["kai", "lux", "zed"], othersTotal: 8, playerCount: 12 }))
      .toBe("@nova You're in, along with kai, lux, zed and 5 others. 12 players so far.");
  });

  it("announces the champion with or without scores", () => {
    expect(championAnnouncementText({ title: "Friday Cup", champion: "Nova", runnerUp: "Zed", scores: [2, 1] }))
      .toBe("🏆 Nova is the champion of Friday Cup! Final: Nova 2–1 Zed. GG everyone.");
    expect(championAnnouncementText({ title: "", champion: "Nova", runnerUp: "Zed", scores: null }))
      .toBe("🏆 Nova is the champion! They beat Zed in the final. GG everyone.");
  });
});

describe("champion announcement", () => {
  const finalMatch = (extra = {}) => ({
    id: "final", round_number: 2, match_index: 0, player1_name: "Nova", player2_name: "Zed", status: "pending",
    tournament_id: "tourn-1", tournament_status: "active", bracket_size: 4, site_id: "site-1",
    site_user_id: "owner-1", tournament_title: "Friday Cup", chat_channel: "kickcup", ...extra,
  });
  const scoreFinal = async (match, body, announceChampion = mock(async () => true)) => {
    const tx = {
      one: async (sql) => (String(sql).includes("FROM users") ? { plan: "pro", plan_expires_at: null, status: "active" } : match),
      unsafe: async () => [{ id: "x" }],
      query: async () => [],
    };
    const res = await handleUpdateMatchScore(
      new Request("http://localhost/api/tournaments/tourn-1/score", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ matchId: "final", ...body }),
      }),
      {},
      {
        requireUser: async () => ({ user: { id: "owner-1" }, res: null }),
        withTransaction: async (fn) => fn(tx),
        logAudit: async () => {},
        requireSiteCapabilityImpl: async () => ({ res: null }),
        announceChampion,
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { res, announceChampion };
  };

  it("announces the champion in chat when the final is saved", async () => {
    const { res, announceChampion } = await scoreFinal(finalMatch(), { player1Score: 1, player2Score: 3 });
    expect(res.status).toBe(200);
    expect(announceChampion).toHaveBeenCalledTimes(1);
    expect(announceChampion.mock.calls[0][1]).toEqual({
      tournamentId: "tourn-1", ownerUserId: "owner-1", title: "Friday Cup",
      champion: "Zed", runnerUp: "Nova", scores: [3, 1],
    });
  });

  it("omits scores for a winner-only result and skips tournaments without chat signup", async () => {
    const picked = await scoreFinal(finalMatch(), { winnerSlot: 1 });
    expect(picked.announceChampion.mock.calls[0][1].scores).toBeNull();
    const noChat = await scoreFinal(finalMatch({ chat_channel: null }), { player1Score: 2, player2Score: 0 });
    expect(noChat.res.status).toBe(200);
    expect(noChat.announceChampion).not.toHaveBeenCalled();
  });

  it("keeps the score response successful when the announcement fails", async () => {
    const errorSpy = mock(() => {});
    const realError = console.error;
    console.error = errorSpy;
    try {
      const { res } = await scoreFinal(finalMatch(), { player1Score: 2, player2Score: 0 }, mock(async () => { throw new Error("boom"); }));
      expect(res.status).toBe(200);
      const events = errorSpy.mock.calls.map(([line]) => JSON.parse(String(line)).event);
      expect(events).toContain("tournament_champion_announce_failed");
    } finally {
      console.error = realError;
    }
  });

  it("sends once per minute per tournament", async () => {
    const send = mock(async () => true);
    const announcement = { tournamentId: "tourn-1", ownerUserId: "owner-1", title: "Cup", champion: "Nova", runnerUp: "Zed", scores: [2, 0] };
    expect(await announceTournamentChampion({}, announcement, { rateLimit: async () => ({ ok: true }), send })).toBe(true);
    expect(send.mock.calls[0][1]).toEqual({
      tournamentId: "tourn-1", ownerUserId: "owner-1",
      content: "🏆 Nova is the champion of Cup! Final: Nova 2–0 Zed. GG everyone.",
    });
    expect(await announceTournamentChampion({}, announcement, { rateLimit: async () => ({ ok: false }), send })).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
