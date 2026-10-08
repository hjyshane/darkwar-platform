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

/** Days of the week the Duel has no theme for yet: the game only sends a theme
 * the week it runs, so a day nobody has logged in on is a gap, not a rest day. */
export function missingDuelDays(themes: readonly Theme[]): number[] {
  const known = new Set(themesOf(themes, DUEL).map((theme) => theme.day));
  return [1, 2, 3, 4, 5, 6, 7].filter((day) => !known.has(day));
}
