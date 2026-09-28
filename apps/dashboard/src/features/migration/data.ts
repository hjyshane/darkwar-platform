import { supabase } from '../../lib/supabase';

/** One server migration (0186): the instant its before side is read at, and
 * when its after side is settled — null while the window is open, and then
 * the board reads live. */
export interface MigrationEvent {
  event_id: string;
  name: string;
  baseline_at: string;
  settled_at: string | null;
}

/** moved and stayed need both sides; the other two are one-sided, and
 * unseen is NOT a departure — it is somebody nobody has looked at since. */
export type MoveStatus = 'moved' | 'stayed' | 'unseen_after' | 'appeared';

/** One person on the top-150 board on either side, from `migration_top_board`. */
export interface MigrationPerson {
  game_uid: number;
  player_id: string;
  name: string | null;
  home_server_id: number;
  status: MoveStatus;
  before_server_id: number | null;
  before_power: number | null;
  before_alliance: string | null;
  before_rank: number | null;
  before_at: string | null;
  after_server_id: number | null;
  after_power: number | null;
  after_alliance: string | null;
  after_rank: number | null;
  after_at: string | null;
}

/** One server, from `migration_servers`. "Tracked" counts people we observe,
 * not the server's population; the top_* columns are the like-for-like ones. */
export interface MigrationServer {
  server_id: number;
  tracked_before: number;
  tracked_after: number;
  stayed: number;
  moved_out: number;
  moved_in: number;
  unseen_after: number;
  appeared: number;
  power_out: number;
  power_in: number;
  top_before: number;
  top_after: number;
  top_power_before: number;
  top_power_after: number;
}

/** One route somebody moved along, from `migration_flows`. */
export interface MigrationFlow {
  from_server_id: number;
  to_server_id: number;
  movers: number;
  top_movers: number;
  power: number;
}

/** One observed alliance by the game's id, from `migration_alliances`. The
 * roster columns are null for an alliance whose roster was not read on that
 * side; the board columns are null for one off the alliance boards. */
export interface MigrationAlliance {
  external_id: string;
  name: string | null;
  code: string | null;
  before_server_id: number | null;
  after_server_id: number | null;
  roster_before_at: string | null;
  roster_after_at: string | null;
  members_before: number | null;
  members_after: number | null;
  roster_power_before: number | null;
  roster_power_after: number | null;
  stayed: number | null;
  left_alliance: number | null;
  left_by_moving: number | null;
  joined: number | null;
  board_power_before: number | null;
  board_power_after: number | null;
  board_members_before: number | null;
  board_members_after: number | null;
}

/** Newest first. A handful a year. */
export async function fetchMigrationEvents(): Promise<MigrationEvent[]> {
  const { data, error } = await supabase
    .from('migration_events')
    .select('event_id, name, baseline_at, settled_at')
    .order('baseline_at', { ascending: false })
    .limit(100);
  if (error) {
    throw new Error(`migration events query failed: ${error.message}`);
  }
  return data ?? [];
}

// The generated types call every returned column non-null, which is what the
// CLI emits for `returns table` and not what the functions return — hence
// the casts to the hand-written shapes above.

/** One row per server on either side — at most a dozen. */
export async function fetchMigrationServers(eventId: string): Promise<MigrationServer[]> {
  const { data, error } = await supabase.rpc('migration_servers', { p_event_id: eventId });
  if (error) {
    throw new Error(`migration servers query failed: ${error.message}`);
  }
  return (data ?? []) as MigrationServer[];
}

/** One row per route — at most 12 × 11. */
export async function fetchMigrationFlows(eventId: string): Promise<MigrationFlow[]> {
  const { data, error } = await supabase.rpc('migration_flows', { p_event_id: eventId });
  if (error) {
    throw new Error(`migration flows query failed: ${error.message}`);
  }
  return (data ?? []) as MigrationFlow[];
}

/** Everyone on either top-150 batch — at most 300. */
export async function fetchMigrationTopBoard(eventId: string): Promise<MigrationPerson[]> {
  const { data, error } = await supabase.rpc('migration_top_board', { p_event_id: eventId });
  if (error) {
    throw new Error(`migration top board query failed: ${error.message}`);
  }
  return (data ?? []) as MigrationPerson[];
}

/** Every observed alliance — the boards' ~100 plus the rosters we opened. */
export async function fetchMigrationAlliances(eventId: string): Promise<MigrationAlliance[]> {
  const { data, error } = await supabase.rpc('migration_alliances', { p_event_id: eventId });
  if (error) {
    throw new Error(`migration alliances query failed: ${error.message}`);
  }
  return (data ?? []) as MigrationAlliance[];
}

export const STATUS_LABEL: Record<MoveStatus, string> = {
  moved: 'Moved',
  stayed: 'Stayed',
  unseen_after: 'Not seen since',
  appeared: 'New on board',
};

/** A signed change, or null when either side is unknown — never a zero that
 * stands for "we did not look". */
export function delta(before: number | null, after: number | null): number | null {
  return before === null || after === null ? null : after - before;
}

/** The flows as a from × to grid over every server that appears in them,
 * sorted. Cells nobody moved along are absent from the map. */
export function flowMatrix(flows: readonly MigrationFlow[]): {
  servers: number[];
  cell: (from: number, to: number) => MigrationFlow | undefined;
} {
  const servers = [...new Set(flows.flatMap((f) => [f.from_server_id, f.to_server_id]))].sort(
    (a, b) => a - b,
  );
  const byKey = new Map(flows.map((f) => [`${f.from_server_id}>${f.to_server_id}`, f]));
  return { servers, cell: (from, to) => byKey.get(`${from}>${to}`) };
}

/** Headline totals over the server table. Moves are counted once — every
 * move is one server's out and another's in. */
export function totals(servers: readonly MigrationServer[]): {
  moved: number;
  stayed: number;
  unseen: number;
  appeared: number;
  powerMoved: number;
} {
  const sum = (pick: (s: MigrationServer) => number) =>
    servers.reduce((acc, s) => acc + pick(s), 0);
  return {
    moved: sum((s) => s.moved_out),
    stayed: sum((s) => s.stayed),
    unseen: sum((s) => s.unseen_after),
    appeared: sum((s) => s.appeared),
    powerMoved: sum((s) => s.power_out),
  };
}

export type BoardFilter = 'all' | MoveStatus;

/** The top board in the order a reader scans it: by rank before, and the
 * newcomers after everyone who was already there, by their rank after. */
export function filterBoard(
  people: readonly MigrationPerson[],
  filter: BoardFilter,
): MigrationPerson[] {
  const shown = filter === 'all' ? people : people.filter((p) => p.status === filter);
  return [...shown].sort(
    (a, b) =>
      (a.before_rank ?? 1000) - (b.before_rank ?? 1000) ||
      (a.after_rank ?? 1000) - (b.after_rank ?? 1000),
  );
}
