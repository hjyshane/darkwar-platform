// What is left of the period arithmetic once the rule itself moved to SQL
// (0315): printing a period's last day, placing its weekly readings, and
// telling a reset boundary from any other instant. The grid and the hand-set
// periods are pinned in supabase/tests/315_rank_periods_set_by_hand_test.sql
// and 27_rank_period_test.sql; nothing here re-implements them.
import { describe, expect, test } from 'vitest';
import {
  isResetBoundary,
  rankPeriodLastDay,
  rankPeriodReadingEnds,
  rankPeriodWeeks,
  resetBoundariesAround,
} from '../src/lib/rankPeriod';

describe('rankPeriodLastDay', () => {
  test('is the day before the boundary, not the boundary', () => {
    // The screen read "3 Aug to 17 Aug", which is a fortnight and a day: the
    // 17th at 02:00 is where the NEXT period starts. The last day covered is
    // the 16th, and printing the boundary's date claimed otherwise.
    const end = new Date('2026-08-17T02:00:00Z');
    expect(rankPeriodLastDay(end).toISOString().slice(0, 10)).toBe('2026-08-16');
  });

  test('stays inside the period at the 02:00 reset', () => {
    // Subtracting a whole day lands on 16 Aug 02:00 — inside the period, and
    // on the game day the 16th names. A minute would print the 17th.
    const start = new Date('2026-08-03T02:00:00Z');
    const end = new Date('2026-08-17T02:00:00Z');
    expect(rankPeriodLastDay(end).getTime()).toBeLessThan(end.getTime());
    expect(rankPeriodLastDay(end).getTime()).toBeGreaterThan(start.getTime());
  });
});

describe('rankPeriodReadingEnds', () => {
  test('a fortnight is read twice, at Sunday 14:00Z, twelve hours before the boards clear', () => {
    const ends = rankPeriodReadingEnds(
      new Date('2026-08-03T02:00:00Z'),
      new Date('2026-08-17T02:00:00Z'),
    );
    // 12:00 server time (UTC−2) on the Sunday; the reset is Monday 02:00Z.
    expect(ends.map((d) => d.toISOString())).toEqual([
      '2026-08-09T14:00:00.000Z',
      '2026-08-16T14:00:00.000Z',
    ]);
  });

  test('a period set by hand is read once per week it has', () => {
    const one = rankPeriodReadingEnds(
      new Date('2026-11-09T02:00:00Z'),
      new Date('2026-11-16T02:00:00Z'),
    );
    expect(one.map((d) => d.toISOString())).toEqual(['2026-11-15T14:00:00.000Z']);

    const three = rankPeriodReadingEnds(
      new Date('2027-01-11T02:00:00Z'),
      new Date('2027-02-01T02:00:00Z'),
    );
    expect(three).toHaveLength(3);
    // Every reading is before the period's end: one at the boundary would fall
    // in the next week and score zero, which is the mistake this pins.
    for (const reading of three) {
      expect(reading.getTime()).toBeLessThan(new Date('2027-02-01T02:00:00Z').getTime());
    }
  });

  test('counts whole weeks', () => {
    expect(
      rankPeriodWeeks(new Date('2026-11-16T02:00:00Z'), new Date('2026-12-14T02:00:00Z')),
    ).toBe(4);
    expect(
      rankPeriodWeeks(new Date('2026-11-16T02:00:00Z'), new Date('2026-11-16T02:00:00Z')),
    ).toBe(0);
  });
});

describe('reset boundaries', () => {
  test('Monday 02:00 UTC is one and nothing else is', () => {
    expect(isResetBoundary(new Date('2026-11-16T02:00:00Z'))).toBe(true);
    expect(isResetBoundary(new Date('2026-11-16T02:00:01Z'))).toBe(false);
    expect(isResetBoundary(new Date('2026-11-17T02:00:00Z'))).toBe(false);
    expect(isResetBoundary(new Date('2026-11-16T00:00:00Z'))).toBe(false);
  });

  test('the picker offers real resets around now, oldest first', () => {
    // A Wednesday. This week's reset is Monday the 9th.
    const around = resetBoundariesAround(new Date('2026-11-11T12:00:00Z'), 2, 1);
    expect(around.map((d) => d.toISOString())).toEqual([
      '2026-10-26T02:00:00.000Z',
      '2026-11-02T02:00:00.000Z',
      '2026-11-09T02:00:00.000Z',
      '2026-11-16T02:00:00.000Z',
    ]);
    for (const boundary of around) {
      expect(isResetBoundary(boundary)).toBe(true);
    }
  });
});
