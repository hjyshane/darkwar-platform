import { describe, expect, it } from 'vitest';
import { compareLeagues } from '../../lib/arenaLeague';
import { arenaSummary } from './arenaSummary';
import type { PlayerArenaEntry } from './playerArena';

const entry = (league: number | null): PlayerArenaEntry => ({
  entryId: `e-${league}`,
  league,
  weekStart: '2026-11-02',
  capturedAt: '2026-11-08T03:00:00Z',
  rank: 7,
  score: null,
  defensePower: null,
  lineup: [],
});

describe('arenaSummary', () => {
  it('keeps at most three rows, in league order', () => {
    // Gold, Silver, a league we have no name for yet, and a board captured
    // before the league was understood.
    const leagues = [1, 2, 3, null];
    const shuffled = [...leagues].reverse().map(entry);
    const rows = arenaSummary(shuffled);
    expect(rows).toHaveLength(3);
    const expected = [...leagues].sort(compareLeagues).slice(0, 3);
    expect(rows.map((row) => row.league)).toEqual(expected);
  });
  it('is empty for a player with no arena rows', () => {
    expect(arenaSummary([])).toEqual([]);
  });
  it('does not reorder the input', () => {
    const input = [entry(2), entry(1)];
    arenaSummary(input);
    expect(input.map((row) => row.league)).toEqual([2, 1]);
  });
});
