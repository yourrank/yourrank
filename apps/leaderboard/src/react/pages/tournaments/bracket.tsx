import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Crown } from "lucide-react";
import { isBye } from "../../../lib/tournament-bracket.js";
import { Button } from "../../components/ui/button";
import type { Tournament, TournamentMatch } from "./types";

type Round = { number: number; label: string; expected: number; matches: { match: TournamentMatch | null; index: number }[] };

const isTbd = (name: unknown) => !name || name === "TBD";

export function roundLabel(remainingPlayers: number) {
  if (remainingPlayers === 2) return "Final";
  if (remainingPlayers === 4) return "Semifinals";
  if (remainingPlayers === 8) return "Quarterfinals";
  return `Round of ${remainingPlayers}`;
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

function matchState(match: TournamentMatch, finished: boolean) {
  const bye1 = isBye(match.player1_name);
  const bye2 = isBye(match.player2_name);
  if (bye1 && bye2) return "void";
  if (bye1 || bye2) return "bye";
  if (match.status === "completed") return "completed";
  if (!finished && !isTbd(match.player1_name) && !isTbd(match.player2_name)) return "scorable";
  return "future";
}

function MatchRow({
  match,
  player,
  name,
  seed,
  score,
  winner,
  champion,
  muted,
  editable,
  scoreValue,
  onScoreChange,
  onAdvance,
  advanceDisabled,
}: {
  match: TournamentMatch;
  player: 1 | 2;
  name: string;
  seed: number | null;
  score: unknown;
  winner?: boolean;
  champion?: boolean;
  muted?: boolean;
  editable?: boolean;
  scoreValue: string;
  onScoreChange: (matchId: string, player: 1 | 2, value: string) => void;
  onAdvance?: (match: TournamentMatch, player: 1 | 2) => void;
  advanceDisabled?: boolean;
}) {
  const canPick = editable && onAdvance;
  const className = [
    "tn-match-row flex items-center gap-2 border-b border-border px-2.5 py-2 last:border-b-0",
    winner ? "is-winner bg-accent" : "",
    champion ? "is-champion bg-amber-100/70" : "",
    muted ? "is-muted" : "",
  ].filter(Boolean).join(" ");
  return (
    <div className={className}>
      {seed !== null && <span className="tn-match-seed min-w-4 shrink-0 text-right font-mono text-[11px] font-semibold text-muted-foreground">{seed}</span>}
      {canPick ? (
        <button
          type="button"
          className="tn-match-name tn-match-pick flex min-w-0 flex-1 items-center gap-1 text-left text-[13px] font-medium hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
          data-advance-match={match.id}
          data-winner-slot={player}
          aria-label={`${name} wins`}
          disabled={advanceDisabled}
          onClick={() => onAdvance(match, player)}
        >
          {name}
        </button>
      ) : (
        <span className={`tn-match-name flex min-w-0 flex-1 items-center gap-1 text-[13px] font-medium ${muted ? "text-muted-foreground" : ""}`}>
          {winner && <Crown className={`tn-crown size-3.5 ${champion ? "text-amber-700" : "text-primary"}`} aria-hidden="true" />}
          {name}
        </span>
      )}
      {editable ? (
        <input
          type="number"
          min="0"
          className="tn-match-input h-9 w-14 shrink-0 rounded-md border border-input bg-card px-1.5 text-center font-mono text-sm font-semibold"
          data-score-match={match.id}
          data-score-player={player}
          value={scoreValue}
          aria-label={`${name} score`}
          onChange={(event) => onScoreChange(String(match.id), player, event.currentTarget.value)}
        />
      ) : (
        <span className="tn-match-score min-w-4 shrink-0 text-right font-mono text-[13px] font-bold text-muted-foreground">{String(score ?? "–")}</span>
      )}
    </div>
  );
}

function MatchCard({
  match,
  isFinal,
  finished,
  championName,
  liveId,
  mode,
  advanceDisabled,
  onScoreChange,
  scoreValue,
  onSubmit,
  onAdvance,
}: {
  match: TournamentMatch;
  isFinal: boolean;
  finished: boolean;
  championName: string | null;
  liveId: string | number | null;
  mode: "embedded" | "expanded";
  advanceDisabled: (id: string) => boolean;
  onScoreChange: (matchId: string, player: 1 | 2, value: string) => void;
  scoreValue: (matchId: string, player: 1 | 2, fallback?: string) => string;
  onSubmit: (matchId: string) => void;
  onAdvance?: (match: TournamentMatch, player: 1 | 2) => void;
}) {
  const state = matchState(match, finished);
  const editable = mode === "embedded" && !finished;
  const correctable = state === "completed" && Boolean(match.correctable) && editable;
  const seedBase = Number(match.round_number) === 1 ? match.match_index * 2 + 1 : null;
  const live = liveId != null && String(match.id) === String(liveId);
  const attrs = {
    className: `tn-match relative flex w-full flex-col overflow-hidden rounded-lg border border-border bg-card ${isFinal ? "tn-match--final border-primary shadow-[0_0_0_3px_var(--accent),0_8px_20px_rgb(17_24_39_/_0.10)]" : ""} ${live ? "border-2 border-primary shadow-[0_0_0_4px_var(--accent)]" : ""} ${mode === "expanded" ? "max-w-[340px]" : ""}`,
    "data-state": state,
    "data-match-id": match.id,
    "data-round": match.round_number,
    "data-index": match.match_index,
    ...(state === "completed" && match.correctable ? { "data-correctable": "true" } : {}),
    ...(correctable ? { "data-score-mode": "correct", "data-saved": `${match.player1_score ?? 0},${match.player2_score ?? 0}` } : {}),
    ...(live ? { "data-live": "true" } : {}),
  };
  if (state === "void" || state === "future") {
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
  if (state === "bye") {
    const player: 1 | 2 = isBye(match.player1_name) ? 2 : 1;
    const name = String(player === 1 ? match.player1_name : match.player2_name);
    const seed = seedBase === null ? null : seedBase + player - 1;
    const winner = match.status === "completed" && match.winner_name === name;
    const champion = isFinal && championName === name;
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

  if (state === "scorable" || correctable) {
    const p1 = String(match.player1_name);
    const p2 = String(match.player2_name);
    const saved1 = String(match.player1_score ?? 0);
    const saved2 = String(match.player2_score ?? 0);
    const current1 = scoreValue(String(match.id), 1, saved1);
    const current2 = scoreValue(String(match.id), 2, saved2);
    return (
      <div {...attrs}>
        {live && <span className="tn-live-tag mx-2.5 mt-2 inline-flex items-center gap-[5px] text-[10px] font-bold tracking-[0.08em] text-primary before:size-[7px] before:shrink-0 before:animate-[tn-live-pulse_1.6s_ease-in-out_infinite] before:rounded-full before:bg-primary before:content-[''] motion-reduce:before:animate-none">LIVE</span>}
        <MatchRow match={match} player={1} name={p1} seed={seedBase} score={match.player1_score} winner={correctable && match.winner_name === p1} editable={editable} scoreValue={scoreValue(String(match.id), 1, saved1)} onScoreChange={onScoreChange} onAdvance={state === "scorable" ? onAdvance : undefined} advanceDisabled={advanceDisabled(String(match.id))} />
        <MatchRow match={match} player={2} name={p2} seed={seedBase === null ? null : seedBase + 1} score={match.player2_score} winner={correctable && match.winner_name === p2} editable={editable} scoreValue={scoreValue(String(match.id), 2, saved2)} onScoreChange={onScoreChange} onAdvance={state === "scorable" ? onAdvance : undefined} advanceDisabled={advanceDisabled(String(match.id))} />
        {editable && (
          <div className="tn-match-actions flex px-2.5 pb-2.5">
            <Button
              type="button"
              variant="default"
              className="tn-match-save min-h-9 flex-1 rounded-md bg-primary px-2.5 text-[13px] font-bold text-primary-foreground hover:bg-primary/90"
              data-score-match={match.id}
              disabled={Boolean(correctable && current1 === saved1 && current2 === saved2)}
              onClick={() => onSubmit(String(match.id))}
            >
              Save
            </Button>
          </div>
        )}
        {correctable && <p className="tn-match-note px-2.5 pb-1.5 text-[11px] text-muted-foreground" hidden={current1 === saved1 && current2 === saved2}>Changing the winner updates later rounds.</p>}
      </div>
    );
  }

  const p1Winner = match.winner_name === match.player1_name;
  const p2Winner = match.winner_name === match.player2_name;
  const p1Champion = isFinal && championName === match.player1_name;
  const p2Champion = isFinal && championName === match.player2_name;
  return (
    <div {...attrs}>
      {live && <span className="tn-live-tag mx-2.5 mt-2 inline-flex items-center gap-[5px] text-[10px] font-bold tracking-[0.08em] text-primary before:size-[7px] before:shrink-0 before:animate-[tn-live-pulse_1.6s_ease-in-out_infinite] before:rounded-full before:bg-primary before:content-[''] motion-reduce:before:animate-none">LIVE</span>}
      <MatchRow match={match} player={1} name={String(match.player1_name)} seed={seedBase} score={match.player1_score ?? 0} winner={p1Winner} champion={p1Champion} muted={p2Winner} editable={false} scoreValue="" onScoreChange={onScoreChange} />
      <MatchRow match={match} player={2} name={String(match.player2_name)} seed={seedBase === null ? null : seedBase + 1} score={match.player2_score ?? 0} winner={p2Winner} champion={p2Champion} muted={p1Winner} editable={false} scoreValue="" onScoreChange={onScoreChange} />
    </div>
  );

}

export function Bracket({
  tournament,
  matches,
  lifecycle,
  mode = "embedded",
  onScore,
  onAdvance,
  advancePending = [],
}: {
  tournament: Tournament;
  matches: TournamentMatch[];
  lifecycle: string;
  mode?: "embedded" | "expanded";
  onScore: (matchId: string, player1Score: number, player2Score: number, correcting: boolean) => void;
  onAdvance?: (match: TournamentMatch, player: 1 | 2) => void;
  advancePending?: string[];
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scoreRef = useRef<Record<string, string>>({});
  const [revision, setRevision] = useState(0);
  const finished = lifecycle === "finished" || lifecycle === "cancelled";
  const model = useMemo(() => buildRoundModel(matches, Number(tournament?.bracket_size)), [matches, tournament?.bracket_size]);
  const slots = model.rounds[0]?.expected || 1;
  const championName = finished && tournament?.winner_name ? String(tournament.winner_name) : null;
  let liveId: string | number | null = null;
  if (lifecycle === "live") {
    const live = [...(matches || [])]
      .sort((a, b) => a.round_number - b.round_number || a.match_index - b.match_index)
      .find((match) => matchState(match, false) === "scorable");
    liveId = live?.id ?? null;
  }
  const hasBye = matches.some((match) => isBye(match.player1_name) || isBye(match.player2_name));

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
      const cardsWithScores = [...grid.querySelectorAll<HTMLElement>('.tn-match[data-state="completed"], .tn-match[data-state="scorable"]')];
      const tallest = Math.max(0, ...cardsWithScores.map((card) => card.getBoundingClientRect().height));
      if (tallest) grid.style.setProperty("--tn-slot", `${Math.ceil(tallest + 12)}px`);
    };
    const schedule = () => {
      if (frame) return;
      frame = win?.requestAnimationFrame ? win.requestAnimationFrame(draw) : win?.setTimeout(draw, 0) as unknown as number;
    };
    draw();
    const observer = win && "ResizeObserver" in win ? new win.ResizeObserver(schedule) : null;
    if (observer) observer.observe(grid);
    win?.addEventListener("resize", schedule);
    return () => {
      if (frame) {
        if (win?.cancelAnimationFrame) win.cancelAnimationFrame(frame);
        else win?.clearTimeout(frame);
      }
      observer?.disconnect();
      win?.removeEventListener("resize", schedule);
    };
  }, [matches, mode, revision]);

  const scoreValue = (id: unknown, player: 1 | 2, fallback = "0") => scoreRef.current[`${String(id)}:${player}`] ?? fallback;
  const scoreChange = (matchId: string, player: 1 | 2, value: string) => {
    scoreRef.current[`${matchId}:${player}`] = value;
    setRevision((current) => current + 1);
  };

  return (
    <div className="tn-bracket min-w-0" data-mode={mode} ref={rootRef}>
      {hasBye && <p className="tn-bracket-note mb-2.5 text-xs text-muted-foreground" data-bye-note>Fewer players than spots, so some players get a BYE and advance automatically.</p>}
      <div className="tn-bracket-scroll overflow-x-auto px-0.5 py-0.5 pb-1.5">
        <div className={`tn-bracket-grid relative flex min-w-max [--tn-slot:84px] [--tn-card-w:210px] ${mode === "expanded" ? "gap-16" : "gap-12"}`} style={{ "--slots": slots, "--rounds": model.totalRounds } as CSSProperties}>
      <svg className="tn-connectors pointer-events-none absolute inset-0 size-full overflow-visible text-muted-foreground" aria-hidden="true" />
          {model.rounds.map((round) => {
            const finalRound = round.number === model.totalRounds;
            return (
              <section className={`tn-round flex flex-col ${mode === "expanded" ? "min-w-[280px] flex-[0_0_280px]" : "min-w-[210px] flex-[0_0_210px]"}`} key={round.number}>
                <div className="tn-round-head mb-2.5 flex flex-col items-center gap-px text-center">
                  <h3 className="m-0 text-[13px] font-bold">{round.label}</h3>
                  <span className="text-[11px] text-muted-foreground">{round.matches.length} {round.matches.length === 1 ? "match" : "matches"}</span>
                </div>
                <div className="tn-round-body flex h-[calc(var(--tn-slot)*var(--slots))] flex-col">
                  {round.matches.map(({ match, index }) => {
                    const waiting = finalRound && model.totalRounds >= 2 && (!match || isTbd(match.player1_name) || isTbd(match.player2_name));
                    const card = waiting ? (
                      <div className="tn-match tn-match-waiting flex flex-col gap-0.5 rounded-lg border border-dashed border-border p-2.5 text-center" data-state="waiting" data-round={round.number} data-index={index} data-match-id={match?.id}>
                        <b className="text-xs">Waiting for semifinalists</b><span className="text-[11px] text-muted-foreground">The final appears when both semifinals are decided.</span>
                      </div>
                    ) : match ? (
                      <MatchCard
                        match={match}
                        isFinal={finalRound}
                        finished={finished}
                        championName={championName}
                        liveId={liveId}
                        mode={mode}
                        advanceDisabled={(id) => advancePending.includes(id)}
                        onScoreChange={(id, player, value) => scoreChange(id, player, value)}
                        scoreValue={scoreValue}
                        onSubmit={(id) => {
                          const match = matches.find((item) => String(item.id) === id);
                          onScore(id, Number(scoreValue(id, 1, String(match?.player1_score ?? 0))) || 0, Number(scoreValue(id, 2, String(match?.player2_score ?? 0))) || 0, Boolean(match?.status === "completed" && match?.correctable));
                        }}
                        onAdvance={onAdvance}
                      />
                    ) : (
                      <div className="tn-match" data-state="future" data-placeholder="" data-round={round.number} data-index={index}>
                        <div className="tn-match-line flex items-center justify-between rounded-md border border-dashed border-border px-2.5 py-1.5 text-xs text-muted-foreground">
                          {round.number === 1 && <span className="tn-match-seed">{index * 2 + 1}</span>}<span className="tn-match-name">TBD</span><span className="tn-match-name">TBD</span>
                        </div>
                      </div>
                    );
                    return <div className="tn-slot flex h-[calc(var(--tn-slot)*var(--span))] items-center" key={`${round.number}:${index}`} style={{ "--span": 2 ** (round.number - 1) } as CSSProperties}>{card}</div>;
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
