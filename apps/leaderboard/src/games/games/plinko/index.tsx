/** @jsxImportSource preact */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { GameProps } from "../../registry.js";
import type { PlinkoRisk } from "../../types.js";
import { BetPanel } from "../../ui/BetPanel.js";
import { sound } from "../../sound.js";
import { haptic } from "../../haptics.js";

/**
 * Plinko replays a decision the server already made.
 *
 * The backend returns the ball's path (one 0/1 per row) and the bucket it landed
 * in, and the site's payout table arrives with the config. Nothing here rolls a
 * die, picks a direction or prices a bucket — the animation is a rendering of
 * `outcome.path`, so what the viewer watches is what was settled.
 */

interface Ball {
  id: number;
  /** Server path: 0 = left, 1 = right, one entry per row. */
  path: number[];
  bucket: number;
  /** Rows already animated. */
  step: number;
}

const RISKS: readonly PlinkoRisk[] = ["low", "medium", "high"];
const STEP_MS = 70;
const BUCKET_FLASH_MS = 600;

/** Fallback board only — the real row count and tables come from the server. */
const FALLBACK_ROWS = 16;

interface PlinkoOutcome {
  path?: unknown;
  bucket?: unknown;
  rows?: unknown;
}

function readPath(outcome: Record<string, unknown>, rows: number): { path: number[]; bucket: number } | null {
  const raw = outcome as PlinkoOutcome;
  if (!Array.isArray(raw.path) || typeof raw.bucket !== "number") return null;
  const path = raw.path.map((step) => (Number(step) === 1 ? 1 : 0));
  if (path.length !== rows) return null;
  return { path, bucket: raw.bucket };
}

/** Horizontal centre of the ball after `step` rows, as a fraction of the board. */
function xFraction(step: number, column: number, rows: number): number {
  return (column + (rows - step) / 2 + 0.5) / (rows + 1);
}

export default function PlinkoBoard({ store, config }: GameProps) {
  const [risk, setRisk] = useState<PlinkoRisk>("medium");
  const [betAmount, setBetAmount] = useState<number>(10);
  const [activeBucket, setActiveBucket] = useState<number | null>(null);
  const [balls, setBalls] = useState<Ball[]>([]);
  const [inFlight, setInFlight] = useState<boolean>(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const nextBallId = useRef(1);

  const rows = config.rows ?? FALLBACK_ROWS;
  const multipliers = useMemo(() => {
    const table = config.payoutTables?.[risk];
    return table && table.length === rows + 1 ? table : null;
  }, [config.payoutTables, risk, rows]);

  // One tick per row, following the server's path.
  useEffect(() => {
    if (balls.length === 0) return;
    const timer = setInterval(() => {
      setBalls((prev) => {
        const next: Ball[] = [];
        for (const ball of prev) {
          if (ball.step < ball.path.length) {
            next.push({ ...ball, step: ball.step + 1 });
            sound.play("click");
            continue;
          }
          setActiveBucket(ball.bucket);
          setTimeout(() => setActiveBucket(null), BUCKET_FLASH_MS);
          const mult = multipliers?.[ball.bucket] ?? 1;
          if (mult >= 1.5) {
            sound.play("win");
            haptic("win");
          } else if (mult >= 1) {
            sound.play("click");
            haptic("tap");
          } else {
            sound.play("lose");
            haptic("error");
          }
        }
        return next;
      });
    }, STEP_MS);
    return () => clearInterval(timer);
  }, [balls.length, multipliers]);

  const handleDrop = async (amount: number) => {
    if (inFlight) return;
    setInFlight(true);
    setLocalError(null);

    try {
      const res = await store.api.placeBet({
        game: "plinko",
        bet: amount,
        params: { rows, risk },
      });

      const drop = readPath(res.outcome, rows);
      if (drop) {
        setBalls((prev) => [...prev, { id: nextBallId.current++, path: drop.path, bucket: drop.bucket, step: 0 }]);
        sound.play("bet");
        haptic("impact");
      }
      store.applyResult(res);
    } catch (err: any) {
      setLocalError(err?.message || "Failed to drop ball");
      store.setError(err);
    } finally {
      setInFlight(false);
    }
  };

  const pegRows = Array.from({ length: rows }, (_, i) => i + 1);

  return (
    <div class="gx-game gx-plinko" style={{ display: "grid", gap: "16px", padding: "16px", width: "100%", maxWidth: "800px", margin: "0 auto" }}>
      <div
        class="gx-plinko__stage"
        style={{
          background: "#0c1017",
          border: "1px solid #1e293b",
          borderRadius: "16px",
          padding: "24px 16px 20px",
          display: "grid",
          gap: "12px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Pegs and balls are positioned in percentages so the board fits any
            width — a 17-bucket board cannot rely on fixed pixel spacing. */}
        <div style={{ position: "relative", width: "100%", aspectRatio: "4 / 3", minHeight: "220px" }}>
          {pegRows.map((row) => (
            <div key={row}>
              {Array.from({ length: row + 1 }, (_, col) => (
                <div
                  key={col}
                  style={{
                    position: "absolute",
                    left: `${xFraction(row, col, rows) * 100}%`,
                    top: `${(row / (rows + 1)) * 100}%`,
                    width: "5px",
                    height: "5px",
                    borderRadius: "50%",
                    background: "#94a3b8",
                    boxShadow: "0 0 6px rgba(148, 163, 184, 0.8)",
                    transform: "translate(-50%, -50%)",
                  }}
                />
              ))}
            </div>
          ))}

          {balls.map((ball) => {
            const column = ball.path.slice(0, ball.step).reduce((sum, s) => sum + s, 0);
            return (
              <div
                key={ball.id}
                style={{
                  position: "absolute",
                  left: `${xFraction(ball.step, column, rows) * 100}%`,
                  top: `${(ball.step / (rows + 1)) * 100}%`,
                  width: "12px",
                  height: "12px",
                  borderRadius: "50%",
                  background: "linear-gradient(135deg, #f59e0b, #ef4444)",
                  boxShadow: "0 0 12px #f59e0b, inset 0 2px 4px rgba(255,255,255,0.4)",
                  transform: "translate(-50%, -50%)",
                  transition: `left ${STEP_MS}ms linear, top ${STEP_MS}ms cubic-bezier(0.4, 0, 1, 1)`,
                  zIndex: 10,
                }}
              />
            );
          })}
        </div>

        {/* Buckets are the server's payout table for this risk level. */}
        {multipliers ? (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${multipliers.length}, 1fr)`, gap: "2px", width: "100%" }}>
            {multipliers.map((m, idx) => {
              const isHit = activeBucket === idx;
              const isHigh = m >= 10;
              const isMid = m >= 1.5;
              return (
                <div
                  key={idx}
                  style={{
                    padding: "6px 1px",
                    borderRadius: "5px",
                    background: isHit
                      ? "#ffffff"
                      : isHigh
                      ? "linear-gradient(135deg, #e11d48, #be123c)"
                      : isMid
                      ? "linear-gradient(135deg, #f59e0b, #d97706)"
                      : "#1e293b",
                    color: isHit ? "#000000" : "#ffffff",
                    fontSize: "9px",
                    fontFamily: "monospace",
                    fontWeight: "800",
                    textAlign: "center",
                    boxShadow: isHit ? "0 0 16px #ffffff" : "none",
                    transform: isHit ? "scale(1.18) translateY(-4px)" : "none",
                    transition: "all 0.15s cubic-bezier(0.16, 1, 0.3, 1)",
                  }}
                >
                  {m}×
                </div>
              );
            })}
          </div>
        ) : (
          <p style={{ margin: 0, textAlign: "center", color: "#94a3b8", fontSize: "12px" }}>
            Payouts unavailable — reload to fetch this board's table.
          </p>
        )}
      </div>

      <div style={{ width: "100%", maxWidth: "420px", margin: "0 auto" }}>
        <BetPanel
          bounds={{ min: config.minBet, max: config.maxBet, balance: store.balance.value }}
          amount={betAmount}
          onAmountChange={setBetAmount}
          onSubmit={handleDrop}
          currency={store.currency.value}
          actionLabel="Drop Ball"
          loading={inFlight}
          disabled={!multipliers}
          error={localError}
        >
          <div style={{ display: "grid", gap: "6px", marginBottom: "12px" }}>
            <label style={{ fontSize: "11px", letterSpacing: "0.1em", textTransform: "uppercase", color: "#94a3b8", fontWeight: "600" }}>
              Risk Level
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px" }}>
              {RISKS.map((r) => (
                <button
                  key={r}
                  type="button"
                  disabled={inFlight}
                  onClick={() => setRisk(r)}
                  style={{
                    padding: "8px",
                    borderRadius: "8px",
                    border: "1px solid",
                    borderColor: risk === r ? "#38bdf8" : "#334155",
                    background: risk === r ? "rgba(56, 189, 248, 0.15)" : "#1e293b",
                    color: risk === r ? "#38bdf8" : "#94a3b8",
                    fontWeight: "700",
                    fontSize: "12px",
                    textTransform: "capitalize",
                    cursor: "pointer",
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </BetPanel>
      </div>
    </div>
  );
}
