import { supabase } from '../../lib/supabase';

const PAGE = 1000;

/** Per server with any recorded move (server_migration_summary, 0320). */
export interface ServerMoveTally {
  server_id: number;
  arrived: number;
  departed: number;
  last_move_at: string;
}

/** One move into or out of a server (server_migration_flow, 0320). Name,
 * power and alliance are the player's current ones; the alliance is last known. */
export interface ServerFlowRow {
  move_id: number;
  direction: string;
  player_id: string;
  game_uid: number;
  player_name: string | null;
  home_server: number;
  other_server_id: number;
  seen_at: string;
  last_seen_from_at: string | null;
  power: number | null;
  alliance_id: string | null;
  alliance_code: string | null;
  alliance_name: string | null;
}

export type Since = 'all' | '30d' | '7d';

const DAY = 86_400_000;

/** The `p_since` for a choice, or undefined to leave the default (all time). */
export function sinceIso(since: Since, now: number): string | undefined {
  if (since === 'all') return undefined;
  return new Date(now - (since === '30d' ? 30 : 7) * DAY).toISOString();
}

export async function fetchMoveTally(since?: string): Promise<ServerMoveTally[]> {
  const { data, error } = await supabase.rpc(
    'server_migration_summary',
    since === undefined ? {} : { p_since: since },
  );
  if (error) throw new Error(`move summary query failed: ${error.message}`);
  return (data ?? []) as ServerMoveTally[];
}

/** Paged: a server's history grows with every window, and PostgREST stops at
 * 1,000 rows without saying so. */
export async function fetchServerFlow(server: number, since?: string): Promise<ServerFlowRow[]> {
  const args = since === undefined ? { p_server: server } : { p_server: server, p_since: since };
  const all: ServerFlowRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .rpc('server_migration_flow', args)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`server moves query failed: ${error.message}`);
    const page = (data ?? []) as ServerFlowRow[];
    all.push(...page);
    if (page.length < PAGE) return all;
  }
}

/** Arrivals and departures, each newest first as the read returns them. */
export function splitFlow(rows: readonly ServerFlowRow[]): {
  arrived: ServerFlowRow[];
  departed: ServerFlowRow[];
} {
  return {
    arrived: rows.filter((r) => r.direction === 'in'),
    departed: rows.filter((r) => r.direction === 'out'),
  };
}

/** Where they came from (or went), most people first. */
export function byOtherServer(rows: readonly ServerFlowRow[]): { server: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const r of rows) counts.set(r.other_server_id, (counts.get(r.other_server_id) ?? 0) + 1);
  return [...counts.entries()]
    .map(([server, count]) => ({ server, count }))
    .sort((a, b) => b.count - a.count || a.server - b.server);
}
