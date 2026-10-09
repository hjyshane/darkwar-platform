// Power and Kills boards, answered a page at a time by the database (0263).
//
// The merge of the in-game board with the alliance rosters, the ranking, the
// server filter, the search and the sort all happen in SQL; the browser asks for
// 50 rows and a total. Nothing here downloads the ranking.

import { supabase } from '../../lib/supabase';
import type { SortState } from '../../lib/tableControls';
import type { BoardRow } from './boards';

export type RemoteMetric = 'power' | 'kills';

export const PAGE_SIZE = 50;

/** The table's column keys that the SQL function can order by. */
const SORTABLE = new Set(['rank', 'name', 'server_id', 'value', 'alliance']);

export interface PageParams {
  metric: RemoteMetric;
  server: number | null;
  search: string;
  sort: readonly SortState[];
  page: number;
}

export interface PlayerPage {
  rows: BoardRow[];
  total: number;
}

export interface ServerStat {
  id: number;
  count: number;
  newest: string | null;
}

/** The sort the query is made with: the primary key, or board order. */
export function sortOf(sort: readonly SortState[]): { key: string; desc: boolean } {
  const first = sort[0];
  return first !== undefined && SORTABLE.has(first.key)
    ? { key: first.key, desc: first.direction === 'desc' }
    : { key: 'rank', desc: false };
}

export function pageKey(params: PageParams): readonly unknown[] {
  const { key, desc } = sortOf(params.sort);
  return [
    'crossRankings',
    'page',
    params.metric,
    params.server,
    params.search,
    key,
    desc ? 'desc' : 'asc',
    params.page,
  ];
}

export async function fetchPlayerPage(params: PageParams): Promise<PlayerPage> {
  const { key, desc } = sortOf(params.sort);
  const { data, error } = await supabase.rpc('player_ranking_page', {
    p_metric: params.metric,
    p_server: params.server ?? undefined,
    p_search: params.search.trim() === '' ? undefined : params.search.trim(),
    p_sort: key,
    p_desc: desc,
    p_limit: PAGE_SIZE,
    p_offset: (params.page - 1) * PAGE_SIZE,
  });
  if (error) {
    throw new Error(`ranking query failed: ${error.message}`);
  }
  const rows = data ?? [];
  return {
    total: rows[0]?.total ?? 0,
    rows: rows.map((row) => ({
      id: row.id,
      playerId: row.player_id,
      rank: row.rank,
      name: row.name,
      game_uid: row.game_uid,
      server_id: row.server_id,
      value: row.value,
      unit_id: null,
      captured_at: row.captured_at,
      source: row.source === 'roster' ? 'roster' : 'board',
      alliance:
        !row.alliance_id
          ? null
          : { id: row.alliance_id, code: row.alliance_code, name: row.alliance_name },
    })),
  };
}

export async function fetchPlayerServers(metric: RemoteMetric): Promise<ServerStat[]> {
  const { data, error } = await supabase.rpc('player_ranking_servers', { p_metric: metric });
  if (error) {
    throw new Error(`ranking servers query failed: ${error.message}`);
  }
  return (data ?? []).map((row) => ({ id: row.server_id, count: row.players, newest: row.newest }));
}
