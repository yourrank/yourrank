/** @jsxImportSource preact */
import { useMemo, useState } from "preact/hooks";
import {
  DICE_MAX_TARGET,
  DICE_MIN_TARGET,
  diceMultiplier,
  diceWinChance,
} from "@yourrank/shared/games/dice";
import type { DiceDirection, DiceOutcome } from "@yourrank/shared/games/dice";
import type { GameProps } from "../../registry.js";
import { BetPanel } from "../../ui/BetPanel.js";
import { sound } from "../../sound.js";
import { haptic } from "../../haptics.js";

/**
 * The pre-bet multiplier and win chance come from the same shared functions the
 * server settles with, priced at the site's configured edge — the browser never
 * has its own dice maths, so a quoted 1.98× is the multiplier that gets paid.
 */
export default function DiceBoard({ store, config }: GameProps) {
  const [target, setTarget] = useState<number>(50);
  const [direction, setDirection] = useState<DiceDirection>("over");
  const [betAmount, setBetAmount] = useState<number>(10);
  const [rolledNumber, setRolledNumber] = useState<number | null>(null);
  const [lastWon, setLastWon] = useState<boolean | null>(null);
  const [inFlight, setInFlight] = useState<boolean>(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const isOver = direction === "over";
  const winChance = useMemo(() => diceWinChance(target, direction) * 100, [target, direction]);
  const multiplier = useMemo(
    () => diceMultiplier(target, direction, config.houseEdgeBps),
    [target, direction, config.houseEdgeBps]
  );

  const handleRoll = async (amount: number) => {
    if (inFlight) return;
    setInFlight(true);
    setLocalError(null);

    try {
      const res = await store.api.placeBet({
        game: "dice",
        bet: amount,
        params: { target, direction },
      });

      // The roll and the win/lose verdict are the server's, not a local
      // comparison against the slider.
      const outcome = res.outcome as Partial<DiceOutcome>;
      setRolledNumber(typeof outcome.rollDisplay === "number" ? outcome.rollDisplay : null);
      const won = res.payout > 0;
      setLastWon(won);

      if (won) {
        sound.play("win");
        haptic("win");
      } else {
        sound.play("lose");
        haptic("error");
      }

      store.applyResult(res);
    } catch (err: any) {
      setLocalError(err?.message || "Failed to roll dice");
      store.setError(err);
    } finally {
      setInFlight(false);
    }
  };

  return (
    <div class="gx-game gx-dice" style={{ display: "grid", gap: "16px", padding: "16px", width: "100%", maxWidth: "800px", margin: "0 auto" }}>
      {/* Board Display */}
      <div class="gx-dice__stage" style={{ background: "#0c1017", border: "1px solid #1e293b", borderRadius: "16px", padding: "28px 20px", display: "grid", gap: "24px", placeItems: "center" }}>
        
        {/* Large Result Roll Box */}
        <div
          style={{
            display: "grid",
            placeItems: "center",
            width: "160px",
            height: "80px",
            background: lastWon === null
              ? "#1e293b"
              : lastWon
              ? "linear-gradient(135deg, #065f46, #047857)"
              : "linear-gradient(135deg, #881337, #9f1239)",
            border: `2px solid ${lastWon === null ? "#334155" : lastWon ? "#10b981" : "#f43f5e"}`,
            borderRadius: "16px",
            boxShadow: lastWon === null
              ? "0 4px 12px rgba(0,0,0,0.3)"
              : lastWon
              ? "0 0 24px rgba(16, 185, 129, 0.4)"
              : "0 0 24px rgba(244, 63, 94, 0.4)",
            transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          <span
            style={{
              fontFamily: "monospace",
              fontSize: "36px",
              fontWeight: "800",
              color: lastWon === null ? "#94a3b8" : "#ffffff",
              letterSpacing: "-0.02em",
            }}
          >
            {rolledNumber !== null ? rolledNumber.toFixed(2) : "00.00"}
          </span>
        </div>

        {/* Dice Slider & Track */}
        <div style={{ width: "100%", maxWidth: "520px", display: "grid", gap: "12px" }}>
          {/* Target Zone Bar */}
          <div style={{ position: "relative", height: "14px", background: "#334155", borderRadius: "99px", overflow: "hidden" }}>
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: isOver ? `${target}%` : "0%",
                right: isOver ? "0%" : `${100 - target}%`,
                background: "linear-gradient(90deg, #10b981, #34d399)",
                borderRadius: "99px",
                transition: "all 0.1s ease",
              }}
            />
            {rolledNumber !== null && (
              <div
                style={{
                  position: "absolute",
                  top: "-2px",
                  bottom: "-2px",
                  left: `calc(${rolledNumber}% - 4px)`,
                  width: "8px",
                  background: "#ffffff",
                  borderRadius: "99px",
                  boxShadow: "0 0 10px #ffffff",
                  zIndex: 2,
                }}
              />
            )}
          </div>

          {/* Range Input Slider */}
          <input
            type="range"
            min={DICE_MIN_TARGET}
            max={DICE_MAX_TARGET}
            step="1"
            value={target}
            disabled={inFlight}
            onInput={(e) => setTarget(Math.round(Number((e.target as HTMLInputElement).value)))}
            style={{ width: "100%", accentColor: "#38bdf8", cursor: "pointer" }}
          />

          {/* Markers */}
          <div style={{ display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: "11px", fontFamily: "monospace", fontWeight: "600" }}>
            <span>0</span>
            <span>25</span>
            <span>50</span>
            <span>75</span>
            <span>100</span>
          </div>
        </div>

        {/* Stats Row */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "12px",
            width: "100%",
            maxWidth: "520px",
            background: "#1e293b",
            padding: "12px 16px",
            borderRadius: "12px",
            textAlign: "center",
          }}
        >
          <div>
            <div style={{ fontSize: "10px", textTransform: "uppercase", color: "#94a3b8", letterSpacing: "0.1em", fontWeight: "600" }}>Multiplier</div>
            <div style={{ fontFamily: "monospace", fontSize: "16px", fontWeight: "700", color: "#38bdf8" }}>{multiplier.toFixed(2)}×</div>
          </div>
          <div>
            <div style={{ fontSize: "10px", textTransform: "uppercase", color: "#94a3b8", letterSpacing: "0.1em", fontWeight: "600" }}>Roll {isOver ? "Over" : "Under"}</div>
            <div style={{ fontFamily: "monospace", fontSize: "16px", fontWeight: "700", color: "#f8fafc" }}>{target}</div>
          </div>
          <div>
            <div style={{ fontSize: "10px", textTransform: "uppercase", color: "#94a3b8", letterSpacing: "0.1em", fontWeight: "600" }}>Win Chance</div>
            <div style={{ fontFamily: "monospace", fontSize: "16px", fontWeight: "700", color: "#10b981" }}>{winChance.toFixed(2)}%</div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div style={{ width: "100%", maxWidth: "520px", margin: "0 auto" }}>
        <BetPanel
          bounds={{ min: config.minBet, max: config.maxBet, balance: store.balance.value }}
          amount={betAmount}
          onAmountChange={setBetAmount}
          onSubmit={handleRoll}
          currency={store.currency.value}
          actionLabel={`Roll (${multiplier.toFixed(2)}×)`}
          loading={inFlight}
          error={localError}
        >
          {/* Roll Mode Toggle */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "12px" }}>
            <button
              type="button"
              disabled={inFlight}
              onClick={() => setDirection("over")}
              style={{
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid",
                borderColor: isOver ? "#38bdf8" : "#334155",
                background: isOver ? "rgba(56, 189, 248, 0.15)" : "#1e293b",
                color: isOver ? "#38bdf8" : "#94a3b8",
                fontWeight: "700",
                fontSize: "13px",
                cursor: "pointer",
              }}
            >
              Roll Over
            </button>
            <button
              type="button"
              disabled={inFlight}
              onClick={() => setDirection("under")}
              style={{
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid",
                borderColor: !isOver ? "#38bdf8" : "#334155",
                background: !isOver ? "rgba(56, 189, 248, 0.15)" : "#1e293b",
                color: !isOver ? "#38bdf8" : "#94a3b8",
                fontWeight: "700",
                fontSize: "13px",
                cursor: "pointer",
              }}
            >
              Roll Under
            </button>
          </div>
        </BetPanel>
      </div>
    </div>
  );
}
