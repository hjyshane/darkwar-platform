// The header's "Lineups seen in arena": the newest entry per league, at most
// three rows. The Arena tab keeps every entry; this is the summary, and the
// two are different granularities, not a duplicate.

import { compareLeagues } from '../../lib/arenaLeague';
import type { PlayerArenaEntry } from './playerArena';

export const ARENA_SUMMARY_ROWS = 3;

/** `entries` is already one per league (`newestPerLeague`), lineups attached
 * by `fetchPlayerArena` through `features/arena/lineups.ts`. */
export function arenaSummary(entries: readonly PlayerArenaEntry[]): PlayerArenaEntry[] {
  return [...entries]
    .sort((left, right) => compareLeagues(left.league, right.league))
    .slice(0, ARENA_SUMMARY_ROWS);
}
