// The two-week grid, against the same vectors the SQL is checked with.
// Both implementations reading one file is what keeps them from drifting —
// the game week rule has been kept honest this way since 0001.
import { expect, test } from 'vitest';
import vectors from '../../../protocol-fixtures/rank-period/vectors.json';
import { rankPeriodEnd, rankPeriodStart, rankPeriodWeekEnds } from '../src/lib/rankPeriod';

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

  expect(first.toISOString()).toBe('2026-08-03T01:59:00.000Z');
  expect(second.toISOString()).toBe('2026-08-10T01:59:00.000Z');
  // Each is inside the period it belongs to. A reading at 02:00 would fall
  // in the next week and score zero, which is the mistake this pins.
  expect(rankPeriodStart(first).toISOString()).toBe(start.toISOString());
  expect(second.getTime()).toBeLessThan(rankPeriodEnd(start).getTime());
});
