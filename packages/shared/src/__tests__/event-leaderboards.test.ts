import { expect, it } from 'bun:test';
import { validateEventPlayers, rankEventPlayers } from '../event-leaderboards';

it('ranks independent event points without mutating the source and shares tied ranks', () => {
  const input = [{ name: 'C', score: 1 }, { name: 'B', score: 8 }, { name: 'A', score: 8 }];
  expect(rankEventPlayers(input)).toEqual([{ name: 'A', score: 8, rank: 1 }, { name: 'B', score: 8, rank: 1 }, { name: 'C', score: 1, rank: 3 }]);
  expect(input[0].name).toBe('C');
});
it('enforces player limits, unique names and explicit finite numeric scores', () => {
  expect(validateEventPlayers([{ name: ' Alex ', score: 0 }], 1)).toEqual([{ name: 'Alex', score: 0 }]);
  for (const score of [null, '', '5', -1, Infinity, NaN, 1e13]) expect(() => validateEventPlayers([{ name: 'A', score }], 1)).toThrow();
  expect(() => validateEventPlayers([{ name: 'A', score: 1 }, { name: 'a', score: 2 }], 2)).toThrow();
  expect(() => validateEventPlayers([{ name: 'A', score: 1 }], 0)).toThrow();
});
