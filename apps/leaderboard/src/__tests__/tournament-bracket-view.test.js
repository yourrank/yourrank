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
  it("renders the same cards in both modes but keeps the stream view read-only", () => {
    const matches = [pending("m1", 1, 0, "a", "b"), pending("m2", 1, 1, "c", "d"), ...buildBracket(["a", "b", "c", "d"], 8).filter((m) => m.round_number > 1)];
    const args = { tournament: tournament(), matches, lifecycle: "bracket" };
    const embedded = renderBracket({ ...args, mode: "embedded" });
    const expanded = renderBracket({ ...args, mode: "expanded" });
    expect(embedded).toContain('data-mode="embedded"');
    expect(expanded).toContain('data-mode="expanded"');
    // Embedded is interactive; expanded (stream view) never emits inputs/Save.
    expect(embedded).toContain('class="tn-match-input"');
    expect(embedded).toContain('data-score-match=');
    expect(expanded).not.toContain("<input");
    expect(expanded).not.toContain('data-score-match=');
    const ids = (html) => [...html.matchAll(/data-match-id="([^"]+)"/g)].map((m) => m[1]).sort();
    expect(ids(expanded)).toEqual(ids(embedded));
    const rounds = (html) => [...html.matchAll(/class="tn-round"/g)].length;
    expect(rounds(expanded)).toBe(rounds(embedded));
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
    // Scorable keeps the submit contract; BYE and void lines say "BYE".
    expect(html).toContain('data-score-match="m2"');
    expect(html).toContain('<span class="tn-bye-tag">BYE</span>');
    expect(html).not.toContain("tn-match-adv\">advances");
    // TBD slots are thin placeholder lines; the undecided final is a waiting card.
    expect(html).toContain('data-state="future"');
    expect(html).toContain('data-state="waiting"');
    expect(html).toContain("Waiting for semifinalists");
    // A bracket containing a BYE explains itself above the scroller.
    expect(html).toContain("data-bye-note");
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

  it("renders prefilled inputs and a disabled Save on a completed correctable card", () => {
    const correctable = { id: "m-1", round_number: 1, match_index: 0, player1_name: "a", player2_name: "b", player1_score: 2, player2_score: 1, winner_name: "a", status: "completed", correctable: true };
    const locked = { ...correctable, id: "m-2", match_index: 1, correctable: false };
    const html = renderBracket({ tournament: tournament({ bracket_size: 4 }), matches: [correctable, locked], lifecycle: "bracket" });
    expect(html).toContain('data-correctable="true"');
    // Same editable markup as a scorable card, prefilled with the saved score.
    expect(html).toContain('data-score-mode="correct"');
    expect(html).toContain('data-saved="2,1"');
    expect(html).toContain('data-score-player="1" value="2"');
    expect(html).toContain('data-score-player="2" value="1"');
    expect(html).toContain('<button class="tn-match-save" type="button" data-score-match="m-1" disabled>Save</button>');
    expect(html).toContain('Changing the winner updates later rounds.');
    expect(html).toContain('class="tn-match-note" hidden');
    // Correction is inline-only: no Edit/Cancel mode remains.
    expect(html).not.toContain("data-score-edit");
    expect(html).not.toContain("data-score-cancel");
    // The non-correctable completed card stays read-only.
    expect(html).not.toContain('data-score-match="m-2"');
  });

  it("marks exactly one live match — the first scorable — and only while live", () => {
    const matches = [pending("m1", 1, 0, "a", "b"), pending("m2", 1, 1, "c", "d")];
    const html = renderBracket({ tournament: tournament({ bracket_size: 4 }), matches, lifecycle: "bracket" });
    expect(html.match(/data-live="true"/g)).toHaveLength(1);
    expect(html).toContain('data-match-id="m1" data-round="1" data-index="0" data-live="true"');
    expect(html).toContain('<span class="tn-live-tag">LIVE</span>');
    const done = renderBracket({ tournament: tournament({ bracket_size: 4 }), matches, lifecycle: "completed" });
    expect(done).not.toContain("data-live");
  });

  it("renders placeholders for missing slots, not heavy cards", () => {
    const html = renderBracket({ tournament: tournament(), matches: [], lifecycle: "bracket" });
    // Empty model lays out the 8-player grid: 6 placeholder lines plus the
    // final column's waiting card.
    expect((html.match(/data-placeholder/g) || []).length).toBe(6);
    expect(html).toContain('data-state="waiting"');
    expect(html).not.toContain("data-live");
  });

  it("renders the decided final as a normal card once both semifinalists exist", () => {
    const matches = [pending("m1", 2, 0, "a", "b")];
    const html = renderBracket({ tournament: tournament({ bracket_size: 4 }), matches, lifecycle: "bracket" });
    expect(html).not.toContain('data-state="waiting"');
    expect(html).toContain('data-match-id="m1"');
    // A BYE still counts as a known player for the waiting check.
    const bye = renderBracket({ tournament: tournament({ bracket_size: 4 }), matches: [{ ...matches[0], player2_name: BYE }], lifecycle: "bracket" });
    expect(bye).not.toContain('data-state="waiting"');
    expect(bye).toContain('data-state="bye"');
  });

  it("emits the BYE explanation note only when a BYE exists", () => {
    const withBye = renderBracket({ tournament: tournament({ bracket_size: 4 }), matches: buildBracket(["a", "b"], 4), lifecycle: "bracket" });
    expect(withBye).toContain("data-bye-note");
    const full = renderBracket({ tournament: tournament({ bracket_size: 4 }), matches: buildBracket(["a", "b", "c", "d"], 4), lifecycle: "bracket" });
    expect(full).not.toContain("data-bye-note");
  });

  it("emits one connector path per non-final match once laid out", () => {
    // layoutBracket is exercised in the browser script; here we verify the
    // renderer's data-round/data-index hooks exist for every slot.
    const html = renderBracket({ tournament: tournament(), matches: buildBracket(["a", "b", "c", "d"], 8), lifecycle: "bracket" });
    expect((html.match(/data-round="/g) || []).length).toBe(7);
    expect(html).toContain("tn-connectors");
  });
});
