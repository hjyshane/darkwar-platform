// The grid a calendar draws, as dates. No React, no queries, no formatting.
//
// EVERYTHING HERE IS UTC, like every other time this dashboard shows. Members
// read the board from at least four time zones and the game's own clock is UTC;
// a calendar that quietly rendered in the reader's zone would put the same bear
// hunt on two different days depending on who was looking, and the runbooks,
// the notices and the rank periods would all disagree with it.
//
// WEEKS START ON MONDAY, taken from `resetWeekStart` rather than worked out
// again here. The game week turns over Monday 02:00 UTC and that rule already
// exists three times over one shared fixture; a fourth copy is exactly what
// CLAUDE.md warns about.
//
// The 02:00 part is deliberately dropped once the Monday is known. Grid cells
// are whole UTC days, because a cell running 02:00 to 02:00 files a 01:00 event
// under the previous day — correct by the game's week rule, and wrong to
// anybody scanning a calendar for "what is on Tuesday". The week this grid
// draws therefore holds the same Monday as the game week; an entry in the first
// two hours of it belongs to the previous game week and is drawn here anyway.

import { resetWeekStart } from './resetWeek';

export type CalendarView = 'day' | 'week' | 'fortnight' | 'month';

export const CALENDAR_VIEWS: ReadonlyArray<{ view: CalendarView; label: string }> = [
  { view: 'day', label: 'Day' },
  { view: 'week', label: 'Week' },
  { view: 'fortnight', label: '2 weeks' },
  { view: 'month', label: 'Month' },
];

export interface CalendarRange {
  /** First instant drawn, inclusive. */
  start: Date;
  /** First instant NOT drawn. Half-open so a query is `gte.start&lt.end` and
   *  an entry at exactly midnight belongs to one cell rather than two. */
  end: Date;
  /** Midnight UTC of each day in the range, in order. */
  days: Date[];
}

const DAY_MS = 86_400_000;

/** Midnight UTC of the day `ts` falls in. */
export function startOfDay(ts: Date): Date {
  return new Date(Date.UTC(ts.getUTCFullYear(), ts.getUTCMonth(), ts.getUTCDate()));
}

/** Midnight UTC of the Monday whose game week contains `ts`. */
export function startOfWeek(ts: Date): Date {
  return startOfDay(resetWeekStart(ts));
}

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

function daysBetween(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  for (let at = start; at < end; at = addDays(at, 1)) {
    out.push(at);
  }
  return out;
}

/** What a view draws when it is anchored on `anchor`.
 *
 * The month view is padded out to whole Mondays-to-Sundays, which is why it can
 * return 28 to 42 days rather than the length of the month: a month grid with a
 * ragged first row is harder to read than one with a few greyed-out days, and
 * the padding days are real days that may hold entries.
 */
export function calendarRange(view: CalendarView, anchor: Date): CalendarRange {
  if (view === 'day') {
    const start = startOfDay(anchor);
    return { start, end: addDays(start, 1), days: [start] };
  }
  if (view === 'week' || view === 'fortnight') {
    const start = startOfWeek(anchor);
    const end = addDays(start, view === 'week' ? 7 : 14);
    return { start, end, days: daysBetween(start, end) };
  }
  const firstOfMonth = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  const nextMonth = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1));
  const start = startOfWeek(firstOfMonth);
  // The week containing the last day, not the week containing the first day of
  // next month: a month ending on a Sunday would otherwise draw an eighth row
  // of days that belong entirely to the month after it.
  const end = addDays(startOfWeek(addDays(nextMonth, -1)), 7);
  return { start, end, days: daysBetween(start, end) };
}

/** The anchor one step earlier or later in the same view.
 *
 * Stepping by the VIEW rather than by a fixed unit is what makes the arrows
 * feel right: the month view moves a month even though it drew six weeks, and
 * the fortnight moves a fortnight rather than landing halfway through itself.
 */
export function shiftAnchor(view: CalendarView, anchor: Date, direction: -1 | 1): Date {
  if (view === 'month') {
    return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + direction, 1));
  }
  const step = view === 'day' ? 1 : view === 'week' ? 7 : 14;
  return addDays(startOfDay(anchor), step * direction);
}

/** Whether `day` sits outside the month `anchor` names. Month view only —
 *  the padding days are drawn, and drawn dimmer. */
export function isOutsideMonth(day: Date, anchor: Date): boolean {
  return (
    day.getUTCMonth() !== anchor.getUTCMonth() || day.getUTCFullYear() !== anchor.getUTCFullYear()
  );
}

/** `2026-08-20`, which is both the cell key and what a `<time>` wants. */
export function dayKey(day: Date): string {
  return day.toISOString().slice(0, 10);
}

/** The heading over the grid: what you are looking at, in words. */
export function rangeLabel(view: CalendarView, anchor: Date): string {
  const range = calendarRange(view, anchor);
  if (view === 'day') {
    return range.start.toUTCString().slice(0, 16);
  }
  if (view === 'month') {
    return `${anchor.toUTCString().slice(8, 11)} ${anchor.getUTCFullYear()}`;
  }
  const last = new Date(range.end.getTime() - DAY_MS);
  return `${range.start.toUTCString().slice(5, 16)} — ${last.toUTCString().slice(5, 16)}`;
}
