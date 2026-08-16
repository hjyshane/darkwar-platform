import { describe, expect, test } from 'vitest';
import { occurrences } from '../src/features/schedule/schedule';
import { SERVER_ZONE, fromInputValue } from '../src/lib/timezone';

/** Expanding "every Monday, four times" into four wall clocks.
 *
 * The expansion is deliberately done on the WALL CLOCK rather than by adding
 * 24 hours to an instant. Both are right in server time, which has no summer
 * time — but a reader who switched the picker to their own zone and made a
 * weekly series across a clock change would get half of it an hour out, and
 * would have no reason to look.
 */

describe('occurrences', () => {
  test('a count of one is a one-off', () => {
    expect(occurrences('2026-08-17T20:00', 'week', 1)).toEqual(['2026-08-17T20:00']);
  });

  test('four Mondays are four Mondays', () => {
    expect(occurrences('2026-08-17T20:00', 'week', 4)).toEqual([
      '2026-08-17T20:00',
      '2026-08-24T20:00',
      '2026-08-31T20:00',
      '2026-09-07T20:00',
    ]);
  });

  test('daily crosses a month end without arithmetic of its own', () => {
    expect(occurrences('2026-08-30T09:00', 'day', 3)).toEqual([
      '2026-08-30T09:00',
      '2026-08-31T09:00',
      '2026-09-01T09:00',
    ]);
  });

  test('the clock never moves, only the date', () => {
    // Across the October clock change in Paris. Adding 7×24h to the instant
    // would produce 19:00 for the occurrences after it; the wall clock does not.
    const weeks = occurrences('2026-10-19T20:00', 'week', 3);
    expect(weeks.every((value) => value.endsWith('T20:00'))).toBe(true);
    // And in server time those are three different instants, two hours apart
    // from the wall clock, with no summer time anywhere in it.
    expect(fromInputValue(weeks[2] as string, SERVER_ZONE)).toBe('2026-11-02T22:00:00.000Z');
  });

  test('a malformed start is returned rather than multiplied', () => {
    // The form can hold an empty or half-typed value while somebody is still
    // typing. Expanding that into 52 broken rows is worse than doing nothing.
    expect(occurrences('', 'week', 4)).toEqual(['']);
  });
});
