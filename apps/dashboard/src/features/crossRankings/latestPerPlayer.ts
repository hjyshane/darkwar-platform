interface Observed {
  game_uid: number;
  captured_at: string;
}

/** The newest reading for each player, rather than the newest batch.
 *
 * `latestBatch` is right for a board that arrives whole: one capture of
 * `rank.get.by.range` is 150 players and one `captured_at`, so "the newest
 * batch" IS the board.
 *
 * It is wrong for the component power metrics, because a second source writes
 * the same metrics one player at a time. Opening somebody's profile records
 * their hero, pet, army, building, science and mod-car power — and that single
 * row is newer than the last 150-row board, so the newest batch is one player.
 * Measured on production before this was written: the newest `captured_at` for
 * hero_power_total had exactly one row behind it, with a 150-row batch sitting
 * underneath. The board rendered one name, which read as "we only have data for
 * the collector's account" and was really "we threw the rest away".
 *
 * Newest-per-player is what a board of current values means anyway. It also
 * survives the two sources disagreeing about who they cover: the profile route
 * knows 95 players, the board route knows 150, and a reader wants whichever
 * figure for a player is the most recent one we hold.
 */
export function latestPerPlayer<T extends Observed>(rows: T[]): T[] {
  const newest = new Map<number, T>();
  for (const row of rows) {
    const held = newest.get(row.game_uid);
    // ISO-8601 UTC strings sort chronologically as text.
    if (held === undefined || row.captured_at > held.captured_at) {
      newest.set(row.game_uid, row);
    }
  }
  return [...newest.values()];
}
