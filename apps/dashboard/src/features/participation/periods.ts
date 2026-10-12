// The ranges the participation report is read over: the whole season, one
// duel round, or one game week.
//
// Every range is half-open, [from, to), in game time, and every edge is a
// game reset (02:00 UTC). member_participation (0204) counts a day or a week
// when it STARTS inside the range, so adjacent ranges never share a day.

import { resetWeekStart } from '@dw/game-clock';

const DAY_MS = 86_400_000;
const RESET_HOUR_MS = 2 * 3_600_000;

/** Season 3's first game day. Also the anchor duel rounds are counted from
 * (`internal.duel_round_anchor`, 0184): the season and the first round opened
 * together, and every round since is four weeks long.
 *
 * NOT `season_lab.starts_at`. That is when the season-building rank rule
 * switched on, which was weeks into the season. */
export const SEASON_START = '2026-08-17T02:00:00.000Z';

/** The longest range the report answers (0204 returns nothing past it). */
export const MAX_RANGE_DAYS = 190;

const ROUND_DAYS = 28;

export type PeriodKind = 'season' | 'round' | 'week' | 'custom';

export interface Period {
  kind: PeriodKind;
  /** ISO instant, inclusive. */
  from: string;
  /** ISO instant, exclusive. */
  to: string;
  label: string;
}

/** The game day `at` falls in, as its 02:00 UTC start. */
export function gameDayStart(at: Date): Date {
  const shifted = at.getTime() - RESET_HOUR_MS;
  return new Date(Math.floor(shifted / DAY_MS) * DAY_MS + RESET_HOUR_MS);
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function day(ms: number): string {
  return iso(ms).slice(0, 10);
}

/** The season so far, through the end of today's game day. Clamped to the
 * longest range the report will answer, from the end backwards — the recent
 * end is the one an officer is asking about. */
export function seasonPeriod(
  now: Date,
  start: string = SEASON_START,
  name = 'Season 3',
  end: string | null = null,
): Period {
  // A season that has ended stops at its end: the break after it is not part
  // of it (2026-10-11).
  const today = gameDayStart(now).getTime() + DAY_MS;
  const to = end === null ? today : Math.min(today, Date.parse(end));
  const from = Math.max(Date.parse(start), to - MAX_RANGE_DAYS * DAY_MS);
  return { kind: 'season', from: iso(from), to: iso(to), label: `${name} (since ${day(from)})` };
}

/** Every duel round that has started, newest first. */
export function roundPeriods(
  now: Date,
  start: string = SEASON_START,
  end: string | null = null,
): Period[] {
  const anchor = Date.parse(start);
  const limit = end === null ? now.getTime() : Math.min(now.getTime(), Date.parse(end) - 1);
  const rounds: Period[] = [];
  for (let start = anchor, n = 1; start <= limit; start += ROUND_DAYS * DAY_MS, n += 1) {
    const end = start + ROUND_DAYS * DAY_MS;
    rounds.push({
      kind: 'round',
      from: iso(start),
      to: iso(end),
      label: `Round ${n}: ${day(start)} – ${day(end - DAY_MS)}`,
    });
  }
  return rounds.reverse();
}

/** Every game week of the season that has started, newest first. */
export function weekPeriods(
  now: Date,
  start: string = SEASON_START,
  end: string | null = null,
): Period[] {
  const first = Date.parse(start);
  const limit = end === null ? now : new Date(Math.min(now.getTime(), Date.parse(end) - 1));
  const weeks: Period[] = [];
  for (let start = resetWeekStart(limit).getTime(); start >= first; start -= 7 * DAY_MS) {
    weeks.push({
      kind: 'week',
      from: iso(start),
      to: iso(start + 7 * DAY_MS),
      label: `Week of ${day(start)}`,
    });
  }
  return weeks;
}

/** A range an officer typed: two game dates, both inclusive (YYYY-MM-DD).
 *
 * Null when either is missing or malformed, when the end is before the start,
 * or when the start is in the future. A range longer than the report answers
 * (MAX_RANGE_DAYS) is cut from its START, keeping the recent end, and the
 * label says so. The end is also cut at today: a game day that has not begun
 * has nothing to count. */
export function customPeriod(fromDate: string, toDate: string, now: Date): Period | null {
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!pattern.test(fromDate) || !pattern.test(toDate)) return null;
  const startMs = Date.parse(`${fromDate}T00:00:00.000Z`) + RESET_HOUR_MS;
  const endMs = Date.parse(`${toDate}T00:00:00.000Z`) + RESET_HOUR_MS + DAY_MS;
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) return null;
  const today = gameDayStart(now).getTime() + DAY_MS;
  if (startMs >= today) return null;
  const to = Math.min(endMs, today);
  const from = Math.max(startMs, to - MAX_RANGE_DAYS * DAY_MS);
  const cut = from > startMs;
  return {
    kind: 'custom',
    from: iso(from),
    to: iso(to),
    label: `${day(from)} – ${day(to - DAY_MS)}${cut ? ` (last ${MAX_RANGE_DAYS} days of the range)` : ''}`,
  };
}

/** The game date (YYYY-MM-DD) `at` falls on, as the attendance form wants it. */
export function gameDate(at: Date): string {
  return day(gameDayStart(at).getTime());
}
