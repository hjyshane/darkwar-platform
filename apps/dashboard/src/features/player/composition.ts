// Where a player's power sits: one board per component, from
// `player_component_power_snapshots`.
//
// Two kinds of row land in that table and the boards treat them differently
// (0018, 0086, 0109). `rank.get.by.range` writes hero and pet totals WITH the
// game's own rank; `get.user.info.multi` writes all six components of the
// profile's power decomposition with no rank. So value is the newest row for
// the board from either source, and rank is the newest row that carries one —
// and only for the boards the game ranks. No rank is computed among "known
// players": that would look like a game rank and is not one.

import { supabase } from '../../lib/supabase';
import type { RankedBoard } from './verdict';

export const BOARD_METRICS = [
  'hero_power_total',
  'pet_power_total',
  'building_power',
  'science_power',
  'army_power',
  'mod_car_power',
] as const;
export type BoardMetric = (typeof BOARD_METRICS)[number];

/** The boards the game ranks (type 45 and 79, 0018). */
export const RANKED_METRICS: ReadonlySet<string> = new Set(['hero_power_total', 'pet_power_total']);

/** `army_power` overlaps the other components, so it is its own tick and is
 * left out of the share denominator (spec §4). */
export const TROOPS_METRIC: BoardMetric = 'army_power';

/** How the verdict names each board in a sentence. */
export const BOARD_NOUN: Record<BoardMetric, string> = {
  hero_power_total: 'heroes',
  pet_power_total: 'pets',
  building_power: 'buildings',
  science_power: 'tech',
  army_power: 'troops',
  mod_car_power: 'vehicle',
};

/** The boards we hold must sum to the player's total within this, or no share
 * is shown at all: better absent than percentages that do not add up. */
export const SHARE_TOLERANCE = 0.02;

export interface BoardRow {
  metric: string;
  power: number | null;
  rank: number | null;
  captured_at: string;
}

export interface Board {
  metric: BoardMetric;
  noun: string;
  value: number;
  capturedAt: string;
  /** The game's rank on this board; null for profile metrics and for a ranked
   * board we have only seen through the profile. */
  rank: number | null;
  /** Fraction of the non-troop total; null for Troops and whenever the sum
   * check fails. */
  share: number | null;
}

function isBoardMetric(metric: string): metric is BoardMetric {
  return (BOARD_METRICS as readonly string[]).includes(metric);
}

/** Whether the boards present add up to the player's total within tolerance.
 * Partial boards (hero and pet only, say) never do, and that is the point. */
export function sharesAddUp(boards: readonly Board[], totalPower: number | null): boolean {
  if (totalPower === null || totalPower <= 0 || boards.length === 0) return false;
  const sum = boards.reduce((acc, board) => acc + board.value, 0);
  return Math.abs(sum - totalPower) <= SHARE_TOLERANCE * totalPower;
}

/** One board per metric, value from the newest row of either source, rank from
 * the newest ranked row, sorted by value descending. Boards with no value are
 * omitted, not shown as zero. */
export function composeBoards(rows: readonly BoardRow[], totalPower: number | null): Board[] {
  const newest = new Map<BoardMetric, { value: number; capturedAt: string }>();
  const ranks = new Map<BoardMetric, { rank: number; capturedAt: string }>();
  for (const row of rows) {
    if (!isBoardMetric(row.metric)) continue;
    if (row.power !== null) {
      const have = newest.get(row.metric);
      if (have === undefined || row.captured_at > have.capturedAt) {
        newest.set(row.metric, { value: row.power, capturedAt: row.captured_at });
      }
    }
    if (row.rank !== null && RANKED_METRICS.has(row.metric)) {
      const have = ranks.get(row.metric);
      if (have === undefined || row.captured_at > have.capturedAt) {
        ranks.set(row.metric, { rank: row.rank, capturedAt: row.captured_at });
      }
    }
  }
  const unshared: Board[] = [...newest.entries()]
    .map(([metric, { value, capturedAt }]) => ({
      metric,
      noun: BOARD_NOUN[metric],
      value,
      capturedAt,
      rank: ranks.get(metric)?.rank ?? null,
      share: null,
    }))
    .sort((left, right) => right.value - left.value);
  if (!sharesAddUp(unshared, totalPower)) return unshared;
  const denominator = unshared
    .filter((board) => board.metric !== TROOPS_METRIC)
    .reduce((acc, board) => acc + board.value, 0);
  return unshared.map((board) => ({
    ...board,
    share: board.metric === TROOPS_METRIC || denominator <= 0 ? null : board.value / denominator,
  }));
}

/** The boards the verdict may name: ranked boards that have a rank. */
export function rankedBoards(boards: readonly Board[]): RankedBoard[] {
  return boards
    .filter((board) => board.rank !== null)
    .map((board) => ({ noun: board.noun, rank: board.rank as number }));
}

/** Every board row for one player, newest first. One player's rows for six
 * metrics over the retention window; the limit is a guard, and newest-first
 * means a truncation loses only old rows. */
export async function fetchBoardRows(playerId: string): Promise<BoardRow[]> {
  const { data, error } = await supabase
    .from('player_component_power_snapshots')
    .select('metric, power, rank, captured_at')
    .eq('player_id', playerId)
    .in('metric', [...BOARD_METRICS])
    .order('captured_at', { ascending: false })
    .limit(600);
  if (error) throw new Error(`composition query failed: ${error.message}`);
  return data;
}
