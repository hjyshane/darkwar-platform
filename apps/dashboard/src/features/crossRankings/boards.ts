// Six boards, two source tables, one panel.
//
// server.rank / kill.rank land in player_snapshots and are told apart by
// source_command — the same `rank` column means a different board per
// command. The four component boards land in their own table and are told
// apart by `metric` (migration 0018). Rather than branch on that at every
// call site, each board declares how to fetch itself and yields the same
// shape.

import { supabase } from '../../lib/supabase';
import { TERMS } from '../../lib/terms';
import { latestBatch } from './latestBatch';

export type BoardId =
  | 'power'
  | 'kills'
  | 'hero_power_total'
  | 'hero_power_best'
  | 'pet_power_total'
  | 'pet_power_best';

export interface BoardRow {
  id: string;
  rank: number | null;
  name: string | null;
  game_uid: number;
  server_id: number;
  value: number | null;
  // Only the "best" boards rank a single unit and name it; the totals
  // aggregate and name nothing.
  unit_id: number | null;
  captured_at: string;
}

export interface Board {
  id: BoardId;
  label: string;
  /** Column header for the ranked number. */
  valueLabel: string;
  /** Column header for unit_id, or null when the board names no unit. */
  unitLabel: string | null;
  fetch: () => Promise<BoardRow[]>;
}

async function fetchFromPlayerSnapshots(
  sourceCommand: string,
  valueColumn: 'power' | 'kills',
): Promise<BoardRow[]> {
  const { data, error } = await supabase
    .from('player_snapshots')
    .select('snapshot_id, rank, name, game_uid, server_id, power, kills, captured_at')
    .eq('source_command', sourceCommand)
    .order('captured_at', { ascending: false })
    .order('rank', { ascending: true, nullsFirst: false })
    .limit(300);
  if (error) {
    throw new Error(`ranking query failed: ${error.message}`);
  }
  return latestBatch(data).map((row) => ({
    id: row.snapshot_id,
    rank: row.rank,
    name: row.name,
    game_uid: row.game_uid,
    server_id: row.server_id,
    value: row[valueColumn],
    unit_id: null,
    captured_at: row.captured_at,
  }));
}

async function fetchComponentBoard(metric: string): Promise<BoardRow[]> {
  const { data, error } = await supabase
    .from('player_component_power_snapshots')
    .select('snapshot_id, rank, name, game_uid, server_id, power, unit_id, captured_at')
    .eq('metric', metric)
    .order('captured_at', { ascending: false })
    .order('rank', { ascending: true, nullsFirst: false })
    .limit(300);
  if (error) {
    throw new Error(`ranking query failed: ${error.message}`);
  }
  return latestBatch(data).map((row) => ({
    id: row.snapshot_id,
    rank: row.rank,
    name: row.name,
    game_uid: row.game_uid,
    server_id: row.server_id,
    value: row.power,
    unit_id: row.unit_id,
    captured_at: row.captured_at,
  }));
}

export const BOARDS: readonly Board[] = [
  {
    id: 'power',
    label: TERMS.power,
    valueLabel: TERMS.power,
    unitLabel: null,
    fetch: () => fetchFromPlayerSnapshots('server.rank', 'power'),
  },
  {
    id: 'kills',
    label: TERMS.kills,
    valueLabel: TERMS.kills,
    unitLabel: null,
    fetch: () => fetchFromPlayerSnapshots('kill.rank', 'kills'),
  },
  {
    id: 'hero_power_total',
    label: TERMS.heroPower,
    valueLabel: TERMS.heroPower,
    unitLabel: null,
    fetch: () => fetchComponentBoard('hero_power_total'),
  },
  {
    id: 'hero_power_best',
    label: TERMS.topHero,
    valueLabel: TERMS.power,
    unitLabel: TERMS.heroId,
    fetch: () => fetchComponentBoard('hero_power_best'),
  },
  {
    id: 'pet_power_total',
    label: TERMS.petPower,
    valueLabel: TERMS.petPower,
    unitLabel: null,
    fetch: () => fetchComponentBoard('pet_power_total'),
  },
  {
    id: 'pet_power_best',
    label: TERMS.topPet,
    valueLabel: TERMS.power,
    unitLabel: TERMS.petId,
    fetch: () => fetchComponentBoard('pet_power_best'),
  },
];

export function boardById(id: BoardId): Board {
  const board = BOARDS.find((candidate) => candidate.id === id);
  if (!board) {
    throw new Error(`unknown board: ${id}`);
  }
  return board;
}
