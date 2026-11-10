import { resetWeekStart } from '@dw/game-clock';
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

/** The period ranks are decided over.
 *
 * UNTIL 0316 THIS FILE OWNED A COPY OF THE GRID: every other Monday 02:00 UTC
 * from the 2026-08-03 epoch, two weeks each, checked against the same vectors
 * the SQL is. A period can now be set by hand (`rank_period_overrides`), the
 * fortnights around it re-anchor and get cut short, and the answer depends on
 * a table. A second implementation would have to fetch that table and apply
 * the same three rules, which is exactly the kind of copy that drifts — so the
 * rule lives in SQL only (`rank_period_bounds`) and this file asks for it.
 *
 * What stays here is arithmetic on a period once its bounds are known: which
 * day it covers last, when its weekly readings are taken, and whether a date
 * typed into a box is a reset the game actually performs.
 */
export interface RankPeriod {
  start: Date;
  /** The BOUNDARY — the instant the next period begins — not the last day. */
  end: Date;
  /** Set by hand rather than by the grid. */
  overridden: boolean;
  inProgress: boolean;
}

const WEEK_MS = 604_800_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** The last GAME DAY the period covers, for printing.
 *
 * `end` is the boundary, and printing its date reads as if that day were
 * inside this period. The screen said "3 Aug to 17 Aug", which is a fortnight
 * and a day.
 *
 * A WHOLE DAY, not a minute, and the first attempt got this backwards. The
 * game's day runs 02:00 to 02:00 and is named by the date it STARTS on, so the
 * period 3 Aug 02:00 → 17 Aug 02:00 does contain the first two hours of the
 * 17th — but those hours belong to the game day called the 16th. Subtracting a
 * minute lands at 17 Aug 01:59 and prints "17 Aug", which is the bug.
 */
export function rankPeriodLastDay(end: Date): Date {
  return new Date(end.getTime() - DAY_MS);
}

/** The moments each week's contribution is read at: 14:00Z on the Sunday of
 * every week the period has, twelve hours before the game clears the boards at
 * the Monday 02:00 reset — noon on the game's own clock (UTC−2; 0309). One
 * entry per week, so a one-week period has one and a three-week period three.
 * Reading at or after 02:00 would score everybody at zero, which is why these
 * are not the period's own boundaries. Mirrors `rank_period_reading_ends`. */
export function rankPeriodReadingEnds(start: Date, end: Date): Date[] {
  const weeks = Math.floor((end.getTime() - start.getTime()) / WEEK_MS);
  return Array.from(
    { length: Math.max(weeks, 0) },
    (_unused, index) => new Date(start.getTime() + (index + 1) * WEEK_MS - 12 * HOUR_MS),
  );
}

/** How many whole weeks the period runs. */
export function rankPeriodWeeks(start: Date, end: Date): number {
  return Math.max(Math.floor((end.getTime() - start.getTime()) / WEEK_MS), 0);
}

/** Whether an instant is a weekly reset — Monday 02:00 UTC — which is the only
 * kind of instant a period may start or end on. The function behind the save
 * says the same in words; this lets the form say it before the round trip. */
export function isResetBoundary(ts: Date): boolean {
  return resetWeekStart(ts).getTime() === ts.getTime();
}

/** The reset boundaries around now, for a picker: `before` weeks back through
 * `after` weeks ahead, oldest first. A list rather than a free date box, because
 * every entry has to be a reset the game performs. */
export function resetBoundariesAround(now: Date, before: number, after: number): Date[] {
  const thisWeek = resetWeekStart(now).getTime();
  return Array.from(
    { length: before + after + 1 },
    (_unused, index) => new Date(thisWeek + (index - before) * WEEK_MS),
  );
}

interface PeriodRow {
  period_start: string;
  period_end: string;
  overridden: boolean;
  in_progress: boolean;
}

/** The period in force and the ones before it, newest first, as the database
 * resolves them for the alliance on screen. */
export async function fetchRecentRankPeriods(count: number): Promise<RankPeriod[]> {
  const { data, error } = await supabase.rpc('recent_rank_periods', { p_count: count });
  if (error) {
    throw new Error(`rank periods query failed: ${error.message}`);
  }
  return ((data ?? []) as PeriodRow[]).map((row) => ({
    start: new Date(row.period_start),
    end: new Date(row.period_end),
    overridden: row.overridden,
    inProgress: row.in_progress,
  }));
}

export function useRecentRankPeriods(count: number) {
  return useQuery({
    queryKey: ['rank-periods', count],
    queryFn: () => fetchRecentRankPeriods(count),
  });
}

export interface RankPeriodOverride {
  id: string;
  start: Date;
  end: Date;
  note: string | null;
  createdAt: Date;
}

/** Every period set by hand for the alliance on screen, newest first. */
export async function fetchRankPeriodOverrides(): Promise<RankPeriodOverride[]> {
  const { data, error } = await supabase
    .from('rank_period_overrides')
    .select('override_id, period_start, period_end, note, created_at')
    .order('period_start', { ascending: false })
    .limit(200);
  if (error) {
    throw new Error(`hand-set periods query failed: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    id: row.override_id,
    start: new Date(row.period_start),
    end: new Date(row.period_end),
    note: row.note,
    createdAt: new Date(row.created_at),
  }));
}

export function useRankPeriodOverrides() {
  return useQuery({ queryKey: ['rank-period-overrides'], queryFn: fetchRankPeriodOverrides });
}

export async function saveRankPeriodOverride(entry: {
  start: Date;
  end: Date;
  note: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc('save_rank_period_override', {
    p_period_start: entry.start.toISOString(),
    p_period_end: entry.end.toISOString(),
    p_note: entry.note,
  });
  if (error) {
    throw new Error(error.message);
  }
  return data as string;
}

export async function deleteRankPeriodOverride(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_rank_period_override', { p_override_id: id });
  if (error) {
    throw new Error(error.message);
  }
}
