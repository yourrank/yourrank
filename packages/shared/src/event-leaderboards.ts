type EventPlayer = { name: string; score: number; rank?: number };
export function validateEventPlayers(value: unknown, limit: number): EventPlayer[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error(`Use at most ${limit} players for this event.`);
  const names = new Set<string>();
  return value.map(p => {
    const name = String(p?.name || '').trim();
    const score = p?.score;
    const key = name.toLocaleLowerCase('en-US');
    if (!name || name.length > 80 || /[\r\n\t]/.test(name) || names.has(key)) throw new Error('Each player needs a unique name of at most 80 characters.');
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1e12) throw new Error('Points must be between 0 and 1,000,000,000,000.');
    names.add(key);
    return { name, score };
  });
}
export function rankEventPlayers(players: EventPlayer[]): EventPlayer[] {
  let rank = 0;
  const sorted = players.slice().sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return sorted.map((p, i) => {
    if (i === 0 || p.score !== sorted[i - 1].score) rank = i + 1;
    return { ...p, rank };
  });
}
