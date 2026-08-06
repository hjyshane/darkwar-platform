import { compareLeagues } from '../../lib/arenaLeague';
import type { LineupHero } from '../../lib/troops';

/** One arena board this player appears on.
 *
 * Kept per league rather than collapsed to "their arena entry": Gold and
 * Silver are separate boards with separate ranks (0062), and a player can
 * sit on both. Each carries the capture time of the board it came from,
 * because the two are captured seconds apart and then drift.
 */
export interface PlayerArenaEntry {
  entryId: string;
  league: number | null;
  weekStart: string;
  capturedAt: string;
  rank: number;
  score: number | null;
  defensePower: number | null;
  lineup: LineupHero[];
}

export interface ArenaEntryRecord {
  snapshot_id: string;
  arena_snapshot_id: string;
  rank: number;
  score: number | null;
  defense_power: number | null;
}

export interface ArenaBoardRecord {
  snapshot_id: string;
  league: number | null;
  week_start: string;
  captured_at: string;
}

/** The player's newest entry on each board.
 *
 * Split out of the query because it is the part that can be wrong. Taking
 * "their latest arena entry" full stop is the same mistake the arena panel
 * made before 0062 — it answers with whichever league was captured last and
 * silently drops the other.
 *
 * An entry whose board we did not fetch is skipped rather than shown
 * league-less: without the board there is no week and no capture time, and a
 * rank with no "as of" is not a fact anybody can use.
 */
export function newestPerLeague(
  entries: readonly ArenaEntryRecord[],
  boards: readonly ArenaBoardRecord[],
): PlayerArenaEntry[] {
  const boardById = new Map(boards.map((board) => [board.snapshot_id, board]));
  const newest = new Map<string, PlayerArenaEntry>();

  for (const entry of entries) {
    const board = boardById.get(entry.arena_snapshot_id);
    if (board === undefined) {
      continue;
    }
    // Keyed on the league as text so that null — a board captured before the
    // league was understood — is its own bucket rather than colliding with 0.
    const key = String(board.league);
    const existing = newest.get(key);
    if (existing !== undefined && existing.capturedAt >= board.captured_at) {
      continue;
    }
    newest.set(key, {
      entryId: entry.snapshot_id,
      league: board.league,
      weekStart: board.week_start,
      capturedAt: board.captured_at,
      rank: entry.rank,
      score: entry.score,
      defensePower: entry.defense_power,
      lineup: [],
    });
  }

  return [...newest.values()].sort((left, right) => compareLeagues(left.league, right.league));
}

/** A growth figure, signed so the direction is readable without the colour.
 *
 * The roster colours these green and red; a screen reader and a
 * black-and-white printout get the sign instead. Zero is a real
 * observation — flat — and is not the same as never having been measured,
 * which is why it formats rather than falling through to null.
 */
export function percent(value: number | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

/** Which way a growth figure went, for StatTile's `tone`.
 *
 * Separate from `percent` because the two disagree about zero on purpose: the
 * text formats it as "0.0%" — a real reading — while the tone leaves it the
 * ordinary colour. Flat is the absence of a direction, not a third one.
 *
 * Undefined for a figure we never measured, so an unobserved tile is not
 * quietly coloured the same as a flat one.
 */
export function growthTone(value: number | null | undefined): 'up' | 'down' | 'flat' | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (value > 0) {
    return 'up';
  }
  return value < 0 ? 'down' : 'flat';
}

/** What the growth figure is measured AGAINST.
 *
 * Without it the number is unreadable: "+3.4%" since when? The anchor is a
 * real capture time, not "yesterday" — a day the collector missed shifts it,
 * and saying so is the difference between a figure and a guess.
 */
export function growthNote(anchoredAt: string | null | undefined): string | undefined {
  if (anchoredAt === null || anchoredAt === undefined) {
    return undefined;
  }
  return `since ${new Date(anchoredAt).toISOString().slice(0, 10)}`;
}
