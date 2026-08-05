// The two-week grid, against the same vectors the SQL is checked with.
// Both implementations reading one file is what keeps them from drifting —
// the game week rule has been kept honest this way since 0001.
import { expect, test } from 'vitest';
import vectors from '../../../protocol-fixtures/rank-period/vectors.json';
import {
  rankPeriodEnd,
  rankPeriodStart,
  rankPeriodWeekEnds,
  recentRankPeriods,
} from '../src/lib/rankPeriod';

for (const vector of vectors.vectors) {
  test(`rankPeriodStart: ${vector.name}`, () => {
    expect(rankPeriodStart(new Date(vector.input)).toISOString()).toBe(
      new Date(vector.expected).toISOString(),
    );
  });
}

test('a period is exactly two weeks, and the next one starts where it ends', () => {
  const start = rankPeriodStart(new Date('2026-08-05T13:45:12Z'));
  const end = rankPeriodEnd(start);

  expect(end.getTime() - start.getTime()).toBe(14 * 24 * 3600 * 1000);
  // The boundary belongs to the period it opens, not the one it closes.
  expect(rankPeriodStart(end).toISOString()).toBe(end.toISOString());
});

test('the weekly readings land a minute before the boards clear', () => {
  const start = rankPeriodStart(new Date('2026-08-05T13:45:12Z'));
  const [first, second] = rankPeriodWeekEnds(start);

  expect(first.toISOString()).toBe('2026-08-10T01:59:00.000Z');
  expect(second.toISOString()).toBe('2026-08-17T01:59:00.000Z');
  // Each is inside the period it belongs to. A reading at 02:00 would fall
  // in the next week and score zero, which is the mistake this pins.
  expect(rankPeriodStart(first).toISOString()).toBe(start.toISOString());
  expect(second.getTime()).toBeLessThan(rankPeriodEnd(start).getTime());
});

test('recentRankPeriods walks the grid backwards from the one running now', () => {
  // A Wednesday inside the 2026-07-27 period.
  const periods = recentRankPeriods(new Date('2026-08-05T12:00:00Z'), 4);

  expect(periods.map((d) => d.toISOString())).toEqual([
    '2026-08-03T02:00:00.000Z',
    '2026-07-20T02:00:00.000Z',
    '2026-07-06T02:00:00.000Z',
    '2026-06-22T02:00:00.000Z',
  ]);
});

test('every offered period is a real grid start, including before the epoch', () => {
  // The reason the picker offers a list instead of a date field: each entry
  // has to be a start rankPeriodStart would itself return, or the two weekly
  // readings land where the game never cleared a board.
  for (const start of recentRankPeriods(new Date('2026-08-05T12:00:00Z'), 12)) {
    expect(rankPeriodStart(start).toISOString()).toBe(start.toISOString());
  }
});

test('the first entry is the period in progress, not the newest closed one', () => {
  // What this screen got wrong: it reported on the newest CLOSED period only,
  // which on this grid is 2026-07-13 — before the collector existed. Every
  // figure read zero and the dates looked stale, because they were.
  const now = new Date('2026-08-05T12:00:00Z');
  const periods = recentRankPeriods(now, 1);

  expect(periods).toHaveLength(1);
  const first = periods[0] as Date;
  expect(first.toISOString()).toBe(rankPeriodStart(now).toISOString());
  expect(rankPeriodEnd(first).getTime()).toBeGreaterThan(now.getTime());
});
