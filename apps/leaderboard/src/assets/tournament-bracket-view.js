// Data-driven single-elimination bracket renderer: builds a round model from
// the matches API rows, emits one HTML structure for both the embedded panel
// and the expanded modal, and lays it out on screen with slot-based geometry
// + SVG connectors. Pure functions + one DOM layout routine; no fetching and
// no lifecycle logic — the caller owns when to render and dispose.
// BYE sentinel — must match BYE in lib/tournament-bracket.js (the lib lives
// outside /assets so the browser cannot import it; this is the client's one
// definition, re-exported for tournaments.js).
export const BYE = "__YOURRANK_INTERNAL_BYE__";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

export const CROWN_ICON = '<svg class="tourn-crown" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><path d="M5 16 3 7l5.5 4L12 4l3.5 7L21 7l-2 9H5zm0 2h14v2H5z"/></svg>';

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

function scoreCell(score) {
  return `<span class="tourn-match-score">${esc(score ?? 0)}</span>`;
}

// Real-player row for a completed/scorable/future card. `champion` gets the
// gold treatment + crown; ordinary winners only the accent highlight.
function playerRow(name, { winner = false, champion = false, crown = false, score = null, showScore = false } = {}) {
  const cls = `tourn-match-row${winner ? " is-winner" : ""}${champion ? " is-champion" : ""}`;
  return `<div class="${cls}">
    <span class="tourn-match-name">${crown ? CROWN_ICON : ""}${esc(name)}</span>
    ${showScore ? scoreCell(score) : ""}
  </div>`;
}

function matchCard(match, { finished, isFinal, championName }) {
  const state = matchState(match, finished);
  const attrs = `class="tourn-match${isFinal ? " tourn-match--final" : ""}" data-state="${state}" data-match-id="${esc(match.id)}" data-round="${esc(match.round_number)}" data-index="${esc(match.match_index)}"`;
  if (state === "void") {
    return `<div ${attrs}><span class="tourn-match-void" aria-label="No match">—</span></div>`;
  }
  if (state === "bye") {
    const player = isBye(match.player1_name) ? match.player2_name : match.player1_name;
    const winner = match.status === "completed" && match.winner_name === player;
    const champion = isFinal && championName === player;
    return `<div ${attrs}>
      ${playerRow(player, { winner, champion })}
      <div class="tourn-match-row tourn-match-note"><span class="tourn-match-name">Advances automatically</span></div>
    </div>`;
  }
  if (state === "future" || state === "scorable") {
    const p1 = isTbd(match.player1_name) ? TBD : match.player1_name;
    const p2 = isTbd(match.player2_name) ? TBD : match.player2_name;
    const actions = state === "scorable"
      ? `<div class="tourn-match-actions">
          <input type="number" min="0" class="tourn-match-score-input" data-score-match="${esc(match.id)}" data-score-player="1" value="0" aria-label="${esc(p1)} score" />
          <span class="tourn-match-divider">–</span>
          <input type="number" min="0" class="tourn-match-score-input" data-score-match="${esc(match.id)}" data-score-player="2" value="0" aria-label="${esc(p2)} score" />
          <button class="btn btn--sm btn--accent" type="button" data-score-match="${esc(match.id)}">Submit score</button>
        </div>`
      : "";
    return `<div ${attrs}>
      ${playerRow(p1)}
      ${playerRow(p2)}
      ${actions}
    </div>`;
  }
  // completed
  const p1Winner = match.winner_name === match.player1_name;
  const p2Winner = match.winner_name === match.player2_name;
  const p1Champion = isFinal && championName === match.player1_name;
  const p2Champion = isFinal && championName === match.player2_name;
  return `<div ${attrs}>
    ${playerRow(match.player1_name, { winner: p1Winner, champion: p1Champion, crown: p1Winner, score: match.player1_score, showScore: true })}
    ${playerRow(match.player2_name, { winner: p2Winner, champion: p2Champion, crown: p2Winner, score: match.player2_score, showScore: true })}
  </div>`;
}

// A missing slot in the model: never rendered as a heavy card.
function placeholderCard(round, index) {
  return `<div class="tourn-match" data-state="future" data-placeholder data-round="${round}" data-index="${index}">
    ${playerRow(TBD)}
    ${playerRow(TBD)}
  </div>`;
}

// ---- Renderer ------------------------------------------------------------

// The grid stacks rounds left to right; each round's slots are `2^(r-1)`
// slot-units tall so match k of round r+1 centres between feeders 2k/2k+1.
// mode: "embedded" | "expanded" — identical markup apart from the flag.
export function renderBracket({ tournament, matches, lifecycle, mode = "embedded" }) {
  const finished = lifecycle === "completed" || lifecycle === "cancelled";
  const model = buildRoundModel(matches, tournament?.bracket_size);
  const slots = model.rounds[0]?.expected || 1;
  const championName = finished && tournament?.winner_name ? tournament.winner_name : null;
  const roundsHtml = model.rounds.map((round) => {
    const count = `${round.matches.length} ${round.matches.length === 1 ? "match" : "matches"}`;
    const body = round.matches.map(({ match, index }) =>
      `<div class="tourn-slot">${match
        ? matchCard(match, { finished, isFinal: round.number === model.totalRounds, championName })
        : placeholderCard(round.number, index)}</div>`).join("");
    return `<section class="tourn-round" style="--span:${2 ** (round.number - 1)}">
      <div class="tourn-round-head"><h3>${esc(round.label)}</h3><span>${esc(count)}</span></div>
      <div class="tourn-round-body">${body}</div>
    </section>`;
  }).join("");
  return `<div class="tourn-bracket" data-mode="${esc(mode)}">
    <div class="tourn-bracket-scroll">
      <div class="tourn-bracket-grid" style="--rounds:${model.totalRounds};--slots:${slots}">
        <svg class="tourn-connectors" aria-hidden="true"></svg>
        ${roundsHtml}
      </div>
    </div>
  </div>`;
}

// ---- Layout --------------------------------------------------------------

const GAP_PX = 16; // breathing room added to the tallest card when sizing a slot

// Measures the rendered cards, sizes `--tourn-slot`, and draws the SVG
// connectors (feeder (r,i) -> (r+1, floor(i/2))). Returns a dispose() that
// removes the ResizeObserver + window listener; re-render callers must
// dispose the previous layout first so observers never accumulate.
export function layoutBracket(root) {
  const grid = root?.querySelector(".tourn-bracket-grid");
  const svg = root?.querySelector(".tourn-connectors");
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
    for (const el of grid.querySelectorAll(".tourn-match[data-round]")) {
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
    for (const el of grid.querySelectorAll(".tourn-match")) {
      tallest = Math.max(tallest, el.getBoundingClientRect().height || 0);
    }
    if (tallest) grid.style.setProperty("--tourn-slot", `${Math.ceil(tallest + GAP_PX)}px`);
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
