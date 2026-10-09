import { SERVER_ZONE, zonedDayKey, zonedTime } from '../../lib/timezone';

// What scores in Survival Preparedness and the Alliance Duel (0248).
//
// Pure functions only: the tables are the game's (dw-collector game-event-guide)
// and every clock here is SERVER TIME, UTC-2, the one the members read.

export const SURVIVAL = '100004';
export const DUEL = '70005';

export interface Theme {
  activity_id: string;
  event_id: string;
  day: number | null;
  name: string | null;
  name_ko: string | null;
  min_day_score: number | null;
  min_week_score: number | null;
}

export interface ScoreSource {
  activity_id: string;
  event_id: string;
  score_id: string;
  action: string | null;
  per_value: number;
  points: number;
  sort_order: number;
}

export interface CalendarSlot {
  activity_id: string;
  day: number;
  slot: number;
  event_id: string;
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** Hours one Survival Preparedness slot lasts (`actTime` is 240 minutes). */
export const SLOT_HOURS = 4;

const two = (n: number) => String(n).padStart(2, '0');

/** `08:00` for the slot that starts there; slot 1 opens at 00:00 server time. */
export function slotStart(slot: number): string {
  return `${two(((slot - 1) * SLOT_HOURS) % 24)}:00`;
}

/** The sentence a score row reads as: the game's `{0}` is the amount one
 * payment is made for, so "Use {0} Gears" at 1 reads "Use 1 Gears". Rows
 * without a placeholder (Open 1 Orange-quality Chip Chest) are left alone. */
export function actionText(action: string | null, perValue: number): string {
  if (action === null) return 'Unnamed action';
  return action.replace(/\{0\}/g, String(perValue));
}

/** `+300`, or `+10 per 100` where the points are paid per hundred. */
export function pointsText(points: number): string {
  return `+${points.toLocaleString('en')}`;
}

/** Themes of one activity in the order they are listed: the Duel by weekday,
 * Survival Preparedness by event id. */
export function themesOf(themes: readonly Theme[], activity: string): Theme[] {
  return themes
    .filter((theme) => theme.activity_id === activity)
    .sort((a, b) => (a.day ?? 0) - (b.day ?? 0) || a.event_id.localeCompare(b.event_id));
}

/** What scores in one theme, best first: the biggest payment is what a reader
 * is looking for, not the order the game happens to list it in. */
export function scoresOf(
  scores: readonly ScoreSource[],
  activity: string,
  eventId: string,
): ScoreSource[] {
  return scores
    .filter((score) => score.activity_id === activity && score.event_id === eventId)
    .sort((a, b) => b.points / b.per_value - a.points / a.per_value || a.sort_order - b.sort_order);
}

/** The week as a grid: `grid[slot - 1][day - 1]` is the event id running then,
 * or null where the game has not told us. */
export function weekGrid(calendar: readonly CalendarSlot[], activity: string): (string | null)[][] {
  const grid: (string | null)[][] = Array.from({ length: 6 }, () =>
    Array.from({ length: 7 }, () => null),
  );
  for (const cell of calendar) {
    if (cell.activity_id !== activity) continue;
    const row = grid[cell.slot - 1];
    if (row !== undefined && cell.day >= 1 && cell.day <= 7) row[cell.day - 1] = cell.event_id;
  }
  return grid;
}

/** The Duel runs Monday to Saturday and repeats every week; Sunday has none. */
export const DUEL_DAYS = [1, 2, 3, 4, 5, 6] as const;

/** Duel days (Mon-Sat) with no theme loaded yet: a gap in what the collector has
 * read, not a rest day. Sunday is never listed, it has no Duel. */
export function missingDuelDays(themes: readonly Theme[]): number[] {
  const known = new Set(themesOf(themes, DUEL).map((theme) => theme.day));
  return DUEL_DAYS.filter((day) => !known.has(day));
}

/** Where the game's clock is right now: the weekday (Monday = 1) and the
 * Survival Preparedness slot (1 = 00:00-04:00), both in server time, so the
 * page can mark what is running. */
export function serverNow(now: Date): { weekday: number; slot: number } {
  const [year, month, day] = zonedDayKey(now.toISOString(), SERVER_ZONE).split('-').map(Number);
  const sunday0 = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)).getUTCDay();
  const hour = Number(zonedTime(now.toISOString(), SERVER_ZONE).slice(0, 2));
  return { weekday: sunday0 === 0 ? 7 : sunday0, slot: Math.floor(hour / SLOT_HOURS) + 1 };
}

/** Relative worth of one scoring row, 0 to 1, against the best in its theme:
 * the width of the bar beside it. Per unit, so "+10 per 100" is not drawn as
 * bigger than "+300 per 1". */
export function worth(row: Pick<ScoreSource, 'points' | 'per_value'>, best: number): number {
  return best <= 0 ? 0 : Math.min(1, row.points / row.per_value / best);
}

/** The best per-unit payment among a theme's rows. */
export function bestPerUnit(rows: readonly Pick<ScoreSource, 'points' | 'per_value'>[]): number {
  return rows.reduce((best, row) => Math.max(best, row.points / row.per_value), 0);
}
