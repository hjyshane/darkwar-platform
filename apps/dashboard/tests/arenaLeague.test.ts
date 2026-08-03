import { describe, expect, test } from 'vitest';
import { ARENA_LEAGUES, compareLeagues, leagueLabel, leagueScope } from '../src/lib/arenaLeague';

describe('arena leagues', () => {
  test('the two boards the game actually has', () => {
    expect(leagueLabel(1)).toBe('Gold');
    expect(leagueLabel(2)).toBe('Silver');
    expect(leagueScope(1)).toBe('cross-server');
    expect(leagueScope(2)).toBe('own server');
  });

  // FR-UI-008. A capture from before 0062 knows its entries but not its
  // board, and filing it under Gold would be inventing the answer.
  test('a snapshot that never said keeps saying so', () => {
    expect(leagueLabel(null)).toBe('Unknown league');
    expect(leagueScope(null)).toBeNull();
  });

  // The mapping came from two observations. A third board is new
  // information, and the UI has to render it rather than drop it.
  test('an unrecognised league renders as itself', () => {
    expect(leagueLabel(3)).toBe('League 3');
    expect(leagueScope(3)).toBeNull();
  });

  test('boards sort by rank, with the unknowns last', () => {
    const shuffled = [null, 3, 2, 1];
    expect([...shuffled].sort(compareLeagues)).toEqual([1, 2, 3, null]);
  });

  test('every listed league has a distinct value', () => {
    const values = ARENA_LEAGUES.map((league) => league.value);
    expect(new Set(values).size).toBe(values.length);
  });
});
