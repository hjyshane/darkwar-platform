import type { BarRow } from '../../components/BarChart';
import { supabase } from '../../lib/supabase';

/** One row of a server's newest state list, as the game's own migration tab shows it
 * (`migration_server_top`, 0305). */
export interface ServerTopRow {
  server_place: number;
  game_uid: number;
  name: string;
  home_server: number;
  alliance_name: string | null;
  power: number;
  board_rank: number;
  captured_at: string;
}

/** A server's list at a glance (`migration_server_stats`): who is on it by tier and how
 * many moved in and out. */
export interface ServerStat {
  server_id: number;
  captured_at: string | null;
  listed: number;
  min_power: number | null;
  max_power: number | null;
  total_power: number | null;
  commanders: number;
  elites: number;
  advanced: number;
  moved_in: number;
  moved_out: number;
}

/** An alliance whose member list was opened (`migration_alliance_stats`). */
export interface AllianceStat {
  alliance_id: string;
  name: string | null;
  code: string | null;
  server_id: number;
  members: number;
  total_power: number | null;
  moved: number;
  commanders: number;
  elites: number;
  advanced: number;
  captured_at: string;
}

export const SERVERS: readonly number[] = Array.from({ length: 24 }, (_, i) => 565 + i);
export const DEFAULT_SERVER = 580;

export async function fetchServerTop(server: number): Promise<ServerTopRow[]> {
  const { data, error } = await supabase.rpc('migration_server_top', {
    p_server: server,
    p_limit: 150,
  });
  if (error) throw new Error(`server list query failed: ${error.message}`);
  return (data ?? []) as ServerTopRow[];
}

export async function fetchServerStats(): Promise<ServerStat[]> {
  const { data, error } = await supabase.rpc('migration_server_stats');
  if (error) throw new Error(`server stats query failed: ${error.message}`);
  return (data ?? []) as ServerStat[];
}

export async function fetchAllianceStats(): Promise<AllianceStat[]> {
  const { data, error } = await supabase.rpc('migration_alliance_stats', { p_limit: 1000 });
  if (error) throw new Error(`alliance stats query failed: ${error.message}`);
  return (data ?? []) as AllianceStat[];
}

/** Arrivals minus departures: what the list of a server gained. */
export const net = (stat: Pick<ServerStat, 'moved_in' | 'moved_out'>): number =>
  stat.moved_in - stat.moved_out;

/** The listed players below the three tiers, so a stacked bar can show the whole list. */
export const restOfList = (stat: ServerStat): number =>
  Math.max(stat.listed - stat.commanders - stat.elites - stat.advanced, 0);

/** Tier composition per server for the stacked chart; servers with no list are left out. */
export function tierRows(stats: readonly ServerStat[]): BarRow[] {
  return stats
    .filter((s) => s.listed > 0)
    .map((s) => ({
      label: String(s.server_id),
      segments: [
        { key: 'commander', label: 'Commander', value: s.commanders, className: 'bar-commander' },
        { key: 'elite', label: 'Elite', value: s.elites, className: 'bar-elite' },
        { key: 'advanced', label: 'Advanced', value: s.advanced, className: 'bar-advanced' },
      ],
    }));
}

/** Arrivals to the right and departures to the left of the centre line. */
export function movementRows(stats: readonly ServerStat[]): BarRow[] {
  return stats
    .filter((s) => s.listed > 0 || s.moved_in > 0 || s.moved_out > 0)
    .map((s) => ({
      label: String(s.server_id),
      segments: [
        {
          key: 'out',
          label: 'left',
          value: s.moved_out,
          className: 'bar-out',
          side: 'left' as const,
        },
        {
          key: 'in',
          label: 'arrived',
          value: s.moved_in,
          className: 'bar-in',
          side: 'right' as const,
        },
      ],
    }));
}

export type AllianceSort = 'moved' | 'members' | 'power' | 'name' | 'server';

/** The alliances whose name or tag holds the search text, in the order asked for; the
 * ones with nothing to compare (no power) go last either way. */
export function arrangeAlliances(
  rows: readonly AllianceStat[],
  search: string,
  sort: AllianceSort,
  descending: boolean,
): AllianceStat[] {
  const needle = search.trim().toLowerCase();
  const kept = rows.filter(
    (r) =>
      needle === '' ||
      (r.name ?? '').toLowerCase().includes(needle) ||
      (r.code ?? '').toLowerCase().includes(needle),
  );
  const key = (r: AllianceStat): number | string | null => {
    switch (sort) {
      case 'moved':
        return r.moved;
      case 'members':
        return r.members;
      case 'power':
        return r.total_power;
      case 'server':
        return r.server_id;
      default:
        return (r.name ?? '').toLowerCase();
    }
  };
  const sign = descending ? -1 : 1;
  return kept
    .map((row, index) => ({ row, index, k: key(row) }))
    .sort((a, b) => {
      if (a.k === null && b.k === null) return a.index - b.index;
      if (a.k === null) return 1;
      if (b.k === null) return -1;
      const order =
        typeof a.k === 'number' && typeof b.k === 'number'
          ? a.k - b.k
          : String(a.k).localeCompare(String(b.k));
      return sign * order || a.index - b.index;
    })
    .map((entry) => entry.row);
}

/** The alliances with the most movers, as chart rows (an alliance with none is skipped). */
export function allianceMoverRows(rows: readonly AllianceStat[], top: number): BarRow[] {
  return [...rows]
    .filter((r) => r.moved > 0)
    .sort((a, b) => b.moved - a.moved || (b.total_power ?? 0) - (a.total_power ?? 0))
    .slice(0, top)
    .map((r) => ({
      label: (r.code ?? r.name ?? '?').slice(0, 8),
      segments: [{ key: 'moved', label: 'movers', value: r.moved, className: 'bar-alliance' }],
    }));
}
