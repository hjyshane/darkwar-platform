import { supabase } from '../../lib/supabase';

/** The rules the client is given at login (0250), newest reading. The four
 * cutoffs split players into the four migration levels by migrate power. */
export interface MigrationConfig {
  captured_at: string;
  power_tier_floors: number[] | null;
  power_brackets: number[][] | null;
  new_migrate_on: boolean | null;
}

/** One server's offer, newest reading (`migration_server_quotas`, 0250).
 * Shapes follow the client's own parser and have not been checked against a
 * live response: every figure may be null, and the seat fields are whatever
 * the game sent — see `seatList`. */
export interface MigrationQuotaServer {
  server_id: number;
  captured_at: string;
  season: number | null;
  season_group: number | null;
  server_rank_type: number | null;
  total_count: number | null;
  use_count: number | null;
  migrate_left: unknown;
  special_left: unknown;
  invite_left: unknown;
  power_low_limit: number[] | null;
  power_limit: number | null;
  special_power_limit: number | null;
  target_power_limit: number | null;
  max_power: number | null;
  need_item_id: number | null;
  need_item_num: number | null;
  target_open_at: string | null;
  king_name: string | null;
}

/** The newest config, or null before the first login that carried one. */
export async function fetchMigrationConfig(): Promise<MigrationConfig | null> {
  const { data, error } = await supabase
    .from('migration_config_snapshots')
    .select('captured_at, power_tier_floors, power_brackets, new_migrate_on')
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`migration config query failed: ${error.message}`);
  }
  return data as MigrationConfig | null;
}

/** One row per server offering seats — empty until the game turns the screen on. */
export async function fetchMigrationQuotas(): Promise<MigrationQuotaServer[]> {
  const { data, error } = await supabase.rpc('migration_server_quotas');
  if (error) {
    throw new Error(`migration quotas query failed: ${error.message}`);
  }
  return (data ?? []) as MigrationQuotaServer[];
}

/** The client's names for the four levels, in the order of the cutoffs. */
export const LEVEL_NAMES: readonly string[] = ['Normal', 'Mid', 'High', 'Special'];

/** Seats left as `[level type, seats]`, sorted by type. The game's shape is not
 * confirmed, so this takes an object of counts ({"1": 20}), a bare number
 * (one pool, type 0) or nothing, and shows the rest as unknown rather than guess. */
export function seatList(value: unknown): Array<[number, number]> | null {
  if (typeof value === 'number') return [[0, value]];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const seats: Array<[number, number]> = [];
  for (const [type, num] of Object.entries(value)) {
    const level = Number(type);
    if (!Number.isInteger(level) || typeof num !== 'number') return null;
    seats.push([level, num]);
  }
  return seats.sort((a, b) => a[0] - b[0]);
}

/** Seats left across every level, or null when the shape is unknown. */
export function seatTotal(value: unknown): number | null {
  const seats = seatList(value);
  return seats === null ? null : seats.reduce((sum, [, n]) => sum + n, 0);
}

/** Intake still allowed, or null when either figure is missing. */
export function intakeLeft(total: number | null, used: number | null): number | null {
  return total === null || used === null ? null : Math.max(total - used, 0);
}

/** Which level a migrate power falls in, by the cutoffs: the highest cutoff it
 * reaches, or -1 below the first. Null when there are no cutoffs to go by. */
export function levelOf(migratePower: number, floors: readonly number[] | null): number | null {
  if (floors === null || floors.length === 0) return null;
  let level = -1;
  floors.forEach((floor, index) => {
    if (migratePower >= floor) level = index;
  });
  return level;
}
