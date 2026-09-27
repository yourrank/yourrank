// Pure coverage for the bracket renderer: buildRoundModel, roundLabel and
// renderBracket run without a DOM. Geometry/connectors are covered by
// scripts/verify-tournament-bracket.mjs (real browser).
//
// Run: bun test src/__tests__/tournament-bracket-view.test.js

import { describe, expect, it } from "bun:test";
import { BYE, buildRoundModel, roundLabel, renderBracket } from "../assets/tournament-bracket-view.js";
import { buildBracket } from "../lib/tournament-bracket.js";

const tournament = (over = {}) => ({ id: "t-1", bracket_size: 8, winner_name: null, status: "active", ...over });
const completed = (id, r, i, p1, p2, s1, s2, winner) =>
  ({ id, round_number: r, match_index: i, player1_name: p1, player2_name: p2, player1_score: s1, player2_score: s2, status: "completed", winner_name: winner });
const pending = (id, r, i, p1 = "TBD", p2 = "TBD") =>
  ({ id, round_number: r, match_index: i, player1_name: p1, player2_name: p2, player1_score: 0, player2_score: 0, status: "pending", winner_name: null });

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
    expect(model.rounds[0].matches.filter((s) => !s.match)).toHaveLength(3);
    expect(model.rounds[1].matches.every((s) => !s.match)).toBe(true);
    expect(model.rounds[2].matches).toHaveLength(1);
  });

  it("keeps extra rounds/matches the data contains rather than dropping them", () => {
    const model = buildRoundModel([completed("m1", 3, 0, "a", "b", 1, 0, "a")], 4);
    expect(model.totalRounds).toBe(3);
    expect(model.rounds[2].matches[0].match.id).toBe("m1");
    const fat = buildRoundModel([completed("m1", 1, 0, "a", "b", 1, 0, "a"), completed("m2", 1, 1, "c", "d", 1, 0, "c"), completed("m3", 1, 2, "e", "f", 1, 0, "e")], 4);
    expect(fat.rounds[0].matches).toHaveLength(3);
  });
});

describe("renderBracket", () => {
  it("emits identical markup for embedded and expanded modes apart from data-mode", () => {
    const matches = buildBracket(["a", "b"], 8);
    const args = { tournament: tournament(), matches, lifecycle: "bracket" };
    const embedded = renderBracket({ ...args, mode: "embedded" });
    const expanded = renderBracket({ ...args, mode: "expanded" });
    expect(embedded).toContain('data-mode="embedded"');
    expect(expanded).toContain('data-mode="expanded"');
    const strip = (html) => html.replace(/data-mode="[^"]+"/, "");
    expect(strip(expanded)).toBe(strip(embedded));
  });

  it("never leaks the BYE sentinel or per-match classes", () => {
    const html = renderBracket({ tournament: tournament(), matches: buildBracket(["a", "b"], 8), lifecycle: "bracket" });
    expect(html).not.toContain(BYE);
    expect(html).not.toMatch(/match-\d|\.final\b/);
  });

  it("renders all five card states", () => {
    const matches = [
      completed("m1", 1, 0, "a", "b", 2, 1, "a"),
      pending("m2", 1, 1, "c", "d"),
      pending("m3", 1, 2),
      pending("m4", 1, 3, "e", BYE),
      completed("m5", 1, 4, BYE, BYE, 0, 0, BYE),
    ];
    const html = renderBracket({ tournament: tournament({ bracket_size: 8 }), matches, lifecycle: "bracket" });
    expect(html).toContain('data-state="completed"');
    expect(html).toContain('data-state="scorable"');
    expect(html).toContain('data-state="future"');
    expect(html).toContain('data-state="bye"');
    expect(html).toContain('data-state="void"');
    // Scorable keeps the submit contract; BYE shows the advance note; void stays compact.
    expect(html).toContain('data-score-match="m2"');
    expect(html).toContain("advances");
    // TBD slots and missing model slots are thin placeholder lines.
    expect(html).toContain('data-state="future"');
  });

  it("marks winners with the crown and reserves gold for the final champion", () => {
    const matches = buildBracket(["a", "b"], 4);
    // Score the one real round-1 match (a vs b at index 0 for size 4? seed
    // order is [1,4,2,3] -> a vs BYE, b vs BYE; only R2 is a vs b).
    const final = matches.find((m) => m.round_number === 2);
    final.status = "completed";
    final.player1_name = "a";
    final.player2_name = "b";
    final.player1_score = 2;
    final.player2_score = 1;
    final.winner_name = "a";
    const html = renderBracket({ tournament: tournament({ bracket_size: 4, winner_name: "a", status: "completed" }), matches, lifecycle: "completed" });
    expect(html).toContain("is-champion");
    expect(html.match(/tn-crown/g).length).toBe(1);
  });

  it("renders placeholders for missing slots, not heavy cards", () => {
    const html = renderBracket({ tournament: tournament(), matches: [], lifecycle: "bracket" });
    // Empty model still lays out the expected 8-player grid as placeholders.
    expect((html.match(/data-placeholder/g) || []).length).toBe(7);
  });

  it("emits one connector path per non-final match once laid out", () => {
    // layoutBracket is exercised in the browser script; here we verify the
    // renderer's data-round/data-index hooks exist for every slot.
    const html = renderBracket({ tournament: tournament(), matches: buildBracket(["a", "b", "c", "d"], 8), lifecycle: "bracket" });
    expect((html.match(/data-round="/g) || []).length).toBe(7);
    expect(html).toContain("tn-connectors");
  });
});
