// Pure single-elimination bracket engine: seeding order, BYE placement and
// BYE auto-advancement. No database access — callers persist the rows.
// Internal sentinel for BYE slots. Namespaced so a player literally named
// "BYE" stays a normal entrant everywhere.
export const BYE = "__YOURRANK_INTERNAL_BYE__";
export const MIN_BRACKET_PARTICIPANTS = 2;

export function isBye(name) {
  return name === BYE;
}

// Standard seeded slot order: round-1 match m pairs seeds order[2m] and
// order[2m+1], so the highest seeds land against the lowest (and therefore
// against BYEs when the bracket is undersubscribed).
export function bracketSeedOrder(size) {
  let order = [1, 2];
  for (let n = 4; n <= size; n *= 2) {
    const next = [];
    for (const seed of order) next.push(seed, n + 1 - seed);
    order = next;
  }
  return order;
}

const isKnown = (name) => Boolean(name) && name !== "TBD";

// Completes every match that has a BYE once both slots are known, propagating
// winners (BYE included) into the next round until the bracket is stable.
// Mutates the given match rows and returns them.
export function resolveByes(matches) {
  const byKey = new Map(matches.map((m) => [`${m.round_number}:${m.match_index}`, m]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const match of matches) {
      if (match.status === "completed") continue;
      if (!isKnown(match.player1_name) || !isKnown(match.player2_name)) continue;
      if (!isBye(match.player1_name) && !isBye(match.player2_name)) continue;
      match.status = "completed";
      match.player1_score = 0;
      match.player2_score = 0;
      match.winner_name = isBye(match.player1_name) ? match.player2_name : match.player1_name;
      const next = byKey.get(`${match.round_number + 1}:${Math.floor(match.match_index / 2)}`);
      if (next) {
        const slot = match.match_index % 2 === 0 ? "player1_name" : "player2_name";
        if (!isKnown(next[slot])) next[slot] = match.winner_name;
      }
      changed = true;
    }
  }
  return matches;
}

// Builds the full match list for `bracketSize` seats with `participants`
// (already shuffled by the caller) as seeds 1..N and BYEs filling the rest.
// Later rounds start as TBD/TBD; BYE resolution is already applied.
export function buildBracket(participants, bracketSize) {
  if (!Array.isArray(participants)
      || participants.length < MIN_BRACKET_PARTICIPANTS
      || participants.length > bracketSize) {
    throw new Error(`buildBracket needs between ${MIN_BRACKET_PARTICIPANTS} and ${bracketSize} participants.`);
  }
  const totalRounds = Math.log2(bracketSize);
  if (!Number.isInteger(totalRounds) || totalRounds < 1) {
    throw new Error(`Unsupported bracket size ${bracketSize}.`);
  }
  const seed = (n) => (n <= participants.length ? participants[n - 1] : BYE);
  const order = bracketSeedOrder(bracketSize);

  const matches = [];
  for (let m = 0; m < bracketSize / 2; m++) {
    matches.push({
      round_number: 1,
      match_index: m,
      player1_name: seed(order[m * 2]),
      player2_name: seed(order[m * 2 + 1]),
      player1_score: 0,
      player2_score: 0,
      status: "pending",
      winner_name: null,
    });
  }
  for (let r = 2; r <= totalRounds; r++) {
    for (let m = 0; m < bracketSize / (2 ** r); m++) {
      matches.push({
        round_number: r,
        match_index: m,
        player1_name: "TBD",
        player2_name: "TBD",
        player1_score: 0,
        player2_score: 0,
        status: "pending",
        winner_name: null,
      });
    }
  }
  return resolveByes(matches);
}
