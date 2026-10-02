import { afterAll, describe, expect, it } from "bun:test";
import { BYE, buildBracket } from "../lib/tournament-bracket.js";
import { Bracket, ChampionCard, buildRoundModel, finalResult, roundLabel } from "../react/pages/tournaments/bracket.tsx";
import {
  actAndFlush,
  clickReactTarget,
  createElement,
  createRoot,
  document,
  restoreTournamentDomGlobals,
} from "./tournament-react-utils.js";

const host = document.createElement("div");
host.className = "yr-react";
document.body.appendChild(host);
const root = createRoot(host);
let renderKey = 0;

const tournament = (over = {}) => ({ id: "t-1", bracket_size: 8, winner_name: null, status: "active", ...over });
const completed = (id, r, i, p1, p2, s1, s2, winner) =>
  ({ id, round_number: r, match_index: i, player1_name: p1, player2_name: p2, player1_score: s1, player2_score: s2, status: "completed", winner_name: winner });
const pending = (id, r, i, p1 = "TBD", p2 = "TBD") =>
  ({ id, round_number: r, match_index: i, player1_name: p1, player2_name: p2, player1_score: 0, player2_score: 0, status: "pending", winner_name: null });

async function render(args) {
  await actAndFlush(() => root.render(createElement(Bracket, {
    ...args,
    key: `bracket-${++renderKey}`,
    onScore() {},
  })));
  return host.querySelector(".tn-bracket");
}

afterAll(async () => {
  await actAndFlush(() => root.unmount());
  restoreTournamentDomGlobals();
});

describe("roundLabel", () => {
  it("names rounds by players remaining", () => {
    expect(roundLabel(2)).toBe("Final");
    expect(roundLabel(4)).toBe("Semifinals");
    expect(roundLabel(8)).toBe("Quarterfinals");
    expect(roundLabel(16)).toBe("Round of 16");
    expect(roundLabel(32)).toBe("Round of 32");
  });
});

describe("buildRoundModel", () => {
  for (const size of [4, 8, 16, 32]) {
    it(`builds ${Math.log2(size)} expected rounds for a ${size}-player bracket`, () => {
      const matches = buildBracket(["a", "b"], size);
      const model = buildRoundModel(matches, size);
      expect(model.totalRounds).toBe(Math.log2(size));
      expect(model.rounds).toHaveLength(Math.log2(size));
      model.rounds.forEach((round, i) => {
        const expected = size / 2 ** (i + 1);
        expect(round.expected).toBe(expected);
        expect(round.matches).toHaveLength(expected);
        expect(round.label).toBe(roundLabel(expected * 2));
      });
      expect(model.rounds.at(-1).label).toBe("Final");
      expect(model.rounds.at(-2).label).toBe("Semifinals");
      if (size >= 8) expect(model.rounds.at(-3).label).toBe("Quarterfinals");
    });
  }

  it("fills missing rounds and match slots with placeholders", () => {
    const model = buildRoundModel([completed("m1", 1, 0, "a", "b", 1, 0, "a")], 8);
    expect(model.totalRounds).toBe(3);
    expect(model.rounds[0].matches.filter((slot) => !slot.match)).toHaveLength(3);
    expect(model.rounds[1].matches.every((slot) => !slot.match)).toBe(true);
    expect(model.rounds[2].matches).toHaveLength(1);
  });

  it("keeps extra rounds and matches present in the data", () => {
    const model = buildRoundModel([completed("m1", 3, 0, "a", "b", 1, 0, "a")], 4);
    expect(model.totalRounds).toBe(3);
    expect(model.rounds[2].matches[0].match.id).toBe("m1");
    const fat = buildRoundModel([
      completed("m1", 1, 0, "a", "b", 1, 0, "a"),
      completed("m2", 1, 1, "c", "d", 1, 0, "c"),
      completed("m3", 1, 2, "e", "f", 1, 0, "e"),
    ], 4);
    expect(fat.rounds[0].matches).toHaveLength(3);
  });
});

describe("React bracket", () => {
  it("renders the same cards in embedded and expanded read-only modes", async () => {
    const matches = [
      pending("m1", 1, 0, "a", "b"),
      pending("m2", 1, 1, "c", "d"),
      ...buildBracket(["a", "b", "c", "d"], 8).filter((match) => match.round_number > 1),
    ];
    const args = { tournament: tournament(), matches, lifecycle: "live" };
    const embedded = await render({ ...args, mode: "embedded" });
    expect(embedded.dataset.mode).toBe("embedded");
    expect(embedded.querySelectorAll("input[data-score-player]").length).toBeGreaterThan(0);
    expect(embedded.querySelectorAll("[data-score-match]").length).toBeGreaterThan(0);
    const embeddedIds = [...embedded.querySelectorAll("[data-match-id]")].map((el) => el.dataset.matchId).sort();

    const expanded = await render({ ...args, mode: "expanded" });
    expect(expanded.dataset.mode).toBe("expanded");
    expect(expanded.querySelectorAll("input")).toHaveLength(0);
    expect(expanded.querySelectorAll("[data-score-match]")).toHaveLength(0);
    expect([...expanded.querySelectorAll("[data-match-id]")].map((el) => el.dataset.matchId).sort()).toEqual(embeddedIds);
    expect(expanded.querySelectorAll(".tn-round")).toHaveLength(embedded.querySelectorAll(".tn-round").length);
  });

  it("never leaks the BYE sentinel or per-match classes", async () => {
    const bracket = await render({
      tournament: tournament(),
      matches: buildBracket(["a", "b"], 8),
      lifecycle: "live",
    });
    expect(bracket.textContent).not.toContain(BYE);
    expect(bracket.outerHTML).not.toMatch(/match-\d|\.final\b/);
  });

  it("renders all five card states and the server-visible BYE note", async () => {
    const matches = [
      completed("m1", 1, 0, "a", "b", 2, 1, "a"),
      pending("m2", 1, 1, "c", "d"),
      pending("m3", 1, 2),
      pending("m4", 1, 3, "e", BYE),
      completed("m5", 1, 4, BYE, BYE, 0, 0, BYE),
    ];
    const bracket = await render({ tournament: tournament(), matches, lifecycle: "live" });
    for (const state of ["completed", "scorable", "future", "bye", "void", "waiting"]) {
      expect(bracket.querySelector(`[data-state="${state}"]`)).toBeTruthy();
    }
    expect(bracket.querySelector('[data-score-match="m2"]')).toBeTruthy();
    expect(bracket.querySelector(".tn-bye-tag")?.textContent).toBe("BYE");
    expect(bracket.querySelector("[data-bye-note]").textContent)
      .toBe("Fewer players than spots, so some players get a BYE and advance automatically.");
  });

  it("marks winners and reserves the champion treatment for the final", async () => {
    const matches = buildBracket(["a", "b"], 4);
    const final = matches.find((match) => match.round_number === 2);
    final.status = "completed";
    final.player1_name = "a";
    final.player2_name = "b";
    final.player1_score = 2;
    final.player2_score = 1;
    final.winner_name = "a";
    const bracket = await render({
      tournament: tournament({ bracket_size: 4, winner_name: "a", status: "completed" }),
      matches,
      lifecycle: "finished",
    });
    expect(bracket.querySelector(".is-champion")).toBeTruthy();
    expect(bracket.querySelectorAll(".tn-crown")).toHaveLength(1);
  });

  it("opens prefilled correction inputs on request and explains locked results", async () => {
    const correctable = { id: "m-1", round_number: 1, match_index: 0, player1_name: "a", player2_name: "b", player1_score: 2, player2_score: 1, winner_name: "a", status: "completed", correctable: true };
    const locked = { ...correctable, id: "m-2", match_index: 1, correctable: false };
    const bracket = await render({
      tournament: tournament({ bracket_size: 4 }),
      matches: [correctable, locked],
      lifecycle: "live",
    });
    const card = () => bracket.querySelector('[data-match-id="m-1"]');
    expect(card().dataset.correctable).toBe("true");
    expect(card().querySelector("input")).toBeNull();
    await clickReactTarget(card().querySelector("[data-correct-match]"));
    expect(card().dataset.scoreMode).toBe("correct");
    expect(card().dataset.saved).toBe("2,1");
    expect(card().querySelector('[data-score-player="1"]').value).toBe("2");
    expect(card().querySelector('[data-score-player="2"]').value).toBe("1");
    expect(card().querySelector(".tn-match-save").disabled).toBe(true);
    const lockedCard = bracket.querySelector('[data-match-id="m-2"]');
    expect(lockedCard.querySelector("[data-correct-match]")).toBeNull();
    expect(lockedCard.querySelector("[data-locked-note]").textContent)
      .toBe("Locked: a later match has been played. Correct that one first.");
    expect(bracket.querySelector('[data-score-match="m-2"]')).toBeNull();
  });

  it("summarises the champion, final score and runner-up", async () => {
    const final = completed("m3", 2, 0, "a", "b", 1, 3, "b");
    const done = tournament({ bracket_size: 4, winner_name: "b", status: "completed" });
    expect(finalResult(done, [final])).toEqual({ champion: "b", runnerUp: "a", score: "3–1" });
    expect(finalResult(tournament({ bracket_size: 4 }), [final])).toBeNull();
    expect(finalResult({ ...done, winner_name: "a" }, [completed("m3", 2, 0, "a", BYE, 0, 0, "a")]))
      .toEqual({ champion: "a", runnerUp: null, score: null });
    await actAndFlush(() => root.render(createElement(ChampionCard, { tournament: done, matches: [final], key: `champ-${++renderKey}` })));
    const card = host.querySelector(".tn-champion-card");
    expect(card.getAttribute("aria-label")).toBe("Champion");
    expect(card.querySelector("[data-champion-name]").textContent).toBe("b");
    expect(card.querySelector("[data-champion-score]").textContent).toBe("3–1");
    expect(card.querySelector("[data-runner-up]").textContent).toBe("a");
  });

  it("names the pending semifinal on a half-known final", async () => {
    const matches = [
      completed("m1", 1, 0, "a", "b", 2, 0, "a"),
      pending("m2", 1, 1, "c", "d"),
      pending("m3", 2, 0, "a", "TBD"),
    ];
    const bracket = await render({ tournament: tournament({ bracket_size: 4 }), matches, lifecycle: "live" });
    const final = bracket.querySelector('[data-match-id="m3"]');
    expect(final.dataset.state).toBe("waiting");
    expect(final.textContent).toContain("a");
    expect(final.textContent).toContain("Waiting for winner of Semifinal 2");
    const empty = await render({ tournament: tournament({ bracket_size: 4 }), matches: [pending("m1", 1, 0, "a", "b"), pending("m2", 1, 1, "c", "d"), pending("m3", 2, 0)], lifecycle: "live" });
    expect(empty.querySelector('[data-match-id="m3"]').textContent).toContain("Waiting for semifinalists");
  });

  it("highlights the live match and names what is up next", async () => {
    const matches = [pending("m1", 1, 0, "a", "b"), pending("m2", 1, 1, "c", "d"), pending("m3", 2, 0)];
    const bracket = await render({ tournament: tournament({ bracket_size: 4 }), matches, lifecycle: "live" });
    expect(bracket.querySelector("[data-now-match]").textContent).toBe("a vs b");
    expect(bracket.querySelector("[data-next-match]").textContent).toContain("c vs d");
    expect(bracket.querySelector('[data-match-id="m2"]').dataset.next).toBe("true");
  });


  it("marks exactly one live match and only while live", async () => {
    const matches = [pending("m1", 1, 0, "a", "b"), pending("m2", 1, 1, "c", "d")];
    const bracket = await render({ tournament: tournament({ bracket_size: 4 }), matches, lifecycle: "live" });
    expect(bracket.querySelectorAll('[data-live="true"]')).toHaveLength(1);
    const liveMatch = bracket.querySelector('[data-match-id="m1"][data-live="true"]');
    expect(liveMatch).toBeTruthy();
    const liveTag = liveMatch.querySelector(".tn-live-tag");
    expect(liveTag.classList.contains("inline-flex")).toBe(true);
    expect(liveTag.classList.contains("absolute")).toBe(false);
    expect(liveTag.classList.contains("before:animate-[tn-live-pulse_1.6s_ease-in-out_infinite]")).toBe(true);
    expect(liveTag.classList.contains("motion-reduce:before:animate-none")).toBe(true);
    const done = await render({ tournament: tournament({ bracket_size: 4 }), matches, lifecycle: "finished" });
    expect(done.querySelector("[data-live]")).toBeNull();
  });

  it("renders placeholders for missing slots instead of heavy cards", async () => {
    const bracket = await render({ tournament: tournament(), matches: [], lifecycle: "live" });
    expect(bracket.querySelectorAll("[data-placeholder]")).toHaveLength(6);
    expect(bracket.querySelector('[data-state="waiting"]')).toBeTruthy();
    expect(bracket.querySelector("[data-live]")).toBeNull();
  });

  it("renders a decided final when both semifinalists are known, including a BYE", async () => {
    const matches = [pending("m1", 2, 0, "a", "b")];
    const bracket = await render({ tournament: tournament({ bracket_size: 4 }), matches, lifecycle: "live" });
    expect(bracket.querySelector('[data-state="waiting"]')).toBeNull();
    expect(bracket.querySelector('[data-match-id="m1"]')).toBeTruthy();
    const bye = await render({
      tournament: tournament({ bracket_size: 4 }),
      matches: [{ ...matches[0], player2_name: BYE }],
      lifecycle: "live",
    });
    expect(bye.querySelector('[data-state="waiting"]')).toBeNull();
    expect(bye.querySelector('[data-state="bye"]')).toBeTruthy();
  });

  it("shows the BYE note only when a BYE exists and keeps connector hooks", async () => {
    const withBye = await render({
      tournament: tournament({ bracket_size: 4 }),
      matches: buildBracket(["a", "b"], 4),
      lifecycle: "live",
    });
    expect(withBye.querySelector("[data-bye-note]")).toBeTruthy();
    const full = await render({
      tournament: tournament({ bracket_size: 4 }),
      matches: buildBracket(["a", "b", "c", "d"], 4),
      lifecycle: "live",
    });
    expect(full.querySelector("[data-bye-note]")).toBeNull();
    const connectorBracket = await render({
      tournament: tournament(),
      matches: buildBracket(["a", "b", "c", "d"], 8),
      lifecycle: "live",
    });
    expect(connectorBracket.querySelectorAll(".tn-match[data-round]")).toHaveLength(7);
    expect(connectorBracket.querySelector(".tn-connectors")).toBeTruthy();
    const connector = connectorBracket.querySelector(".tn-connectors path");
    expect(connector.getAttribute("fill")).toBe("none");
    expect(connector.getAttribute("stroke")).toBe("currentColor");
    expect(connector.getAttribute("stroke-width")).toBe("2");
    expect(connector.getAttribute("stroke-linejoin")).toBe("miter");
    const byeConnector = withBye.querySelector(".tn-connectors path.is-bye");
    expect(byeConnector.getAttribute("stroke-dasharray")).toBe("4 4");
    expect(byeConnector.getAttribute("opacity")).toBe("0.5");
  });
});
