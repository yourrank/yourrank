export const PLAYER_NAME_MAX = 80;
export const SCORE_MAX = 9_999_999_999_999.99;
export const WIN_RATE_MAX = 999.99;
export const INT32_MAX = 2147483647;
export const INT32_MIN = -2147483648;
export const RANK_FIELDS = Object.freeze({ wagered: "wagered", score: "score" });

export function normalizePlayerName(name) {
  return String(name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function truncatePlayerName(name, max = PLAYER_NAME_MAX) {
  const text = String(name ?? "").trim().replace(/\s+/g, " ");
  if (typeof Intl?.Segmenter === "function") {
    const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text);
    return Array.from(segments, ({ segment }) => segment).slice(0, max).join("");
  }
  return Array.from(text).slice(0, max).join("");
}

function numberField(value, { field, min, max, integer = false, fallback }) {
  if (value === undefined || value === null || value === "") return { value: fallback };
  const number = Number(value);
  if (!Number.isFinite(number)) return { error: `${field} must be a finite number.` };
  if (integer && !Number.isInteger(number)) return { error: `${field} must be a whole number.` };
  if (number < min || number > max) return { error: `${field} must be between ${min} and ${max}.` };
  return { value: number };
}

export function validateAndNormalizePlayers(players) {
  if (!Array.isArray(players)) return { error: "Players must be an array.", code: "invalid_players" };
  const normalized = [];
  const seen = new Set();

  for (let index = 0; index < players.length; index += 1) {
    const player = players[index];
    if (!player || typeof player !== "object") {
      return { error: `Player ${index + 1} is invalid.`, code: "invalid_player" };
    }
    const name = truncatePlayerName(player.name);
    const identity = normalizePlayerName(name);
    if (!identity) return { error: `Player ${index + 1} needs a name.`, code: "invalid_player_name" };
    if (seen.has(identity)) return { error: `Duplicate player name: ${name}`, code: "duplicate_player" };
    seen.add(identity);

    const wagered = numberField(player.wagered, { field: `${name}'s amount`, min: 0, max: SCORE_MAX, fallback: 0 });
    const prize = numberField(player.prize, { field: `${name}'s prize`, min: 0, max: SCORE_MAX, fallback: 0 });
    const score = numberField(player.score, { field: `${name}'s score`, min: 0, max: SCORE_MAX, fallback: 0 });
    const hands = numberField(player.hands, { field: `${name}'s hands`, min: 0, max: INT32_MAX, integer: true, fallback: 0 });
    const netProfit = numberField(player.netProfit ?? player.net_profit, { field: `${name}'s net profit`, min: -SCORE_MAX, max: SCORE_MAX, fallback: (prize.value ?? 0) - (wagered.value ?? 0) });
    const winRate = numberField(player.winRate ?? player.win_rate, { field: `${name}'s win rate`, min: -WIN_RATE_MAX, max: WIN_RATE_MAX, fallback: 0 });
    const change = numberField(player.change, { field: `${name}'s change`, min: INT32_MIN, max: INT32_MAX, integer: true, fallback: 0 });
    const invalid = [wagered, prize, score, hands, netProfit, winRate, change].find((result) => result.error);
    if (invalid) return { error: invalid.error, code: "invalid_player_number", index };

    normalized.push({
      name,
      normalizedName: identity,
      wagered: wagered.value,
      prize: prize.value,
      score: score.value,
      hands: hands.value,
      netProfit: netProfit.value,
      winRate: winRate.value,
      change: change.value,
    });
  }
  return { players: normalized };
}

export function validateIncrementAmount(value) {
  const result = numberField(value, { field: "Amount", min: 0, max: SCORE_MAX, fallback: 0 });
  return result.error ? { error: result.error, code: "invalid_amount" } : { amount: result.value };
}

export function rankField(value) {
  return RANK_FIELDS[value] || RANK_FIELDS.score;
}

export function sortPlayersForRanking(players, field = "score") {
  const key = rankField(field);
  return [...players].sort((a, b) => {
    const metric = Number(b[key] || 0) - Number(a[key] || 0);
    return metric || String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" });
  });
}
