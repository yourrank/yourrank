import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Check, Crown } from "lucide-react";
import { isBye } from "../../../lib/tournament-bracket.js";
import { Button } from "../../components/ui/button";
import type { ScoreHandler, ScoreRequestBody, Tournament, TournamentMatch } from "./types";

type Round = { number: number; label: string; expected: number; matches: { match: TournamentMatch | null; index: number }[] };
type Draft = { pick: 1 | 2 | null; s1: string; s2: string };
type Feedback = { text: string; error?: boolean; undo?: ScoreRequestBody; undoLabel?: string };
export type Decision = {
  winner: 1 | 2 | null;
  scores: [number, number] | null;
  error: string | null;
  hint: string | null;
};

const EMPTY_DRAFT: Draft = { pick: null, s1: "", s2: "" };
const UNDO_MS = 30_000;
const isTbd = (name: unknown) => !name || name === "TBD";
const LIVE_TAG = "tn-live-tag inline-flex items-center gap-[5px] text-[10px] font-bold tracking-[0.08em] text-primary before:size-[7px] before:shrink-0 before:animate-[tn-live-pulse_1.6s_ease-in-out_infinite] before:rounded-full before:bg-primary before:content-[''] motion-reduce:before:animate-none";

export function roundLabel(remainingPlayers: number) {
  if (remainingPlayers === 2) return "Final";
  if (remainingPlayers === 4) return "Semifinals";
  if (remainingPlayers === 8) return "Quarterfinals";
  return `Round of ${remainingPlayers}`;
}

function matchLabel(label: string, index: number) {
  if (label === "Final") return "Final";
  if (label === "Semifinals") return `Semifinal ${index + 1}`;
  if (label === "Quarterfinals") return `Quarterfinal ${index + 1}`;
  return `${label} match ${index + 1}`;
}

export function buildRoundModel(matches: TournamentMatch[], bracketSize: number) {
  const byRound = new Map<number, TournamentMatch[]>();
  for (const match of matches || []) {
    const round = Number(match.round_number) || 0;
    if (round < 1) continue;
    if (!byRound.has(round)) byRound.set(round, []);
    byRound.get(round)!.push(match);
  }
  for (const list of byRound.values()) list.sort((a, b) => a.match_index - b.match_index);
  const maxDataRound = Math.max(0, ...byRound.keys());
  const log2 = Number(bracketSize) >= 2 ? Math.log2(bracketSize) : NaN;
  const ideal = Number.isInteger(log2) ? log2 : maxDataRound;
  const totalRounds = Math.max(ideal, maxDataRound, byRound.size ? 1 : 0);
  const rounds: Round[] = [];
  for (let number = 1; number <= totalRounds; number += 1) {
    const expected = Number.isInteger(log2)
      ? Math.max(1, bracketSize / 2 ** number)
      : byRound.get(number)?.length || 0;
    const list = byRound.get(number) || [];
    const slots = [];
    for (let index = 0; index < Math.max(expected, list.length); index += 1) {
      slots.push({ match: list[index] || null, index });
    }
    rounds.push({ number, label: roundLabel(expected * 2), matches: slots, expected });
  }
  return { totalRounds, rounds };
}

// Names the match that feeds `slot` of the match at (roundNumber, index),
// e.g. "Semifinal 2" for the second finalist.
export function feederLabel(rounds: Round[], roundNumber: number, index: number, slot: 1 | 2) {
  const feeder = rounds[roundNumber - 2];
  if (!feeder) return null;
  return matchLabel(feeder.label, index * 2 + slot - 1);
}

function parseScore(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return { empty: true, value: null as number | null, valid: true };
  if (!/^\d{1,4}$/.test(trimmed)) return { empty: false, value: null, valid: false };
  return { empty: false, value: Number(trimmed), valid: true };
}

// One decision per match: an explicit Winner pick, entered scores, or both
// when they agree. Nothing here saves; the card asks for confirmation.
export function matchDecision(draft: Draft, names: [string, string]): Decision {
  const a = parseScore(draft.s1);
  const b = parseScore(draft.s2);
  if (!a.valid || !b.valid) return { winner: null, scores: null, error: "Scores must be whole numbers.", hint: null };
  if (a.empty && b.empty) {
    return draft.pick
      ? { winner: draft.pick, scores: null, error: null, hint: null }
      : { winner: null, scores: null, error: null, hint: "Pick the winner or enter scores." };
  }
  if (a.empty || b.empty) {
    return { winner: null, scores: null, error: null, hint: "Enter both scores, or clear them to pick a winner only." };
  }
  const scores: [number, number] = [a.value!, b.value!];
  if (scores[0] === scores[1]) {
    return { winner: null, scores, error: "Scores are tied. A match needs a winner, so change one score.", hint: null };
  }
  const derived: 1 | 2 = scores[0] > scores[1] ? 1 : 2;
  if (draft.pick && draft.pick !== derived) {
    const name = names[derived - 1];
    return { winner: null, scores, error: `These scores give the win to ${name}. Change the scores or pick ${name}.`, hint: null };
  }
  return { winner: derived, scores, error: null, hint: null };
}

export function resultText(names: [string, string], winner: 1 | 2, scores: [number, number] | null) {
  const name = names[winner - 1];
  if (!scores) return `${name} wins`;
  const won = scores[winner - 1];
  const lost = scores[winner === 1 ? 1 : 0];
  return `${name} wins ${won}–${lost}`;
}

function matchState(match: TournamentMatch, finished: boolean) {
  const bye1 = isBye(match.player1_name);
  const bye2 = isBye(match.player2_name);
  if (bye1 && bye2) return "void";
  if (bye1 || bye2) return "bye";
  if (match.status === "completed") return "completed";
  if (!finished && !isTbd(match.player1_name) && !isTbd(match.player2_name)) return "scorable";
  return "future";
}

function savedScores(match: TournamentMatch): [string, string] {
  return [String(match.player1_score ?? ""), String(match.player2_score ?? "")];
}

export function finalResult(tournament: Tournament, matches: TournamentMatch[]) {
  const champion = tournament?.winner_name ? String(tournament.winner_name) : "";
  if (!champion) return null;
  const totalRounds = Math.log2(Number(tournament.bracket_size) || 0);
  const final = (matches || []).find((match) => Number(match.round_number) === totalRounds && match.status === "completed");
  if (!final || isBye(final.player1_name) || isBye(final.player2_name)) return { champion, runnerUp: null, score: null };
  const championSlot = final.player1_name === champion ? 1 : final.player2_name === champion ? 2 : null;
  if (!championSlot) return { champion, runnerUp: null, score: null };
  const runnerUp = String(championSlot === 1 ? final.player2_name : final.player1_name);
  const won = Number(championSlot === 1 ? final.player1_score : final.player2_score) || 0;
  const lost = Number(championSlot === 1 ? final.player2_score : final.player1_score) || 0;
  return { champion, runnerUp, score: `${won}–${lost}` };
}

export function ChampionCard({ tournament, matches, id }: { tournament: Tournament; matches: TournamentMatch[]; id?: string }) {
  const result = finalResult(tournament, matches);
  if (!result) return null;
  return (
    <section className="tn-champion-card flex flex-wrap items-center gap-4 rounded-xl border border-amber-600/30 bg-amber-50 px-4 py-3.5 text-amber-950 sm:px-5" id={id} aria-label="Champion">
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-700"><Crown className="size-6" aria-hidden="true" /></span>
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-amber-800">Champion</p>
        <p className="m-0 truncate text-xl font-bold" data-champion-name>{result.champion}</p>
        {result.runnerUp && <p className="m-0 text-[13px] text-amber-900/80" data-champion-final>Won the final {result.score} against {result.runnerUp}</p>}
      </div>
      {result.runnerUp && (
        <dl className="m-0 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-[13px]">
          <dt className="text-amber-900/70">Final score</dt><dd className="m-0 font-mono font-bold" data-champion-score>{result.score}</dd>
          <dt className="text-amber-900/70">Runner-up</dt><dd className="m-0 font-semibold" data-runner-up>{result.runnerUp}</dd>
        </dl>
      )}
    </section>
  );
}

type RowEditor = {
  matchId: string;
  value: string;
  picked: boolean;
  invalid: boolean;
  describedBy: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onPick: () => void;
};

function MatchRow({
  player,
  name,
  seed,
  score,
  winner,
  champion,
  muted,
  placeholder,
  editor,
}: {
  player: 1 | 2;
  name: string;
  seed: number | null;
  score?: unknown;
  winner?: boolean;
  champion?: boolean;
  muted?: boolean;
  placeholder?: boolean;
  editor?: RowEditor;
}) {
  const className = [
    "tn-match-row flex min-h-9 items-center gap-1.5 border-b border-border px-2.5 py-1 last:border-b-0",
    winner ? "is-winner bg-accent" : "",
    champion ? "is-champion bg-amber-100/70" : "",
    muted ? "is-muted" : "",
    editor?.picked ? "is-picked bg-accent" : "",
  ].filter(Boolean).join(" ");
  return (
    <div className={className}>
      {seed !== null && <span className="tn-match-seed min-w-4 shrink-0 text-right font-mono text-[11px] font-semibold text-muted-foreground">{seed}</span>}
      <span className={`tn-match-name flex min-w-0 flex-1 items-center gap-1 text-[13px] font-medium ${muted || placeholder ? "text-muted-foreground" : ""} ${placeholder ? "text-xs italic" : ""}`} title={name}>
        {winner && !editor && <Crown className={`tn-crown size-3.5 shrink-0 ${champion ? "text-amber-700" : "text-primary"}`} aria-hidden="true" />}
        <span className="truncate">{name}</span>
      </span>
      {editor ? (
        <>
          <input
            type="number"
            min="0"
            inputMode="numeric"
            placeholder="–"
            className="tn-match-input h-8 w-11 shrink-0 rounded-md border border-input bg-card px-1 text-center font-mono text-sm font-semibold placeholder:text-muted-foreground aria-[invalid=true]:border-red-600 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            data-score-match={editor.matchId}
            data-score-player={player}
            value={editor.value}
            aria-label={`${name} score`}
            aria-invalid={editor.invalid || undefined}
            aria-describedby={editor.describedBy}
            disabled={editor.disabled}
            onChange={(event) => editor.onChange(event.currentTarget.value)}
          />
          <button
            type="button"
            className={`tn-match-pick inline-flex h-8 shrink-0 items-center gap-1 rounded-md border px-2 text-[11px] font-bold focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:opacity-50 ${editor.picked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card text-foreground hover:border-primary hover:text-primary"}`}
            data-pick-match={editor.matchId}
            data-winner-slot={player}
            aria-pressed={editor.picked}
            aria-label={`Winner: ${name}`}
            disabled={editor.disabled}
            onClick={editor.onPick}
          >
            {editor.picked && <Check className="size-3" aria-hidden="true" />}
            Winner
          </button>
        </>
      ) : (
        !placeholder && <span className="tn-match-score min-w-4 shrink-0 text-right font-mono text-[13px] font-bold text-muted-foreground">{String(score ?? "–")}</span>
      )}
    </div>
  );
}

type CardContext = {
  mode: "embedded" | "expanded";
  finished: boolean;
  championName: string | null;
  liveId: string | null;
  nextId: string | null;
  label: string;
  feeders: [string | null, string | null];
  draft: Draft | null;
  correcting: boolean;
  pending: boolean;
  feedback: Feedback | null;
  undoAvailable: boolean;
  onDraft: (next: Draft) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onCorrect: () => void;
  onUndo: () => void;
};

function MatchCard({ match, isFinal, ctx }: { match: TournamentMatch; isFinal: boolean; ctx: CardContext }) {
  const id = String(match.id);
  const state = matchState(match, ctx.finished);
  const embedded = ctx.mode === "embedded";
  const realCompleted = state === "completed";
  const correctable = realCompleted && Boolean(match.correctable) && embedded && !ctx.finished;
  const seedBase = Number(match.round_number) === 1 ? match.match_index * 2 + 1 : null;
  const live = ctx.liveId === id;
  const next = ctx.nextId === id;
  const editing = embedded && ((state === "scorable") || (correctable && ctx.correcting));
  const attrs = {
    className: `tn-match relative flex w-full flex-col overflow-hidden rounded-lg border border-border bg-card ${isFinal ? "tn-match--final border-primary shadow-[0_0_0_3px_var(--accent),0_8px_20px_rgb(17_24_39_/_0.10)]" : ""} ${live ? "border-2 border-primary shadow-[0_0_0_4px_var(--accent)]" : ""} ${next ? "border-primary/60" : ""}`,
    "data-state": state,
    "data-match-id": match.id,
    "data-round": match.round_number,
    "data-index": match.match_index,
    "aria-label": `${ctx.label}${live ? ", live now" : next ? ", up next" : ""}`,
    role: "group",
    ...(realCompleted && match.correctable ? { "data-correctable": "true" } : {}),
    ...(correctable ? { "data-score-mode": "correct", "data-saved": `${match.player1_score ?? 0},${match.player2_score ?? 0}` } : {}),
    ...(live ? { "data-live": "true" } : {}),
    ...(next ? { "data-next": "true" } : {}),
  };
  const feedback = embedded && ctx.feedback ? (
    <div className={`tn-match-feedback flex items-center gap-2 border-t border-border px-2.5 py-1.5 text-[12px] outline-none ${ctx.feedback.error ? "text-red-700" : "text-foreground"}`} data-match-feedback={id} tabIndex={-1}>
      <span className="min-w-0 flex-1">{ctx.feedback.text}</span>
      {ctx.undoAvailable && (
        <Button type="button" variant="outline" size="sm" className="tn-match-undo h-7 px-2 text-[12px] font-semibold" data-undo-match={id} aria-label={ctx.feedback.undoLabel || "Undo"} disabled={ctx.pending} onClick={ctx.onUndo}>
          Undo
        </Button>
      )}
    </div>
  ) : null;
  const head = (live || next || (editing && ctx.correcting)) ? (
    <div className="tn-match-head flex items-center justify-between gap-2 px-2.5 pt-1.5">
      {live ? <span className={LIVE_TAG}>LIVE</span> : next ? <span className="tn-next-tag text-[10px] font-bold tracking-[0.08em] text-muted-foreground">UP NEXT</span> : <span className="text-[10px] font-bold tracking-[0.08em] text-muted-foreground">CORRECTING</span>}
      <span className="truncate text-[11px] text-muted-foreground">{ctx.label}</span>
    </div>
  ) : null;

  if (state === "void" || (state === "future" && isTbd(match.player1_name) && isTbd(match.player2_name))) {
    const label = state === "void" ? "BYE" : "TBD";
    return (
      <div {...attrs}>
        <div className="tn-match-line flex items-center justify-between gap-2 rounded-md border border-dashed border-border px-2.5 py-1.5 text-xs text-muted-foreground">
          {seedBase !== null && <span className="tn-match-seed">{seedBase}</span>}
          <span className="tn-match-name flex-1">{label}</span><span className="tn-match-name">{label}</span>
        </div>
      </div>
    );
  }
  if (state === "future") {
    const rows = ([1, 2] as const).map((player) => {
      const name = player === 1 ? match.player1_name : match.player2_name;
      const known = !isTbd(name);
      const feeder = ctx.feeders[player - 1];
      return <MatchRow key={player} player={player} name={known ? String(name) : feeder ? `Winner of ${feeder}` : "TBD"} seed={null} placeholder={!known} />;
    });
    return <div {...attrs}>{head}{rows}</div>;
  }
  if (state === "bye") {
    const player: 1 | 2 = isBye(match.player1_name) ? 2 : 1;
    const name = String(player === 1 ? match.player1_name : match.player2_name);
    const seed = seedBase === null ? null : seedBase + player - 1;
    const winner = match.status === "completed" && match.winner_name === name;
    const champion = isFinal && ctx.championName === name;
    return (
      <div {...attrs}>
        <div className="tn-match-line flex items-center justify-between gap-2 rounded-md border border-dashed border-border px-2.5 py-1.5 text-xs text-muted-foreground">
          {seed !== null && <span className="tn-match-seed">{seed}</span>}
          <span className={`tn-match-name flex-1 ${winner || champion ? "is-winner font-semibold text-foreground" : ""} ${champion ? "is-champion text-amber-700" : ""}`}>
            {champion && <Crown className="tn-crown size-3.5 text-amber-700" aria-hidden="true" />}{name}
          </span>
          {champion ? <span className="tn-match-adv text-[11px] text-muted-foreground">champion</span> : <span className="tn-bye-tag rounded border border-border px-1.5 py-px text-[10px] font-bold">BYE</span>}
        </div>
      </div>
    );
  }

  const p1 = String(match.player1_name);
  const p2 = String(match.player2_name);
  const names: [string, string] = [p1, p2];

  if (editing) {
    const draft = ctx.draft || EMPTY_DRAFT;
    const decision = matchDecision(draft, names);
    const [saved1, saved2] = savedScores(match);
    const unchanged = ctx.correcting && decision.winner !== null
      && String(decision.scores?.[0] ?? "") === saved1 && String(decision.scores?.[1] ?? "") === saved2;
    const winnerChanges = ctx.correcting && decision.winner !== null && names[decision.winner - 1] !== match.winner_name;
    const canConfirm = decision.winner !== null && !unchanged && !ctx.pending;
    const msgId = `tn-match-msg-${id}`;
    const summary = decision.winner ? `${resultText(names, decision.winner, decision.scores)}?` : "";
    const message = decision.error
      ? <span className="text-red-700" data-match-error>{decision.error}</span>
      : unchanged
        ? <span className="text-muted-foreground">Change a score or the winner to correct this result.</span>
        : decision.winner
          ? <><b className="text-foreground" data-match-pending>{summary}</b>{winnerChanges && <span className="text-muted-foreground"> Later rounds update.</span>}</>
          : <span className="text-muted-foreground">{decision.hint}</span>;
    const editor = (player: 1 | 2): RowEditor => ({
      matchId: id,
      value: player === 1 ? draft.s1 : draft.s2,
      picked: decision.winner === player || (decision.winner === null && draft.pick === player && !decision.error),
      invalid: Boolean(decision.error),
      describedBy: msgId,
      disabled: ctx.pending,
      onChange: (value) => ctx.onDraft({ ...draft, [player === 1 ? "s1" : "s2"]: value }),
      onPick: () => {
        const derived = decision.scores && decision.scores[0] !== decision.scores[1] ? (decision.scores[0] > decision.scores[1] ? 1 : 2) : null;
        const active = draft.pick === player || (draft.pick === null && derived === player);
        if (active) ctx.onDraft({ pick: null, s1: draft.pick === player ? draft.s1 : "", s2: draft.pick === player ? draft.s2 : "" });
        else if (derived !== null && derived !== player) ctx.onDraft({ pick: player, s1: "", s2: "" });
        else ctx.onDraft({ ...draft, pick: player });
      },
    });
    return (
      <div {...attrs} data-editing="true">
        {head}
        <MatchRow player={1} name={p1} seed={seedBase} editor={editor(1)} />
        <MatchRow player={2} name={p2} seed={seedBase === null ? null : seedBase + 1} editor={editor(2)} />
        <div className="tn-match-decision flex items-center gap-1.5 border-t border-border px-2.5 py-1.5">
          <p className="tn-match-msg m-0 min-w-0 flex-1 text-[12px] leading-tight" id={msgId}>{message}</p>
          {ctx.correcting && (
            <Button type="button" variant="ghost" size="sm" className="tn-match-cancel h-8 px-2 text-[12px]" data-cancel-match={id} disabled={ctx.pending} onClick={ctx.onCancel}>
              Cancel
            </Button>
          )}
          <Button
            type="button"
            variant="default"
            size="sm"
            className="tn-match-save h-8 rounded-md bg-primary px-2.5 text-[12px] font-bold text-primary-foreground hover:bg-primary/90"
            data-score-match={id}
            disabled={!canConfirm}
            aria-label={canConfirm ? `Confirm result: ${summary.slice(0, -1)}` : "Confirm result"}
            aria-describedby={msgId}
            onClick={ctx.onConfirm}
          >
            {ctx.pending ? "Saving…" : "Confirm"}
          </Button>
        </div>
        {feedback}
      </div>
    );
  }

  const p1Winner = match.winner_name === match.player1_name;
  const p2Winner = match.winner_name === match.player2_name;
  const p1Champion = isFinal && ctx.championName === match.player1_name;
  const p2Champion = isFinal && ctx.championName === match.player2_name;
  const showCorrect = correctable && !ctx.undoAvailable;
  const locked = embedded && realCompleted && !match.correctable && !ctx.finished;
  return (
    <div {...attrs}>
      {head}
      <MatchRow player={1} name={p1} seed={seedBase} score={match.player1_score ?? 0} winner={p1Winner} champion={p1Champion} muted={p2Winner} />
      <MatchRow player={2} name={p2} seed={seedBase === null ? null : seedBase + 1} score={match.player2_score ?? 0} winner={p2Winner} champion={p2Champion} muted={p1Winner} />
      {feedback}
      {!feedback && showCorrect && (
        <div className="tn-match-actions flex justify-end border-t border-border px-1.5 py-1">
          <Button type="button" variant="ghost" size="sm" className="tn-match-correct h-7 px-2 text-[12px] font-semibold text-muted-foreground hover:text-foreground" data-correct-match={id} aria-label={`Correct result: ${p1} vs ${p2}`} onClick={ctx.onCorrect}>
            Correct result
          </Button>
        </div>
      )}
      {!feedback && locked && (
        <p className="tn-match-locked m-0 border-t border-border px-2.5 py-1.5 text-[11px] text-muted-foreground" data-locked-note={id}>
          Locked: a later match has been played. Correct that one first.
        </p>
      )}
    </div>
  );
}

const cardSelector = (id: string) => `.tn-match[data-match-id="${id.replace(/["\\]/g, "\\$&")}"]`;

export function Bracket({
  tournament,
  matches,
  lifecycle,
  mode = "embedded",
  onScore,
}: {
  tournament: Tournament;
  matches: TournamentMatch[];
  lifecycle: string;
  mode?: "embedded" | "expanded";
  onScore?: ScoreHandler;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(new Set<string>());
  const focusRef = useRef<{ id: string; kind: "undo" | "pick" | "correct" | "feedback" } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [correcting, setCorrecting] = useState<string[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<Record<string, Feedback & { until?: number }>>({});
  const [announcement, setAnnouncement] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const finished = lifecycle === "finished" || lifecycle === "cancelled";
  const embedded = mode === "embedded";
  const model = useMemo(() => buildRoundModel(matches, Number(tournament?.bracket_size)), [matches, tournament?.bracket_size]);
  const rows = Math.max(1, ...model.rounds.map((round) => round.matches.length * 2 ** (round.number - 1)));
  const championName = finished && tournament?.winner_name ? String(tournament.winner_name) : null;
  const ordered = useMemo(
    () => [...(matches || [])].sort((a, b) => a.round_number - b.round_number || a.match_index - b.match_index),
    [matches],
  );
  const scorable = lifecycle === "live" ? ordered.filter((match) => matchState(match, false) === "scorable") : [];
  const liveMatch = scorable[0] || null;
  const nextMatch = scorable[1] || null;
  const liveId = liveMatch ? String(liveMatch.id) : null;
  const nextId = nextMatch ? String(nextMatch.id) : null;
  const hasBye = matches.some((match) => isBye(match.player1_name) || isBye(match.player2_name));
  const labelOf = (match: TournamentMatch) => {
    const round = model.rounds[Number(match.round_number) - 1];
    return round ? matchLabel(round.label, match.match_index) : `Match ${match.match_index + 1}`;
  };

  useLayoutEffect(() => {
    const grid = rootRef.current?.querySelector<HTMLElement>(".tn-bracket-grid");
    const svg = rootRef.current?.querySelector<SVGSVGElement>(".tn-connectors");
    if (!grid || !svg) return;
    const win = grid.ownerDocument.defaultView;
    let frame = 0;
    const draw = () => {
      frame = 0;
      const rect = grid.getBoundingClientRect();
      svg.setAttribute("viewBox", `0 0 ${Math.max(0, rect.width)} ${Math.max(0, rect.height)}`);
      const cards = new Map<string, HTMLElement>();
      for (const el of grid.querySelectorAll<HTMLElement>(".tn-match[data-round]")) {
        cards.set(`${el.dataset.round}:${el.dataset.index}`, el);
      }
      let maxRound = 0;
      for (const key of cards.keys()) maxRound = Math.max(maxRound, Number(key.split(":")[0]));
      const lines: { d: string; from: string; to: string; dashed: boolean }[] = [];
      for (const [from, card] of cards) {
        const round = Number(card.dataset.round);
        if (round >= maxRound) continue;
        const to = `${round + 1}:${Math.floor(Number(card.dataset.index) / 2)}`;
        const target = cards.get(to);
        if (!target) continue;
        const a = card.getBoundingClientRect();
        const b = target.getBoundingClientRect();
        const x1 = Math.round(a.right - rect.left);
        const y1 = Math.round(a.top + a.height / 2 - rect.top);
        const x2 = Math.round(b.left - rect.left);
        const y2 = Math.round(b.top + b.height / 2 - rect.top);
        const mid = Math.round(x1 + (x2 - x1) / 2);
        lines.push({ d: rect.width && a.width ? `M ${x1} ${y1} L ${mid} ${y1} L ${mid} ${y2} L ${x2} ${y2}` : "", from, to, dashed: ["bye", "void"].includes(card.dataset.state || "") });
      }
      svg.replaceChildren(...lines.map(({ d, from, to, dashed }) => {
        const path = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", d);
        path.setAttribute("data-from", from);
        path.setAttribute("data-to", to);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "currentColor");
        path.setAttribute("stroke-width", "2");
        path.setAttribute("stroke-linejoin", "miter");
        path.setAttribute("stroke-linecap", "butt");
        if (dashed) {
          path.setAttribute("class", "is-bye");
          path.setAttribute("stroke-dasharray", "4 4");
          path.setAttribute("opacity", "0.5");
        }
        return path;
      }));
    };
    const schedule = () => {
      if (frame) return;
      frame = win?.requestAnimationFrame ? win.requestAnimationFrame(draw) : win?.setTimeout(draw, 0) as unknown as number;
    };
    draw();
    const observer = win && "ResizeObserver" in win ? new win.ResizeObserver(schedule) : null;
    if (observer) {
      observer.observe(grid);
      for (const card of grid.querySelectorAll(".tn-match")) observer.observe(card);
    }
    win?.addEventListener("resize", schedule);
    return () => {
      if (frame) {
        if (win?.cancelAnimationFrame) win.cancelAnimationFrame(frame);
        else win?.clearTimeout(frame);
      }
      observer?.disconnect();
      win?.removeEventListener("resize", schedule);
    };
  }, [matches, mode, drafts, correcting, feedback]);

  useEffect(() => {
    const target = focusRef.current;
    if (!target || !rootRef.current) return;
    const card = rootRef.current.querySelector<HTMLElement>(cardSelector(target.id));
    if (!card) return;
    const selector = {
      undo: "[data-undo-match]",
      pick: "[data-pick-match]",
      correct: "[data-correct-match]",
      feedback: "[data-match-feedback]",
    }[target.kind];
    const element = card.querySelector<HTMLElement>(selector) || card.querySelector<HTMLElement>("[data-match-feedback]");
    if (element) {
      element.focus();
      focusRef.current = null;
    }
  });

  const undoDeadline = Math.min(Infinity, ...Object.values(feedback).map((item) => (item.undo && item.until) || Infinity));
  useEffect(() => {
    if (!Number.isFinite(undoDeadline)) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, undoDeadline - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [undoDeadline]);

  function setBusy(id: string, busy: boolean) {
    if (busy) pendingRef.current.add(id);
    else pendingRef.current.delete(id);
    setPending([...pendingRef.current]);
  }

  function report(id: string, next: (Feedback & { until?: number }) | null) {
    setFeedback((current) => {
      const copy: Record<string, Feedback & { until?: number }> = {};
      for (const [key, value] of Object.entries(current)) {
        if (key === id) continue;
        if (!next?.undo) copy[key] = value;
        else if (!value.error) copy[key] = { text: value.text };
      }
      if (next) copy[id] = next;
      return copy;
    });
    if (next) setAnnouncement(next.text);
  }

  async function confirm(match: TournamentMatch) {
    const id = String(match.id);
    if (!onScore || pendingRef.current.has(id)) return;
    const names: [string, string] = [String(match.player1_name), String(match.player2_name)];
    const isCorrection = correcting.includes(id) && match.status === "completed";
    const decision = matchDecision(drafts[id] || EMPTY_DRAFT, names);
    if (!decision.winner) return;
    const scores: [number, number] | null = decision.scores || (isCorrection ? (decision.winner === 1 ? [1, 0] : [0, 1]) : null);
    const body: ScoreRequestBody = scores
      ? { matchId: id, player1Score: scores[0], player2Score: scores[1] }
      : { matchId: id, winnerSlot: decision.winner };
    const undo: ScoreRequestBody = isCorrection
      ? { matchId: id, player1Score: Number(match.player1_score) || 0, player2Score: Number(match.player2_score) || 0 }
      : { matchId: id, reopen: true };
    setBusy(id, true);
    const outcome = await onScore(isCorrection ? "PATCH" : "POST", body);
    setBusy(id, false);
    if (!outcome.ok) {
      report(id, { text: outcome.message, error: true });
      return;
    }
    setDrafts((current) => {
      const copy = { ...current };
      delete copy[id];
      return copy;
    });
    setCorrecting((current) => current.filter((item) => item !== id));
    const result = resultText(names, decision.winner, scores);
    report(id, {
      text: `${isCorrection ? "Corrected" : "Saved"}: ${result}.`,
      undo,
      undoLabel: `Undo result: ${names[0]} vs ${names[1]}`,
      until: Date.now() + UNDO_MS,
    });
    setNow(Date.now());
    focusRef.current = { id, kind: "undo" };
  }

  async function undo(match: TournamentMatch) {
    const id = String(match.id);
    const item = feedback[id];
    if (!onScore || !item?.undo || pendingRef.current.has(id)) return;
    setBusy(id, true);
    const outcome = await onScore("PATCH", item.undo);
    setBusy(id, false);
    if (!outcome.ok) {
      report(id, { text: outcome.message, error: true });
      focusRef.current = { id, kind: "feedback" };
      return;
    }
    const reopened = "reopen" in item.undo;
    report(id, { text: reopened ? "Result undone. Pick the winner again." : "Correction undone. The previous result is back." });
    focusRef.current = { id, kind: reopened ? "pick" : "feedback" };
  }

  const contextFor = (match: TournamentMatch, roundNumber: number, index: number): CardContext => {
    const id = String(match.id);
    const item = feedback[id] || null;
    const isCorrecting = correcting.includes(id);
    return {
      mode,
      finished,
      championName,
      liveId,
      nextId,
      label: labelOf(match),
      feeders: [feederLabel(model.rounds, roundNumber, index, 1), feederLabel(model.rounds, roundNumber, index, 2)],
      draft: drafts[id] || null,
      correcting: isCorrecting,
      pending: pending.includes(id),
      feedback: item,
      undoAvailable: Boolean(item?.undo && item.until && item.until > now && match.status === "completed" && match.correctable),
      onDraft: (next) => {
        setDrafts((current) => ({ ...current, [id]: next }));
        setFeedback((current) => {
          if (!current[id]) return current;
          const copy = { ...current };
          delete copy[id];
          return copy;
        });
      },
      onConfirm: () => void confirm(match),
      onCancel: () => {
        setCorrecting((current) => current.filter((value) => value !== id));
        setDrafts((current) => {
          const copy = { ...current };
          delete copy[id];
          return copy;
        });
        focusRef.current = { id, kind: "correct" };
      },
      onCorrect: () => {
        const [s1, s2] = savedScores(match);
        setDrafts((current) => ({ ...current, [id]: { pick: null, s1, s2 } }));
        setCorrecting((current) => current.includes(id) ? current : [...current, id]);
        setFeedback((current) => {
          if (!current[id]) return current;
          const copy = { ...current };
          delete copy[id];
          return copy;
        });
        focusRef.current = { id, kind: "pick" };
      },
      onUndo: () => void undo(match),
    };
  };

  const jumpToLive = () => {
    const card = liveId ? rootRef.current?.querySelector<HTMLElement>(cardSelector(liveId)) : null;
    if (!card) return;
    card.scrollIntoView?.({ block: "nearest", inline: "center" });
    card.querySelector<HTMLElement>("[data-pick-match]")?.focus();
  };
  const versus = (match: TournamentMatch) => `${match.player1_name} vs ${match.player2_name}`;

  return (
    <div className="tn-bracket min-w-0" data-mode={mode} ref={rootRef}>
      {liveMatch && (
        <div className="tn-now mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-border bg-accent/60 px-3 py-2 text-[13px]" data-now>
          <span className="inline-flex min-w-0 items-center gap-2">
            <span className={LIVE_TAG}>LIVE</span>
            <span className="min-w-0"><b data-now-match>{versus(liveMatch)}</b> <span className="text-muted-foreground">· {labelOf(liveMatch)}</span></span>
          </span>
          {nextMatch && (
            <span className="min-w-0 text-muted-foreground" data-next-match>
              Up next: <span className="font-medium text-foreground">{versus(nextMatch)}</span> · {labelOf(nextMatch)}
            </span>
          )}
          {embedded && onScore && (
            <Button type="button" variant="outline" size="sm" className="tn-now-jump ml-auto h-7 px-2.5 text-[12px]" onClick={jumpToLive}>
              Go to live match
            </Button>
          )}
        </div>
      )}
      {hasBye && <p className="tn-bracket-note mb-2.5 text-xs text-muted-foreground" data-bye-note>Fewer players than spots, so some players get a BYE and advance automatically.</p>}
      {embedded && <p className="sr-only" aria-live="polite" data-bracket-announcer>{announcement}</p>}
      <div className="tn-bracket-scroll overflow-x-auto px-0.5 py-0.5 pb-1.5">
        <div
          className={`tn-bracket-grid relative grid min-w-max gap-y-2.5 ${mode === "expanded" ? "gap-x-16" : "gap-x-10"}`}
          style={{
            gridTemplateColumns: `repeat(${model.totalRounds || 1}, ${mode === "expanded" ? "280px" : "236px"})`,
            gridTemplateRows: `auto repeat(${rows}, auto)`,
          } as CSSProperties}
        >
          <svg className="tn-connectors pointer-events-none absolute inset-0 size-full overflow-visible text-muted-foreground" aria-hidden="true" />
          {model.rounds.map((round) => {
            const finalRound = round.number === model.totalRounds;
            const span = 2 ** (round.number - 1);
            return (
              <section
                className="tn-round grid"
                key={round.number}
                aria-label={round.label}
                style={{ gridColumn: round.number, gridRow: `1 / span ${rows + 1}`, gridTemplateRows: "subgrid" } as CSSProperties}
              >
                <div className="tn-round-head flex flex-col items-center gap-px self-end pb-0.5 text-center">
                  <h3 className="m-0 text-[13px] font-bold">{round.label}</h3>
                  <span className="text-[11px] text-muted-foreground">{round.matches.length} {round.matches.length === 1 ? "match" : "matches"}</span>
                </div>
                {round.matches.map(({ match, index }) => {
                  const waiting = finalRound && model.totalRounds >= 2 && (!match || isTbd(match.player1_name) || isTbd(match.player2_name));
                  let card;
                  if (waiting) {
                    const known = match ? [match.player1_name, match.player2_name].find((name) => !isTbd(name)) : null;
                    const missingSlot: 1 | 2 = match && !isTbd(match.player1_name) ? 2 : 1;
                    const missing = feederLabel(model.rounds, round.number, index, missingSlot);
                    card = known ? (
                      <div className="tn-match tn-match-waiting tn-match--final flex w-full flex-col overflow-hidden rounded-lg border border-dashed border-primary bg-card" data-state="waiting" data-round={round.number} data-index={index} data-match-id={match?.id} role="group" aria-label="Final">
                        <MatchRow player={missingSlot === 2 ? 1 : 2} name={String(known)} seed={null} />
                        <MatchRow player={missingSlot} name={missing ? `Waiting for winner of ${missing}` : "Waiting for the other finalist"} seed={null} placeholder />
                      </div>
                    ) : (
                      <div className="tn-match tn-match-waiting flex flex-col gap-0.5 rounded-lg border border-dashed border-border p-2.5 text-center" data-state="waiting" data-round={round.number} data-index={index} data-match-id={match?.id}>
                        <b className="text-xs">Waiting for semifinalists</b><span className="text-[11px] text-muted-foreground">The final appears when both semifinals are decided.</span>
                      </div>
                    );
                  } else if (match) {
                    card = <MatchCard match={match} isFinal={finalRound} ctx={contextFor(match, round.number, index)} />;
                  } else {
                    card = (
                      <div className="tn-match w-full" data-state="future" data-placeholder="" data-round={round.number} data-index={index}>
                        <div className="tn-match-line flex items-center justify-between rounded-md border border-dashed border-border px-2.5 py-1.5 text-xs text-muted-foreground">
                          {round.number === 1 && <span className="tn-match-seed">{index * 2 + 1}</span>}<span className="tn-match-name">TBD</span><span className="tn-match-name">TBD</span>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div
                      className="tn-slot flex items-center"
                      key={`${round.number}:${index}`}
                      style={{ gridRow: `${2 + index * span} / span ${span}` } as CSSProperties}
                    >
                      {card}
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
