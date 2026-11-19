// Our alliance's Overview (owner, 2026-11-19): the duel and every alliance
// event of the last fortnight, each as one line.
//
// THREE SOURCES, none of them new:
//   alliance_daily_contribution (0074)  our duel points per game day
//   event_verdicts (0290)               every typed or captured event: Frankie,
//                                       Capital Clash, Server Clash and whatever
//                                       else an officer has named
//   black_money_battles (0181)          Black Gold, with the result
//
// NO DUEL WIN OR LOSS. Nothing the collector reads says who the duel was
// against or who won it: the boards it captures are our own members' points.
// The page says so instead of showing a result it would have to invent.
//
// One row per member per event comes back from event_verdicts, so it is read in
// pages (PostgREST stops at 1,000 without saying so) and folded here into one
// row per event.

import { fetchAllPages } from '../../lib/fetchAllPages';
import { supabase } from '../../lib/supabase';

/** How far back the Overview looks. */
export const OVERVIEW_DAYS = 14;
const DAY_MS = 24 * 3_600_000;

/** The window, anchored to the UTC day so the query key holds still while the
 * page is open. It runs a day past now, like `event_board`, so an event dated
 * on today's game day is inside it whatever the hour. */
export function overviewWindow(now: Date): { from: string; to: string; fromDay: string } {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const from = new Date(today - OVERVIEW_DAYS * DAY_MS).toISOString();
  return { from, to: new Date(today + 2 * DAY_MS).toISOString(), fromDay: from.slice(0, 10) };
}

/** One member on one event, as `event_verdicts` returns it. */
export interface Verdict {
  kind: string;
  held_on: string;
  round: number;
  /** True was there, false was not, null is not known (never "absent"). */
  attended: boolean | null;
  score: number | null;
  damage: number | null;
}

export async function fetchVerdicts(from: string, to: string): Promise<Verdict[]> {
  const rows = await fetchAllPages((first, last) =>
    supabase
      .rpc('event_verdicts', { p_from: from, p_to: to })
      // A total order, or two pages can share a row and drop another.
      .order('held_on')
      .order('kind')
      .order('round')
      .order('player_id')
      .range(first, last),
  );
  return rows.map((row) => ({
    kind: row.kind,
    held_on: row.held_on,
    round: Number(row.round),
    // Null at runtime for "not known", whatever the generated type says.
    attended: row.attended as boolean | null,
    score: (row.score as number | null) === null ? null : Number(row.score),
    damage: (row.damage as number | null) === null ? null : Number(row.damage),
  }));
}

/** One event across the alliance. */
export interface EventSummary {
  kind: string;
  day: string;
  round: number;
  present: number;
  absent: number;
  unknown: number;
  /** Null when nobody has a score on it, which is not a total of zero. */
  totalScore: number | null;
  totalDamage: number | null;
}

/** One row per event, newest first. Pure, so it is tested alone. */
export function foldVerdicts(rows: readonly Verdict[]): EventSummary[] {
  const byEvent = new Map<string, EventSummary>();
  for (const row of rows) {
    const key = `${row.held_on}|${row.kind}|${row.round}`;
    let event = byEvent.get(key);
    if (event === undefined) {
      event = {
        kind: row.kind,
        day: row.held_on,
        round: row.round,
        present: 0,
        absent: 0,
        unknown: 0,
        totalScore: null,
        totalDamage: null,
      };
      byEvent.set(key, event);
    }
    if (row.attended === true) event.present += 1;
    else if (row.attended === false) event.absent += 1;
    else event.unknown += 1;
    // Somebody ticked absent has no score; the database withholds it too.
    if (row.attended !== false) {
      if (row.score !== null) event.totalScore = (event.totalScore ?? 0) + row.score;
      if (row.damage !== null) event.totalDamage = (event.totalDamage ?? 0) + row.damage;
    }
  }
  return [...byEvent.values()].sort(
    (a, b) => b.day.localeCompare(a.day) || a.kind.localeCompare(b.kind) || b.round - a.round,
  );
}

/** One game day of our duel board (0074: the day's largest reading). */
export interface DuelDay {
  game_day: string;
  total: number | null;
  members_counted: number;
}

export async function fetchDuelDays(allianceId: string, fromDay: string): Promise<DuelDay[]> {
  const { data, error } = await supabase
    .from('alliance_daily_contribution')
    .select('game_day, total, members_counted')
    .eq('alliance_id', allianceId)
    .eq('kind', 'alliance_battle_daily')
    .gte('game_day', fromDay)
    .order('game_day', { ascending: false })
    .limit(100);
  if (error) {
    throw new Error(`duel query failed: ${error.message}`);
  }
  return (data ?? []) as DuelDay[];
}

export interface DuelSummary {
  /** Days with a reading above zero: Sunday's board reads 0 for everybody. */
  days: number;
  total: number;
  best: { day: string; total: number } | null;
  latest: { day: string; total: number } | null;
}

export function summariseDuel(rows: readonly DuelDay[]): DuelSummary {
  const read = rows
    .filter((row): row is DuelDay & { total: number } => row.total !== null && row.total > 0)
    .map((row) => ({ day: row.game_day, total: row.total }))
    .sort((a, b) => b.day.localeCompare(a.day));
  return {
    days: read.length,
    total: read.reduce((sum, row) => sum + row.total, 0),
    best: read.reduce<{ day: string; total: number } | null>(
      (top, row) => (top === null || row.total > top.total ? row : top),
      null,
    ),
    latest: read[0] ?? null,
  };
}

/** Where an event's own page is. Anything without one is on Participation. */
export function eventHref(kind: string): string {
  switch (kind) {
    case 'frankie':
      return '#/frankie';
    case 'capital_clash':
      return '#/capital-clash';
    case 'server_clash':
      return '#/server-clash';
    default:
      return '#/participation';
  }
}

/** `season_clash` -> "Season clash", for an event the settings do not name. */
export function kindLabel(kind: string, labels: Readonly<Record<string, string>>): string {
  const named = labels[kind];
  if (named !== undefined) return named;
  const words = kind.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The events the Overview always answers for, held or not: a line saying
 * "none in the window" beats a reader wondering whether it was looked for.
 * Every other event (a season clash, a merchant war) shows only when held. */
export const ALWAYS_LISTED: readonly string[] = ['frankie', 'capital_clash', 'server_clash'];
