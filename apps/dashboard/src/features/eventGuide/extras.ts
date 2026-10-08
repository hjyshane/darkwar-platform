// What sits around the guide's score lists: what is running right now, the
// best things to do in a theme, the alliance's own event times, and the Duel
// score board. Pure, so each claim can be checked on its own; every clock is
// server time, UTC-2.

import { resetWeekStart } from '@dw/game-clock';
import { SERVER_ZONE, zonedDayKey } from '../../lib/timezone';
import { type ScoreSource, type Theme, actionText, scoresOf, slotStart } from './guide';

/** The theme the current Survival Preparedness slot runs, and when it hands
 * over. Null where the game has not told us what runs now. */
export function runningNow(
  grid: readonly (readonly (string | null)[])[],
  themes: readonly Theme[],
  here: { weekday: number; slot: number },
): { name: string; until: string } | null {
  const eventId = grid[here.slot - 1]?.[here.weekday - 1] ?? null;
  if (eventId === null) return null;
  const name = themes.find((theme) => theme.event_id === eventId)?.name ?? eventId;
  return { name, until: slotStart(here.slot + 1) };
}

/** The best things to do in one theme, as sentences: the first rows of
 * `scoresOf`, which is already best per unit first. */
export function bestActions(
  scores: readonly ScoreSource[],
  activity: string,
  eventId: string,
  count: number,
): string[] {
  return scoresOf(scores, activity, eventId)
    .slice(0, count)
    .map((row) => actionText(row.action, row.per_value));
}

export interface TimeRow {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
}

export type TimeState = 'ahead' | 'running' | 'over';

/** Where an event the game told us about stands. With no end time a started
 * event is "over": we cannot say it is still running. */
export function timeState(row: TimeRow, now: Date): TimeState {
  const at = now.getTime();
  if (Date.parse(row.startsAt) > at) return 'ahead';
  if (row.endsAt !== null && Date.parse(row.endsAt) > at) return 'running';
  return 'over';
}

export interface MemberName {
  player_id: string;
  current_name: string | null;
}

export interface DuelReading {
  player_id: string;
  duel_daily_score: number | null;
  duel_daily_updated_at: string | null;
  duel_weekly_score: number | null;
  duel_weekly_updated_at: string | null;
}

export interface DuelLine {
  playerId: string;
  name: string;
  daily: number | null;
  weekly: number | null;
  /** The daily reading was taken on today's server day. Yesterday's is still
   * shown, but it is not today's score. */
  dailyToday: boolean;
  /** The weekly reading was taken in the game week now running. */
  weeklyThisWeek: boolean;
}

export type DuelSort = 'daily' | 'weekly';

/** The Duel board for the members on the roster, best first by the column
 * asked for. A member with no reading sinks to the bottom with a dash: no
 * reading is not a score of zero. */
export function duelBoard(
  members: readonly MemberName[],
  readings: readonly DuelReading[],
  now: Date,
  sort: DuelSort,
): DuelLine[] {
  const byPlayer = new Map(readings.map((reading) => [reading.player_id, reading]));
  const today = zonedDayKey(now.toISOString(), SERVER_ZONE);
  const weekStart = resetWeekStart(now).getTime();
  const lines = members.map((member): DuelLine => {
    const reading = byPlayer.get(member.player_id);
    const dailyAt = reading?.duel_daily_updated_at ?? null;
    const weeklyAt = reading?.duel_weekly_updated_at ?? null;
    return {
      playerId: member.player_id,
      name: member.current_name ?? 'Unnamed',
      daily: reading?.duel_daily_score ?? null,
      weekly: reading?.duel_weekly_score ?? null,
      dailyToday: dailyAt !== null && zonedDayKey(dailyAt, SERVER_ZONE) === today,
      weeklyThisWeek: weeklyAt !== null && Date.parse(weeklyAt) >= weekStart,
    };
  });
  const key = (line: DuelLine) => (sort === 'daily' ? line.daily : line.weekly);
  return lines.sort((a, b) => {
    const left = key(a);
    const right = key(b);
    if (left === null && right === null) return a.name.localeCompare(b.name);
    if (left === null) return 1;
    if (right === null) return -1;
    return right - left || a.name.localeCompare(b.name);
  });
}

/** How many members have a reading that belongs to today / this week. */
export function duelCoverage(lines: readonly DuelLine[]): { today: number; week: number } {
  return {
    today: lines.filter((line) => line.daily !== null && line.dailyToday).length,
    week: lines.filter((line) => line.weekly !== null && line.weeklyThisWeek).length,
  };
}
