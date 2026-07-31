// Six boards, two source tables, one panel.
//
// server.rank / kill.rank land in player_snapshots and are told apart by
// source_command — the same `rank` column means a different board per
// command. The four component boards land in their own table and are told
// apart by `metric` (migration 0018). Rather than branch on that at every
// call site, each board declares how to fetch itself and yields the same
// shape.

import { supabase } from '../../lib/supabase';
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
    label: '전투력',
    valueLabel: '전투력',
    unitLabel: null,
    fetch: () => fetchFromPlayerSnapshots('server.rank', 'power'),
  },
  {
    id: 'kills',
    label: '킬',
    valueLabel: '킬',
    unitLabel: null,
    fetch: () => fetchFromPlayerSnapshots('kill.rank', 'kills'),
  },
  {
    id: 'hero_power_total',
    label: '영웅 총합',
    valueLabel: '영웅 총 전투력',
    unitLabel: null,
    fetch: () => fetchComponentBoard('hero_power_total'),
  },
  {
    id: 'hero_power_best',
    label: '최강 영웅',
    valueLabel: '영웅 전투력',
    unitLabel: '영웅 ID',
    fetch: () => fetchComponentBoard('hero_power_best'),
  },
  {
    id: 'pet_power_total',
    label: '펫 총합',
    valueLabel: '펫 총 전투력',
    unitLabel: null,
    fetch: () => fetchComponentBoard('pet_power_total'),
  },
  {
    id: 'pet_power_best',
    label: '최강 펫',
    valueLabel: '펫 전투력',
    unitLabel: '펫 ID',
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
