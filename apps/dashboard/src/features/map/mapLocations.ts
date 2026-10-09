// Which servers have been swept, for the server tabs on the map.
//
// What is on the map itself comes from `map_atlas` (atlas.ts). This file keeps
// only the list of servers, because it is a different question with a different
// cost: one row per server from an index, against thousands of tiles.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

export interface ScannedServer {
  serverId: number;
  /** The newest sighting anywhere on it — when this ground was last read. */
  sweptAt: string;
}

/** Servers with any tile at all, newest sweep first.
 *
 * FROM THE VIEW (0140, rewritten in 0141), not from the tiles. Reducing raw
 * rows in the browser needs a limit, an ordered limit keeps the NEWEST rows,
 * and a server swept last week and left alone then falls off the end of that
 * window — the tab would silently stop offering ground it has good data for.
 *
 * The view returns one row per server from index lookups alone. 0140's first
 * attempt aggregated over the tile table instead and the tab died on it:
 * `canceling statement due to statement timeout`.
 *
 * A server nobody has visited has no tiles and so no row: the tab lists what
 * has been READ, never what exists.
 */
export async function fetchScannedServers(): Promise<ScannedServer[]> {
  const { data, error } = await supabase
    .from('swept_servers')
    .select('server_id, swept_at')
    .order('swept_at', { ascending: false });
  if (error) {
    if (error.code === '42501') {
      return [];
    }
    throw new Error(`scanned servers query failed: ${error.message}`);
  }
  // A view's columns are nullable to the type generator no matter what the
  // query guarantees, and the skip scan's recursive step genuinely ends on a
  // null before the view filters it out. Dropped rather than cast: an
  // unusable row should disappear, not become a tab labelled "null".
  const rows: ScannedServer[] = [];
  for (const row of data ?? []) {
    if (row.server_id === null || row.swept_at === null) {
      continue;
    }
    rows.push({ serverId: row.server_id, sweptAt: row.swept_at });
  }
  return rows;
}

export function useScannedServers() {
  return useQuery({
    queryKey: ['map', 'servers'],
    queryFn: fetchScannedServers,
    // Only a sweep changes this, and a sweep is a deliberate act.
    staleTime: 10 * 60_000,
  });
}
