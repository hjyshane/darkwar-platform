import { describe, expect, test } from 'vitest';
import { latestBatch } from '../src/features/crossRankings/latestBatch';
import { latestPerPlayer } from '../src/features/crossRankings/latestPerPlayer';

/** The bug: a board of 150 players rendering one name.
 *
 * Two sources write the component power metrics. `rank.get.by.range` arrives as
 * a whole board — 150 players, one `captured_at`. Opening somebody's profile
 * writes the same metrics for ONE player, and that row is newer. Keeping "the
 * newest batch" therefore keeps the profile and throws the board away, which on
 * screen looks exactly like never having collected anybody else.
 */

const board = (uid: number, at: string, power: number) => ({
  game_uid: uid,
  captured_at: at,
  power,
});

describe('latestPerPlayer', () => {
  test('keeps the whole board when a single newer row lands after it', () => {
    const rows = [
      board(3, '2026-08-17T01:09:00Z', 10), // a profile open, one player, newest
      board(1, '2026-08-17T01:00:00Z', 300), // the board, three players
      board(2, '2026-08-17T01:00:00Z', 200),
      board(3, '2026-08-17T01:00:00Z', 100),
    ];
    // What shipped: one row.
    expect(latestBatch(rows)).toHaveLength(1);
    // What it should be: everybody, with player 3 taking their newer figure.
    const kept = latestPerPlayer(rows);
    expect(kept).toHaveLength(3);
    expect(kept.find((row) => row.game_uid === 3)?.power).toBe(10);
  });

  test('prefers the newer reading whichever order the rows arrive in', () => {
    const older = board(1, '2026-08-16T00:00:00Z', 1);
    const newer = board(1, '2026-08-17T00:00:00Z', 2);
    expect(latestPerPlayer([older, newer])[0]?.power).toBe(2);
    expect(latestPerPlayer([newer, older])[0]?.power).toBe(2);
  });

  test('an empty board is empty rather than an error', () => {
    expect(latestPerPlayer([])).toEqual([]);
  });
});
