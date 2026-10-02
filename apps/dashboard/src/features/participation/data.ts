// Reading the participation report (0204) and writing typed attendance.

import { supabase } from '../../lib/supabase';

/** One event's typed attendance for one member over the range. `held` is how
 * many days the event was recorded for anybody, so attended + missed can be
 * less than it: the rest were not ticked either way. */
export interface TypedTally {
  held: number;
  attended: number;
  missed: number;
}

/** One row of `member_participation`. One per current member.
 *
 * `*_read` is the same on every row: how many days or weeks the board was read
 * for the alliance at all. `*_on_board` is the member's own readings, and
 * `*_scored` those above zero. Totals are null when nothing was read — not
 * zero, which is a reading. */
export interface ParticipationRow {
  player_id: string;
  current_name: string | null;
  game_uid: number;
  member_rank: number | null;
  duel_days_read: number;
  duel_days_on_board: number;
  duel_days_scored: number;
  duel_weeks_read: number;
  duel_weeks_on_board: number;
  duel_weeks_scored: number;
  duel_total: number | null;
  donation_days_read: number;
  donation_days_on_board: number;
  donation_days_scored: number;
  donation_weeks_read: number;
  donation_weeks_on_board: number;
  donation_weeks_scored: number;
  donation_total: number | null;
  black_gold_listed: number;
  black_gold_played: number;
  black_gold_starter_missed: number;
  black_gold_substitute_missed: number;
  season_levels_gained: number | null;
  typed_events: Record<string, TypedTally>;
}

export interface EventKind {
  kind: string;
  label: string;
  sort_order: number;
  captured: boolean;
}

/** One member per row, so a whole alliance is far under PostgREST's 1,000. */
export async function fetchParticipation(from: string, to: string): Promise<ParticipationRow[]> {
  const { data, error } = await supabase.rpc('member_participation', { p_from: from, p_to: to });
  if (error) {
    if (error.code === '42501') {
      return [];
    }
    throw new Error(`participation query failed: ${error.message}`);
  }
  return (data ?? []) as unknown as ParticipationRow[];
}

export async function fetchEventKinds(): Promise<EventKind[]> {
  const { data, error } = await supabase
    .from('attendance_event_kinds')
    .select('kind, label, sort_order, captured')
    .order('sort_order');
  if (error) {
    throw new Error(`event list query failed: ${error.message}`);
  }
  return (data ?? []) as EventKind[];
}

/** What is on record for one event on one day: player_id → attended. */
export async function fetchAttendance(kind: string, heldOn: string): Promise<Map<string, boolean>> {
  const { data, error } = await supabase
    .from('event_attendance')
    .select('player_id, attended')
    .eq('kind', kind)
    .eq('held_on', heldOn)
    .limit(1000);
  if (error) {
    throw new Error(`attendance query failed: ${error.message}`);
  }
  return new Map((data ?? []).map((row) => [row.player_id, row.attended]));
}

/** A tick on the form: there, not there, or not recorded. */
export type Mark = boolean | null;

export interface AttendanceEntry {
  player_id: string;
  attended: Mark;
}

/** Only what changed. A member left as they were on record is not sent, so
 * saving one correction does not restamp everybody else's row. */
export function changedEntries(
  stored: ReadonlyMap<string, boolean>,
  draft: ReadonlyMap<string, Mark>,
): AttendanceEntry[] {
  const entries: AttendanceEntry[] = [];
  for (const [playerId, mark] of draft) {
    const before = stored.get(playerId) ?? null;
    if (mark !== before) {
      entries.push({ player_id: playerId, attended: mark });
    }
  }
  return entries;
}

export async function recordAttendance(
  kind: string,
  heldOn: string,
  entries: AttendanceEntry[],
): Promise<number> {
  const { data, error } = await supabase.rpc('record_event_attendance', {
    p_kind: kind,
    p_held_on: heldOn,
    // Json is an alias these plain objects do not satisfy (no index signature).
    p_entries: entries as unknown as never,
  });
  if (error) {
    throw new Error(error.message);
  }
  return data ?? 0;
}

/** `part` out of `whole`, or null when there was nothing to be part of. */
export function share(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

/** Below this share of the days or events that were read, a cell is marked.
 * Half: a member who shows up every other day is on the edge of the line an
 * officer would want to see without hunting for it. */
export const LOW_SHARE = 0.5;

export function isLow(part: number, whole: number): boolean {
  const s = share(part, whole);
  return s !== null && s < LOW_SHARE;
}

export type SortKey =
  | 'name'
  | 'duel_days'
  | 'duel_total'
  | 'donation_days'
  | 'donation_total'
  | 'black_gold'
  | 'buildings'
  | `typed:${string}`;

/** The figure a column sorts by. Null is "nothing to judge" and sorts last
 * whichever way the column is turned — an unread member is not the worst. */
export function sortValue(row: ParticipationRow, key: SortKey): number | string | null {
  switch (key) {
    case 'name':
      return (row.current_name ?? '').toLocaleLowerCase();
    case 'duel_days':
      return share(row.duel_days_scored, row.duel_days_read);
    case 'duel_total':
      return row.duel_total;
    case 'donation_days':
      return share(row.donation_days_scored, row.donation_days_read);
    case 'donation_total':
      return row.donation_total;
    case 'black_gold':
      return share(row.black_gold_played, row.black_gold_listed);
    case 'buildings':
      return row.season_levels_gained;
    default: {
      const tally = row.typed_events[key.slice('typed:'.length)];
      return tally === undefined ? null : share(tally.attended, tally.held);
    }
  }
}

export function sortRows(
  rows: readonly ParticipationRow[],
  key: SortKey,
  descending: boolean,
): ParticipationRow[] {
  return [...rows].sort((left, right) => {
    const l = sortValue(left, key);
    const r = sortValue(right, key);
    if (l === null && r === null) return 0;
    if (l === null) return 1;
    if (r === null) return -1;
    const order = l < r ? -1 : l > r ? 1 : 0;
    return descending ? -order : order;
  });
}
