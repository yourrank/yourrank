// Data-driven single-elimination bracket renderer: builds a round model from
// the matches API rows, emits one HTML structure for both the embedded panel
// and the expanded dialog, and lays it out on screen with slot-based geometry
// + SVG connectors. Pure functions + one DOM layout routine; no fetching and
// no lifecycle logic — the caller owns when to render and dispose.
// BYE sentinel — must match BYE in lib/tournament-bracket.js (the lib lives
// outside /assets so the browser cannot import it; this is the client's one
// definition, re-exported for tournaments.js).
export const BYE = "__YOURRANK_INTERNAL_BYE__";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[char]));

export const CROWN_ICON = '<svg class="tn-crown" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><path d="M5 16 3 7l5.5 4L12 4l3.5 7L21 7l-2 9H5zm0 2h14v2H5z"/></svg>';

const TBD = "TBD";
const isBye = (name) => name === BYE;
const isTbd = (name) => !name || name === TBD;

// Label reads back from the players still alive in a round: the round that
// decides between 2 is the Final, 4 the Semifinals, 8 the Quarterfinals.
export function roundLabel(remainingPlayers) {
  if (remainingPlayers === 2) return "Final";
  if (remainingPlayers === 4) return "Semifinals";
  if (remainingPlayers === 8) return "Quarterfinals";
  return `Round of ${remainingPlayers}`;
}

let warnedShape = false;

// Groups API matches into rounds/slots. `expected` comes from the bracket
// size when it is a power of two >= 2, otherwise from the data itself; a
// round missing rows gets `{ match: null }` placeholders so the grid stays
// aligned. Extra data beyond the model is kept, never dropped.
export function buildRoundModel(matches, bracketSize) {
  const byRound = new Map();
  for (const match of matches || []) {
    const round = Number(match.round_number) || 0;
    if (round < 1) continue;
    if (!byRound.has(round)) byRound.set(round, []);
    byRound.get(round).push(match);
  }
  for (const list of byRound.values()) list.sort((a, b) => a.match_index - b.match_index);
  const maxDataRound = Math.max(0, ...byRound.keys());
  const log2 = Number(bracketSize) >= 2 ? Math.log2(bracketSize) : NaN;
  const ideal = Number.isInteger(log2) ? log2 : maxDataRound;
  const totalRounds = Math.max(ideal, maxDataRound, byRound.size ? 1 : 0);
  const rounds = [];
  for (let round = 1; round <= totalRounds; round += 1) {
    const expected = Number.isInteger(log2) ? Math.max(1, bracketSize / 2 ** round) : (byRound.get(round)?.length || 0);
    const list = byRound.get(round) || [];
    if (list.length > expected && !warnedShape) {
      warnedShape = true;
      console.warn(`Bracket data exceeds the ${bracketSize}-player model: round ${round} has ${list.length} matches (expected ${expected}).`);
    }
    const slots = [];
    for (let index = 0; index < Math.max(expected, list.length); index += 1) {
      slots.push({ match: list[index] || null, index });
    }
    rounds.push({
      number: round,
      label: roundLabel(expected * 2),
      matches: slots,
      expected,
    });
  }
  return { totalRounds, rounds };
}

// ---- Match cards ---------------------------------------------------------

// completed | scorable | future | bye | void — one state per card so CSS and
// connectors can key off `data-state`.
function matchState(match, finished) {
  const bye1 = isBye(match.player1_name);
  const bye2 = isBye(match.player2_name);
  if (bye1 && bye2) return "void";
  if (bye1 || bye2) return "bye";
  if (match.status === "completed") return "completed";
  if (!finished && !isTbd(match.player1_name) && !isTbd(match.player2_name)) return "scorable";
  return "future";
}

// A real match: two `seed | name | score` rows. `champion` gets the gold
// treatment; the crown marks the row that won the match. `tail` appends an
// action (Edit) inside the row without adding a third row.
function rowHtml({ seed = null, name, score = "", winner = false, champion = false, muted = false, tail = "" }) {
  const cls = `tn-match-row${winner ? " is-winner" : ""}${champion ? " is-champion" : ""}${muted ? " is-muted" : ""}`;
  return `<div class="${cls}">
    ${seed !== null ? `<span class="tn-match-seed">${seed}</span>` : ""}
    <span class="tn-match-name">${winner ? CROWN_ICON : ""}${esc(name)}</span>
    <span class="tn-match-score">${esc(score)}</span>
    ${tail}
  </div>`;
}

// Score inputs sit where the score digits would, keeping the card two rows.
// `values` prefills a score correction; `cancel` adds the cancel button and
// the explanatory note line a correction requires.
function scoringRowsHtml(match, seedBase, { values = null, cancel = false } = {}) {
  const row = (seed, name, player) => `<div class="tn-match-row">
    ${seed !== null ? `<span class="tn-match-seed">${seed}</span>` : ""}
    <span class="tn-match-name">${esc(name)}</span>
    <input type="number" min="0" class="tn-match-input" data-score-match="${esc(match.id)}" data-score-player="${player}" value="${esc(values ? values[player - 1] : 0)}" aria-label="${esc(name)} score" />
    ${player === 2 ? `<button class="tn-match-save" type="button" data-score-match="${esc(match.id)}">Save</button>${cancel ? `<button class="tn-match-edit" type="button" data-score-cancel>Cancel</button>` : ""}` : ""}
  </div>`;
  return `${row(seedBase, match.player1_name, 1)}
    ${row(seedBase !== null ? seedBase + 1 : null, match.player2_name, 2)}
    ${cancel ? `<div class="tn-match-note">Changing the winner updates later rounds.</div>` : ""}`;
}

function matchCard(match, { finished, isFinal, championName, correctingId }) {
  const state = matchState(match, finished);
  const correcting = state === "completed" && correctingId != null && String(match.id) === String(correctingId);
  const seedBase = Number(match.round_number) === 1 ? match.match_index * 2 + 1 : null;
  const attrs = `class="tn-match${isFinal ? " tn-match--final" : ""}" data-state="${correcting ? "scorable" : state}" data-match-id="${esc(match.id)}" data-round="${esc(match.round_number)}" data-index="${esc(match.match_index)}"${state === "completed" && match.correctable ? ' data-correctable="true"' : ""}${correcting ? ' data-score-mode="correct"' : ""}`;
  if (state === "void" || state === "future") {
    // BYE/BYE and TBD slots get a thin placeholder line, never a card.
    const label = state === "void" ? "—" : TBD;
    return `<div ${attrs}><div class="tn-match-line">${seedBase !== null ? `<span class="tn-match-seed">${seedBase}</span>` : ""}<span class="tn-match-name">${esc(label)}</span><span class="tn-match-name">${esc(label)}</span></div></div>`;
  }
  if (state === "bye") {
    // One real player: a single compact line — it advances, it is not a match.
    // A completed bye (or the champion's final) still earns the crown.
    const player = isBye(match.player1_name) ? match.player2_name : match.player1_name;
    const seed = isBye(match.player1_name) ? seedBase + 1 : seedBase;
    const winner = match.status === "completed" && match.winner_name === player;
    const champion = isFinal && championName === player;
    return `<div ${attrs}><div class="tn-match-line">
      ${seed !== null ? `<span class="tn-match-seed">${seed}</span>` : ""}
      <span class="tn-match-name${winner || champion ? " is-winner" : ""}${champion ? " is-champion" : ""}">${champion ? CROWN_ICON : ""}${esc(player)}</span>
      <span class="tn-match-adv">${champion ? "champion" : "advances"}</span>
    </div></div>`;
  }
  if (state === "scorable") {
    // Two rows like a played match: the score inputs sit where the score
    // digits would, and a compact Save rides the second row's edge.
    return `<div ${attrs}>
      ${scoringRowsHtml(match, seedBase)}
    </div>`;
  }
  // completed
  if (correcting) {
    // Same inputs, prefilled; the PATCH correction contract reuses
    // data-score-* plus a cancel and the downstream warning note.
    return `<div ${attrs}>
      ${scoringRowsHtml(match, seedBase, { values: [match.player1_score ?? 0, match.player2_score ?? 0], cancel: true })}
    </div>`;
  }
  const p1Winner = match.winner_name === match.player1_name;
  const p2Winner = match.winner_name === match.player2_name;
  const p1Champion = isFinal && championName === match.player1_name;
  const p2Champion = isFinal && championName === match.player2_name;
  const edit = match.correctable
    ? `<button class="tn-match-edit" type="button" data-score-edit="${esc(match.id)}" aria-label="Correct score">Edit</button>`
    : "";
  return `<div ${attrs}>
    ${rowHtml({ seed: seedBase, name: match.player1_name, score: match.player1_score ?? 0, winner: p1Winner, champion: p1Champion, muted: p2Winner })}
    ${rowHtml({ seed: seedBase !== null ? seedBase + 1 : null, name: match.player2_name, score: match.player2_score ?? 0, winner: p2Winner, champion: p2Champion, muted: p1Winner, tail: edit })}
  </div>`;
}

// A missing slot in the model: a thin placeholder line, never a heavy card.
function placeholderCard(round, index) {
  const seedBase = round === 1 ? index * 2 + 1 : null;
  return `<div class="tn-match" data-state="future" data-placeholder data-round="${round}" data-index="${index}">
    <div class="tn-match-line">${seedBase !== null ? `<span class="tn-match-seed">${seedBase}</span>` : ""}<span class="tn-match-name">${TBD}</span><span class="tn-match-name">${TBD}</span></div>
  </div>`;
}

// ---- Renderer ------------------------------------------------------------

// The grid stacks rounds left to right; each round's slots are `2^(r-1)`
// slot-units tall so match k of round r+1 centres between feeders 2k/2k+1.
// mode: "embedded" | "expanded" — identical markup apart from the flag.
export function renderBracket({ tournament, matches, lifecycle, mode = "embedded", correctingId = null }) {
  const finished = lifecycle === "completed" || lifecycle === "cancelled";
  const model = buildRoundModel(matches, tournament?.bracket_size);
  const slots = model.rounds[0]?.expected || 1;
  const championName = finished && tournament?.winner_name ? tournament.winner_name : null;
  const roundsHtml = model.rounds.map((round) => {
    const count = `${round.matches.length} ${round.matches.length === 1 ? "match" : "matches"}`;
    const body = round.matches.map(({ match, index }) =>
      `<div class="tn-slot">${match
        ? matchCard(match, { finished, isFinal: round.number === model.totalRounds, championName, correctingId })
        : placeholderCard(round.number, index)}</div>`).join("");
    return `<section class="tn-round" style="--span:${2 ** (round.number - 1)}">
      <div class="tn-round-head"><h3>${esc(round.label)}</h3><span>${esc(count)}</span></div>
      <div class="tn-round-body">${body}</div>
    </section>`;
  }).join("");
  return `<div class="tn-bracket" data-mode="${esc(mode)}">
    <div class="tn-bracket-scroll">
      <div class="tn-bracket-grid" style="--rounds:${model.totalRounds};--slots:${slots}">
        <svg class="tn-connectors" aria-hidden="true"></svg>
        ${roundsHtml}
      </div>
    </div>
  </div>`;
}

// ---- Layout --------------------------------------------------------------

const GAP_PX = 12; // breathing room added to the tallest real card when sizing a slot

// Measures the rendered cards, sizes `--tn-slot`, and draws the SVG
// connectors (feeder (r,i) -> (r+1, floor(i/2))). Only real matches drive the
// slot height — placeholder lines are thin by design. Returns a dispose()
// that removes the ResizeObserver + window listener.
export function layoutBracket(root) {
  const grid = root?.querySelector(".tn-bracket-grid");
  const svg = root?.querySelector(".tn-connectors");
  if (!grid || !svg) return () => {};
  const win = root.ownerDocument?.defaultView || (typeof window !== "undefined" ? window : null);
  const raf = win?.requestAnimationFrame ? (fn) => win.requestAnimationFrame(fn) : (fn) => setTimeout(fn, 0);
  const caf = win?.cancelAnimationFrame ? (id) => win.cancelAnimationFrame(id) : clearTimeout;
  let frame = 0;
  let observer = null;
  let disposed = false;

  const draw = () => {
    const gridRect = grid.getBoundingClientRect();
    svg.setAttribute("viewBox", `0 0 ${Math.max(0, gridRect.width)} ${Math.max(0, gridRect.height)}`);
    const cards = new Map();
    for (const el of grid.querySelectorAll(".tn-match[data-round]")) {
      cards.set(`${el.dataset.round}:${el.dataset.index}`, el);
    }
    let totalRounds = 0;
    for (const key of cards.keys()) totalRounds = Math.max(totalRounds, Number(key.split(":")[0]));
    const paths = [];
    for (const [key, el] of cards) {
      const round = Number(el.dataset.round);
      if (round >= totalRounds) continue;
      const toKey = `${round + 1}:${Math.floor(Number(el.dataset.index) / 2)}`;
      const target = cards.get(toKey);
      if (!target) continue;
      const a = el.getBoundingClientRect();
      const b = target.getBoundingClientRect();
      let d = "";
      if (gridRect.width && a.width) {
        const x1 = a.right - gridRect.left;
        const y1 = a.top + a.height / 2 - gridRect.top;
        const x2 = b.left - gridRect.left;
        const y2 = b.top + b.height / 2 - gridRect.top;
        const mid = x1 + (x2 - x1) / 2;
        d = `M ${x1} ${y1} L ${mid} ${y1} L ${mid} ${y2} L ${x2} ${y2}`;
      }
      // Stub paths (empty d) still carry data-from/data-to so layout-less
      // environments can count connectors.
      paths.push(`<path d="${d}" data-from="${key}" data-to="${toKey}"${el.dataset.state === "bye" || el.dataset.state === "void" ? ' class="is-bye"' : ""}/>`);
    }
    svg.innerHTML = paths.join("");
  };

  const measure = () => {
    frame = 0;
    if (disposed) return;
    let tallest = 0;
    // Only real matches (scores or scoring inputs) set the slot rhythm;
    // bye/void/future lines are thin by design.
    for (const el of grid.querySelectorAll('.tn-match[data-state="completed"], .tn-match[data-state="scorable"]')) {
      tallest = Math.max(tallest, el.getBoundingClientRect().height || 0);
    }
    if (!tallest) {
      for (const el of grid.querySelectorAll(".tn-match")) {
        tallest = Math.max(tallest, el.getBoundingClientRect().height || 0);
      }
    }
    if (tallest) grid.style.setProperty("--tn-slot", `${Math.ceil(tallest + GAP_PX)}px`);
    draw();
  };
  const schedule = () => { if (!frame && !disposed) frame = raf(measure); };

  if (typeof win?.ResizeObserver === "function") {
    observer = new win.ResizeObserver(schedule);
    observer.observe(grid);
  }
  win?.addEventListener?.("resize", schedule);
  measure();
  return () => {
    disposed = true;
    if (frame) caf(frame);
    observer?.disconnect();
    win?.removeEventListener?.("resize", schedule);
  };
}
