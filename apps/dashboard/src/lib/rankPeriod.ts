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
// 2026-08-03 02:00 UTC. Moved from 07-27 in 0071: a fortnightly grid has two
// phases, both are real Monday 02:00 boundaries, and the alliance decided
// periods should start this week. The vectors file carries the reasoning and
// both implementations read it.
const PERIOD_EPOCH = Date.UTC(2026, 7, 3, 2);
const WEEK_MS = 604_800_000;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 3600 * 1000;

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

/** The last GAME DAY the period covers, for printing.
 *
 * `rankPeriodEnd` is the BOUNDARY — the instant the next period begins — and
 * printing its date reads as if that day were inside this period. The screen
 * said "3 Aug to 17 Aug", which is a fortnight and a day.
 *
 * A WHOLE DAY, not a minute, and the first attempt got this backwards. The
 * game's day runs 02:00 to 02:00 and is named by the date it STARTS on, so the
 * period 3 Aug 02:00 → 17 Aug 02:00 does contain the first two hours of the
 * 17th — but those hours belong to the game day called the 16th. Subtracting a
 * minute lands at 17 Aug 01:59 and prints "17 Aug", which is the bug.
 */
export function rankPeriodLastDay(periodStart: Date): Date {
  return new Date(rankPeriodEnd(periodStart).getTime() - DAY_MS);
}

/** The period running now and the ones before it, newest first.
 *
 * Here rather than in the admin screen because it is grid arithmetic, and the
 * grid is what this module owns and what the shared vectors check.
 *
 * The screen needs it to offer a choice. It used to report on the newest
 * CLOSED period and nothing else, which on a young database means two empty
 * fortnights — the grid is anchored at 2026-07-27, so the newest closed period
 * predates the collector, and the only period holding captures is the one in
 * progress. A choice of WHICH period is the fix; free date entry would not be,
 * because an arbitrary start puts the two weekly contribution readings
 * somewhere the game never cleared a board.
 */
export function recentRankPeriods(ts: Date, count: number): Date[] {
  const current = rankPeriodStart(ts).getTime();
  return Array.from({ length: count }, (_unused, index) => new Date(current - index * 2 * WEEK_MS));
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
