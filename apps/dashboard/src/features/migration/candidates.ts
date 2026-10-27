import { supabase } from '../../lib/supabase';

/** The game's migration tiers, cut on a player's place by power across the whole
 * migration range (servers 567-588) taken together. Confirmed in game 2026-10-27. */
export type Tier = 'commander' | 'elite' | 'advanced' | 'backbone';

export const TIER_LABELS: Record<Tier, string> = {
  commander: 'Commander',
  elite: 'Elite',
  advanced: 'Advanced',
  backbone: 'Backbone',
};

/** Last place in each tier; anything past the last is `backbone`. */
const TIER_ENDS: ReadonlyArray<readonly [Tier, number]> = [
  ['commander', 10],
  ['elite', 46],
  ['advanced', 226],
];

export function tierOf(overallRank: number): Tier {
  for (const [tier, end] of TIER_ENDS) {
    if (overallRank <= end) return tier;
  }
  return 'backbone';
}

export interface CandidateRow {
  game_uid: number;
  name: string;
  server_id: number;
  alliance_name: string | null;
  power: number;
  overall_rank: number;
  captured_at: string;
  migrate_power: number | null;
  migrate_power_at: string | null;
}

export interface BoardInfo {
  servers: number[];
  missing_servers: number[];
  listed: number;
  oldest_at: string | null;
  newest_at: string | null;
  rank_floor_unlisted: number | null;
}

export interface Query {
  names: string[];
  uids: number[];
}

/** One name or uid per line (or comma/tab, which is what pasting an Excel column
 * can bring). A line of 15+ digits is a uid; anything else is a name. */
export function parseQuery(text: string): Query {
  const names: string[] = [];
  const uids: number[] = [];
  const seen = new Set<string>();
  for (const part of text.split(/[\n\r\t,]+/)) {
    const entry = part.trim();
    const key = entry.toLowerCase();
    if (entry === '' || seen.has(key)) continue;
    seen.add(key);
    if (/^\d{15,}$/.test(entry)) uids.push(Number(entry));
    else names.push(entry);
  }
  return { names, uids };
}

/** What to say about a name or uid that came back with no row. A player beyond
 * their own server's 150th has a place of at least `floor`; past the last tier
 * boundary that makes them backbone, but only when every server's list is in. */
export function unlistedTier(info: BoardInfo | null): Tier | null {
  if (info === null || info.missing_servers.length > 0) return null;
  const floor = info.rank_floor_unlisted;
  return floor !== null && tierOf(floor) === 'backbone' ? 'backbone' : null;
}

export async function fetchBoardInfo(): Promise<BoardInfo | null> {
  const { data, error } = await supabase.rpc('migration_board_info');
  if (error) throw new Error(`migration board query failed: ${error.message}`);
  const row = (data ?? [])[0];
  return row ? (row as BoardInfo) : null;
}

export async function lookupPlayers(query: Query): Promise<CandidateRow[]> {
  const { data, error } = await supabase.rpc('migration_candidate_lookup', {
    p_names: query.names,
    p_uids: query.uids,
  });
  if (error) throw new Error(`candidate lookup failed: ${error.message}`);
  return (data ?? []) as CandidateRow[];
}

/** The query entries that matched nothing, by the same rule the database used. */
export function unmatched(query: Query, rows: readonly CandidateRow[]): string[] {
  const names = new Set(rows.map((r) => r.name.trim().toLowerCase()));
  const uids = new Set(rows.map((r) => r.game_uid));
  return [
    ...query.names.filter((n) => !names.has(n.trim().toLowerCase())),
    ...query.uids.filter((u) => !uids.has(u)).map(String),
  ];
}

/** A saved candidate: what was typed, the 580 alliance they want, and officers' cells. */
export interface Candidate {
  candidate_id: string;
  query: string;
  game_uid: number | null;
  desired_alliance_id: string | null;
  extra: Record<string, string>;
}

export interface CandidateColumn {
  column_id: string;
  label: string;
  sort_order: number;
}

export interface OwnAlliance {
  alliance_id: string;
  current_name: string | null;
  current_code: string | null;
}

/** `extra` is jsonb: keep only the text cells, whatever else a hand-edit left in it. */
export function cells(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

export async function fetchSavedCandidates(): Promise<Candidate[]> {
  const { data, error } = await supabase
    .from('migration_candidates')
    .select('candidate_id, query, game_uid, desired_alliance_id, extra')
    .order('created_at', { ascending: true })
    .limit(1000);
  if (error) throw new Error(`candidates query failed: ${error.message}`);
  return (data ?? []).map((row) => ({ ...row, extra: cells(row.extra) }));
}

export async function fetchCandidateColumns(): Promise<CandidateColumn[]> {
  const { data, error } = await supabase
    .from('migration_candidate_columns')
    .select('column_id, label, sort_order')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw new Error(`candidate columns query failed: ${error.message}`);
  return data ?? [];
}

/** Our server's alliances, strongest first, for the "wants to join" choice. */
export async function fetchOwnServerAlliances(): Promise<OwnAlliance[]> {
  const { data, error } = await supabase
    .from('alliances')
    .select('alliance_id, current_name, current_code')
    .eq('server_id', 580)
    .order('power', { ascending: false, nullsFirst: false })
    .limit(200);
  if (error) throw new Error(`alliances query failed: ${error.message}`);
  return data ?? [];
}

/** Which of the lookup rows is this candidate: the pinned uid, else the name. */
export function matchesOf(candidate: Candidate, rows: readonly CandidateRow[]): CandidateRow[] {
  if (candidate.game_uid !== null) return rows.filter((r) => r.game_uid === candidate.game_uid);
  const key = candidate.query.trim().toLowerCase();
  return rows.filter((r) => r.name.trim().toLowerCase() === key);
}

/** Everything the lookup has to be asked about for a set of saved candidates. */
export function queryOf(candidates: readonly Candidate[]): Query {
  const names = new Set<string>();
  const uids = new Set<number>();
  for (const c of candidates) {
    if (c.game_uid !== null) uids.add(c.game_uid);
    else if (/^\d{15,}$/.test(c.query.trim())) uids.add(Number(c.query.trim()));
    else names.add(c.query.trim());
  }
  return { names: [...names], uids: [...uids] };
}
