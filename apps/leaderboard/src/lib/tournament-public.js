// Viewer-safe projection of a tournament bracket. Public surfaces (the
// /<slug>/tournament page, its stream variant and /api/public/:slug/tournament)
// read only this shape: display names, rounds, scores, status and champion.
// Row ids, entry ids, flags, owner fields and the internal BYE sentinel never
// leave this module.
import { isBye } from "./tournament-bracket.js";

const known = (name) => {
  const value = String(name ?? "").trim();
  return value && value !== "TBD" && !isBye(value) ? value : null;
};

export function publicRoundLabel(round, totalRounds) {
  const fromEnd = totalRounds - round;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semifinals";
  if (fromEnd === 2) return "Quarterfinals";
  return `Round ${round}`;
}

function publicStatus(tournament) {
  if (tournament.status === "completed") return "finished";
  if (tournament.status === "active") return "live";
  if (tournament.signup_state === "open") return "signups";
  return "setup";
}

function publicSlot(match, slot) {
  const raw = slot === 1 ? match.player1_name : match.player2_name;
  const name = known(raw);
  const done = match.status === "completed";
  const winner = done && name !== null && name === known(match.winner_name);
  const played = done && !isBye(match.player1_name) && !isBye(match.player2_name);
  const score = played ? Number(slot === 1 ? match.player1_score : match.player2_score) || 0 : null;
  return { name, bye: isBye(raw), score, winner };
}

export function publicTournamentView(tournament, matches = [], { entryCount = 0 } = {}) {
  if (!tournament) return null;
  const rows = [...(matches || [])].sort((a, b) => (a.round_number - b.round_number) || (a.match_index - b.match_index));
  const totalRounds = rows.reduce((max, m) => Math.max(max, Number(m.round_number) || 0), 0);
  const status = publicStatus(tournament);
  let liveAssigned = false;
  const rounds = [];
  for (let round = 1; round <= totalRounds; round++) {
    const inRound = rows.filter((m) => Number(m.round_number) === round);
    rounds.push({
      number: round,
      label: publicRoundLabel(round, totalRounds),
      matches: inRound.map((m) => {
        const p1 = publicSlot(m, 1);
        const p2 = publicSlot(m, 2);
        let state = "waiting";
        if (p1.bye || p2.bye) state = "bye";
        else if (m.status === "completed") state = "done";
        else if (p1.name && p2.name) state = "ready";
        const live = state === "ready" && status === "live" && !liveAssigned;
        if (live) liveAssigned = true;
        return { state, live, players: [p1, p2] };
      }),
    });
  }

  const final = rows.find((m) => Number(m.round_number) === totalRounds && m.status === "completed");
  const champion = status === "finished" ? known(tournament.winner_name) || (final ? known(final.winner_name) : null) : null;
  let runnerUp = null;
  let finalScore = null;
  if (champion && final) {
    const [a, b] = [publicSlot(final, 1), publicSlot(final, 2)];
    const [won, lost] = a.name === champion ? [a, b] : [b, a];
    runnerUp = lost.name;
    finalScore = won.score !== null && lost.score !== null ? `${won.score}–${lost.score}` : null;
  }

  const signupsOpen = status === "signups";
  return {
    title: String(tournament.title || "Tournament"),
    game: tournament.game_name ? String(tournament.game_name) : null,
    status,
    bracketSize: Number(tournament.bracket_size) || null,
    entryCount: Math.max(0, Number(entryCount) || 0),
    joinCommand: signupsOpen && tournament.entry_keyword ? String(tournament.entry_keyword) : null,
    chatChannel: signupsOpen && tournament.chat_channel ? String(tournament.chat_channel) : null,
    champion,
    runnerUp,
    finalScore,
    rounds,
  };
}
