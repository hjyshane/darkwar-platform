// Player Ranking = the in-game boards we have captured, plus everyone an
// alliance roster lists.
//
// A board is a top-N (100 for server.rank), so a player below the cut-off is
// invisible to it however well we know them. The rosters are the other source
// of power and kills, and they cover every member of every alliance scanned.

import type { BoardRow } from './boards';
import { latestPerPlayer } from './latestPerPlayer';

export interface PlayerReading {
  snapshot_id: string;
  player_id: string | null;
  rank: number | null;
  name: string | null;
  game_uid: number;
  server_id: number;
  captured_at: string;
  power: number | null;
  kills: number | null;
}

/** For every key, only the rows of that key's newest capture.
 *
 * `latestBatch` assumes one board. A scan of a new server writes a second
 * board with a newer `captured_at`, and "the newest batch" would then drop
 * every other server's. Batches are told apart by where they were collected. */
export function latestBatchPer<T extends { captured_at: string }>(
  rows: readonly T[],
  key: (row: T) => number | string,
): T[] {
  const newest = new Map<number | string, string>();
  for (const row of rows) {
    const held = newest.get(key(row));
    // ISO-8601 UTC strings sort chronologically as text.
    if (held === undefined || row.captured_at > held) {
      newest.set(key(row), row.captured_at);
    }
  }
  return rows.filter((row) => newest.get(key(row)) === row.captured_at);
}

/** Boards first, rosters second; the newer reading of a player wins, and a
 * tie goes to the board. Ranks are renumbered by the figure, because a roster
 * row has no board position and a rank copied from one board would clash with
 * another's. */
export function mergeBoardAndRoster(
  board: readonly PlayerReading[],
  roster: readonly PlayerReading[],
  valueColumn: 'power' | 'kills',
): BoardRow[] {
  const toRow = (row: PlayerReading, source: 'board' | 'roster'): BoardRow => ({
    id: row.snapshot_id,
    playerId: row.player_id,
    rank: row.rank,
    name: row.name,
    game_uid: row.game_uid,
    server_id: row.server_id,
    value: row[valueColumn],
    unit_id: null,
    captured_at: row.captured_at,
    source,
  });
  const merged = latestPerPlayer([
    ...board.map((row) => toRow(row, 'board')),
    // A roster member with no figure adds nothing to a ranking by that figure.
    ...roster.filter((row) => row[valueColumn] !== null).map((row) => toRow(row, 'roster')),
  ]);
  return merged
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.game_uid - b.game_uid)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}
