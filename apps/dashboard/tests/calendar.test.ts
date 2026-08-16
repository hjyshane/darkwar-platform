import { describe, expect, test } from 'vitest';
import {
  type CalendarView,
  calendarRange,
  dayKey,
  isOutsideMonth,
  shiftAnchor,
  startOfWeek,
} from '../src/lib/calendar';

/** Grid arithmetic, which is the part of a calendar that is wrong silently.
 *
 * A range off by a day does not throw. It draws a calendar that looks entirely
 * normal and is missing Sunday, and the entry nobody saw was the one that
 * mattered — which is the whole reason this file exists rather than a screenshot.
 */

const AUG = (day: number, hour = 12) => new Date(Date.UTC(2026, 7, day, hour));

/** `noUncheckedIndexedAccess` is on, and a silently-undefined day would make
 *  these assertions pass by comparing nothing to nothing. */
function nth(days: Date[], index: number): Date {
  const day = days[index];
  if (day === undefined) {
    throw new Error(`no day at index ${index}`);
  }
  return day;
}

describe('weeks', () => {
  test('start on Monday, taken from the game week rather than reinvented', () => {
    // 2026-08-20 is a Thursday.
    expect(dayKey(startOfWeek(AUG(20)))).toBe('2026-08-17');
    expect(new Date(dayKey(startOfWeek(AUG(20)))).getUTCDay()).toBe(1);
  });

  test('Monday before 02:00 UTC still belongs to the week it opens', () => {
    // The game week turns over at 02:00, so 01:00 on Monday is the PREVIOUS
    // game week. The grid draws whole days and puts it under that Monday
    // anyway: a calendar cell that starts at 02:00 files a 01:00 entry under
    // Sunday, which is not what anybody scanning for "what is on Monday" means.
    expect(dayKey(startOfWeek(AUG(17, 1)))).toBe('2026-08-10');
    expect(dayKey(nth(calendarRange('week', AUG(17, 1)).days, 0))).toBe('2026-08-10');
  });

  test('a week is seven days and a fortnight is fourteen', () => {
    expect(calendarRange('week', AUG(20)).days).toHaveLength(7);
    expect(calendarRange('fortnight', AUG(20)).days).toHaveLength(14);
  });

  test('the range is half-open so an entry at midnight lands in one cell', () => {
    const range = calendarRange('week', AUG(20));
    expect(range.start.toISOString()).toBe('2026-08-17T00:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-08-24T00:00:00.000Z');
  });
});

describe('month', () => {
  test('is padded to whole weeks, and the padding days are real days', () => {
    const range = calendarRange('month', AUG(20));
    expect(range.days.length % 7).toBe(0);
    // August 2026 starts on a Saturday, so the grid opens on 27 July.
    expect(dayKey(nth(range.days, 0))).toBe('2026-07-27');
    expect(isOutsideMonth(nth(range.days, 0), AUG(20))).toBe(true);
    expect(isOutsideMonth(AUG(20), AUG(20))).toBe(false);
  });

  test('does not draw a row belonging entirely to the next month', () => {
    // February 2027 ends on a Sunday. Taking the week of the 1st of March
    // would add seven days none of which are February's or its padding.
    const range = calendarRange('month', new Date(Date.UTC(2027, 1, 10)));
    const last = nth(range.days, range.days.length - 1);
    expect(dayKey(last)).toBe('2027-02-28');
  });
});

describe('stepping', () => {
  test.each<[CalendarView, string]>([
    ['day', '2026-08-21'],
    ['week', '2026-08-27'],
    ['fortnight', '2026-09-03'],
  ])('%s moves by its own length', (view, expected) => {
    expect(dayKey(shiftAnchor(view, AUG(20), 1))).toBe(expected);
  });

  test('month moves a month, not the six weeks it drew', () => {
    expect(dayKey(shiftAnchor('month', AUG(20), 1))).toBe('2026-09-01');
    expect(dayKey(shiftAnchor('month', AUG(20), -1))).toBe('2026-07-01');
  });

  test('stepping a week forward and back returns to the same week', () => {
    const there = shiftAnchor('week', AUG(20), 1);
    const back = shiftAnchor('week', there, -1);
    expect(dayKey(startOfWeek(back))).toBe(dayKey(startOfWeek(AUG(20))));
  });
});
