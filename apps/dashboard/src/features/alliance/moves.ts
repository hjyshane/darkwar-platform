// The movement feed: 0314's alliance_moves, one row per observed change,
// already filtered to what the caller may see. These helpers only order,
// filter and label; the window and the visibility live in the database.

import type { Database } from '@dw/shared-types';
import { supabase } from '../../lib/supabase';

export type AllianceMove = Database['public']['Functions']['alliance_moves']['Returns'][number];
export type MoveDirection = 'in' | 'out' | 'relocated';

/** The other side of a move. The generated type for a `returns table` column is
 * non-null, but other_* are null for "no alliance" and for an uncatalogued one. */
export interface OtherSide {
  other_alliance_tag: string | null;
  other_server_id: number | null;
}

/** The Moves tab's window; the RPC's own default is the same 90 days. */
export const MOVES_WINDOW_DAYS = 90;

/** Rendered under the feed: a move is only ever seen on the next observation. */
export const MOVES_CAVEAT =
  'Moves are detected when we next observe the player; a player nobody has seen since leaving shows no move.';

export async function fetchAllianceMoves(allianceId: string, since: Date): Promise<AllianceMove[]> {
  const { data, error } = await supabase.rpc('alliance_moves', {
    p_alliance: allianceId,
    p_since: since.toISOString(),
  });
  if (error) throw error;
  return data ?? [];
}

/** `[TAG] on 571`, `on 571` for an uncatalogued alliance, `no alliance` otherwise. */
export function otherAllianceLabel(move: OtherSide): string {
  if (move.other_server_id === null) return 'no alliance';
  return move.other_alliance_tag
    ? `[${move.other_alliance_tag}] on ${move.other_server_id}`
    : `on ${move.other_server_id}`;
}

export function filterMoves<T extends Pick<AllianceMove, 'direction'>>(
  rows: readonly T[],
  direction: MoveDirection | 'all',
): T[] {
  return direction === 'all' ? [...rows] : rows.filter((row) => row.direction === direction);
}

/** Newest first, `limit` of them; the Overview panel shows five. */
export function newestMoves<T extends Pick<AllianceMove, 'observed_at'>>(
  rows: readonly T[],
  limit: number,
): T[] {
  return [...rows]
    .sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))
    .slice(0, limit);
}
