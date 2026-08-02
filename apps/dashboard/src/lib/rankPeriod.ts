import { resetWeekStart } from './resetWeek';

/** The two-week period ranks are decided over.
 *
 * Derived from resetWeekStart rather than computed beside it: the period
 * boundary IS a game week boundary, just every other one, so there is only
 * one place that knows what Monday 02:00 UTC means.
 *
 * Implemented here and in SQL (rank_period_start, 0050); both are checked
 * against protocol-fixtures/rank-period/vectors.json. Python has none on
 * purpose — nothing in the collector needs a period, and an implementation
 * with no caller drifts without anyone noticing.
 */
const PERIOD_EPOCH = Date.UTC(2026, 6, 27, 2);
const WEEK_MS = 604_800_000;
const MINUTE_MS = 60_000;

export function rankPeriodStart(ts: Date): Date {
  const week = resetWeekStart(ts).getTime();
  const weeks = Math.floor((week - PERIOD_EPOCH) / WEEK_MS);
  // Floor to an even number of weeks. Written with the double modulo
  // because a negative week count — any date before the epoch — makes the
  // single one negative, and the grid has to hold on both sides of it.
  const even = weeks - (((weeks % 2) + 2) % 2);
  return new Date(PERIOD_EPOCH + even * WEEK_MS);
}

export function rankPeriodEnd(periodStart: Date): Date {
  return new Date(periodStart.getTime() + 2 * WEEK_MS);
}

/** The two moments a week's contribution has to be read at: 01:59Z on the
 * last day of each week, one minute before the game clears the boards.
 * Reading them a minute later would score everybody at zero, which is the
 * whole reason these are not the period's own boundaries. */
export function rankPeriodWeekEnds(periodStart: Date): [Date, Date] {
  return [
    new Date(periodStart.getTime() + WEEK_MS - MINUTE_MS),
    new Date(periodStart.getTime() + 2 * WEEK_MS - MINUTE_MS),
  ];
}
