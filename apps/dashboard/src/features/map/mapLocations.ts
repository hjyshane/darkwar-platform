// Who is where, on the servers somebody has actually swept.
//
// NOTHING IS FETCHED UNTIL A PLAYER IS NAMED. A swept server holds thousands
// of tiles — 581 alone gave 2,440 from one pass — and drawing them all at
// once is a screen of dots that answers no question anybody asked. The
// question is always "where is this one person", so the search is the gate
// and the map is the answer.

import { useQuery } from '@tanstack/react-query';
import type { Coordinate } from '../../lib/mapProjection';
import { supabase } from '../../lib/supabase';

/** How old a sighting may be before the map stops calling it current.
 * Same day as the player page, and for the same reason: bases move, and the
 * server we duel this week is the one that gets swept. */
export const SIGHTING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Enough characters to be a search rather than "show me everything". Two
 * would match most of the roster and put us back at the wall of dots. */
export const MIN_QUERY = 2;

const SEARCH_LIMIT = 25;

export interface ScannedServer {
  serverId: number;
  /** The newest sighting anywhere on it — when this ground was last read. */
  sweptAt: string;
  tiles: number;
}

export interface Sighting {
  playerId: string | null;
  gameUid: number;
  /** The name the game shows on the tile. Never an id. */
  name: string | null;
  serverId: number;
  at: Coordinate;
  hqLevel: number | null;
  capturedAt: string;
}

/** Servers with any tile at all, newest sweep first.
 *
 * FROM THE VIEW (0140), not from the tiles. Reducing raw rows in the browser
 * needs a limit, an ordered limit keeps the NEWEST rows, and a server swept
 * last week and left alone then falls off the end of that window — the tab
 * would silently stop offering ground it has perfectly good data for. The
 * view aggregates server-side and returns a handful of rows, so there is no
 * limit to get wrong.
 *
 * A server nobody has visited has no tiles and so no row: the tab lists what
 * has been READ, never what exists.
 */
export async function fetchScannedServers(): Promise<ScannedServer[]> {
  const { data, error } = await supabase
    .from('swept_servers')
    .select('server_id, tiles, swept_at')
    .order('swept_at', { ascending: false });
  if (error) {
    if (error.code === '42501') {
      return [];
    }
    throw new Error(`scanned servers query failed: ${error.message}`);
  }
  // A view's columns are nullable to the type generator no matter what the
  // query guarantees — `group by server_id` cannot produce a null one. Dropped
  // rather than cast: an unusable row should disappear, not become a tab
  // labelled "null" that queries for nothing.
  const rows: ScannedServer[] = [];
  for (const row of data ?? []) {
    if (row.server_id === null || row.swept_at === null) {
      continue;
    }
    rows.push({
      serverId: row.server_id,
      sweptAt: row.swept_at,
      tiles: Number(row.tiles ?? 0),
    });
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

/** Names on one server matching what was typed, newest sighting per player.
 *
 * MATCHES THE TILE'S OWN NAME. That is what the game prints on the map and
 * what somebody is reading off their screen when they come here; it also
 * finds players outside the alliance, who have no row anywhere else.
 */
export async function searchSightings(serverId: number, query: string): Promise<Sighting[]> {
  const term = query.trim();
  if (term.length < MIN_QUERY) {
    return [];
  }
  const { data, error } = await supabase
    .from('world_city_snapshots')
    .select('player_id, game_uid, name, server_id, x, y, hq_level, captured_at')
    .eq('server_id', serverId)
    // Escaped: a name containing % or _ would otherwise widen the search
    // rather than narrow it, and names here are player-supplied.
    .ilike('name', `%${term.replace(/[%_\\]/g, '\\$&')}%`)
    .order('captured_at', { ascending: false })
    .limit(500);
  if (error) {
    if (error.code === '42501') {
      return [];
    }
    throw new Error(`location search failed: ${error.message}`);
  }
  return newestPerPlayer(data ?? []).slice(0, SEARCH_LIMIT);
}

/** One row per player, the newest sighting kept.
 *
 * A tile is written once per pan, so a member the collector passes often has
 * hundreds of rows. Keyed on the uid rather than the player id because a
 * player outside the alliance has no player id and would otherwise all
 * collapse into a single null-keyed entry.
 */
export function newestPerPlayer(
  rows: ReadonlyArray<{
    player_id: string | null;
    game_uid: number | string;
    name: string | null;
    server_id: number;
    x: number;
    y: number;
    hq_level: number | null;
    captured_at: string;
  }>,
): Sighting[] {
  const newest = new Map<string, Sighting>();
  for (const row of rows) {
    const uid = Number(row.game_uid);
    const key = String(uid);
    const seen = newest.get(key);
    if (seen !== undefined && seen.capturedAt >= row.captured_at) {
      continue;
    }
    newest.set(key, {
      playerId: row.player_id,
      gameUid: uid,
      name: row.name,
      serverId: row.server_id,
      at: { x: row.x, y: row.y },
      hqLevel: row.hq_level,
      capturedAt: row.captured_at,
    });
  }
  return [...newest.values()].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
}

export function useSightingSearch(serverId: number | null, query: string) {
  const ready = serverId !== null && query.trim().length >= MIN_QUERY;
  return useQuery({
    queryKey: ['map', 'search', serverId, query.trim()],
    queryFn: () => searchSightings(serverId as number, query),
    enabled: ready,
    staleTime: 60_000,
  });
}

/** Whether a sighting is recent enough to be called current. */
export function isStale(sighting: Sighting, now: Date, maxAgeMs = SIGHTING_MAX_AGE_MS): boolean {
  return now.getTime() - new Date(sighting.capturedAt).getTime() > maxAgeMs;
}
