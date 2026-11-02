import { supabase } from '../../lib/supabase';

/** A player on a state list whose current server differs from the one their uid ends in
 * (`migration_movers`, 0300): somebody who moved. */
export interface Mover {
  game_uid: number;
  name: string;
  home_server: number;
  server_id: number;
  alliance_name: string | null;
  power: number;
  board_rank: number;
  captured_at: string;
}

/** When one server's newest state list was read and what is on it (`migration_list_freshness`). */
export interface ListFreshness {
  server_id: number;
  captured_at: string | null;
  listed: number;
  movers: number;
}

export async function fetchMovers(): Promise<Mover[]> {
  const { data, error } = await supabase.rpc('migration_movers');
  if (error) throw new Error(`movers query failed: ${error.message}`);
  return (data ?? []) as Mover[];
}

export async function fetchFreshness(): Promise<ListFreshness[]> {
  const { data, error } = await supabase.rpc('migration_list_freshness');
  if (error) throw new Error(`list freshness query failed: ${error.message}`);
  return (data ?? []) as ListFreshness[];
}

export interface Flow {
  from: number;
  to: number;
  count: number;
}

/** From-to pairs with how many moved along each, biggest first. */
export function flows(movers: readonly Mover[]): Flow[] {
  const counts = new Map<string, Flow>();
  for (const m of movers) {
    const key = `${m.home_server}>${m.server_id}`;
    const flow = counts.get(key) ?? { from: m.home_server, to: m.server_id, count: 0 };
    flow.count += 1;
    counts.set(key, flow);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.from - b.from || a.to - b.to);
}

export interface ServerTally {
  server: number;
  arrived: number;
  left: number;
}

/** Per server: how many of the movers on the lists arrived there, and how many of them
 * started there. "Left" is only what the lists show, so it undercounts any server whose
 * leavers landed on a list that has not been read since. */
export function tally(movers: readonly Mover[]): ServerTally[] {
  const by = new Map<number, ServerTally>();
  const at = (server: number) => {
    const held = by.get(server) ?? { server, arrived: 0, left: 0 };
    by.set(server, held);
    return held;
  };
  for (const m of movers) {
    at(m.server_id).arrived += 1;
    at(m.home_server).left += 1;
  }
  return [...by.values()].sort((a, b) => a.server - b.server);
}

export interface MoverFilters {
  /** The server they started on, or '' for all. */
  from: string;
  /** The server they are on now, or '' for all. */
  to: string;
  /** A tier name, or '' for all. */
  tier: string;
}

export const NO_MOVER_FILTERS: MoverFilters = { from: '', to: '', tier: '' };

export function filterMovers(
  movers: readonly Mover[],
  filters: MoverFilters,
  tierOf: (place: number) => string,
): Mover[] {
  return movers.filter(
    (m) =>
      (filters.from === '' || String(m.home_server) === filters.from) &&
      (filters.to === '' || String(m.server_id) === filters.to) &&
      (filters.tier === '' || tierOf(m.board_rank) === filters.tier),
  );
}

/** Lists last read more than `maxAgeMs` before `now`, or never: the ones that cannot show
 * who moved since. */
export function staleLists(
  rows: readonly ListFreshness[],
  now: number,
  maxAgeMs: number,
): number[] {
  return rows
    .filter((r) => r.captured_at === null || now - Date.parse(r.captured_at) > maxAgeMs)
    .map((r) => r.server_id);
}
