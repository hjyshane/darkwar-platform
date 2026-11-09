import { describe, expect, it } from 'vitest';
import { bestDays } from './bestDays';
import { HALLOWEEN_POINT_TABLES, SHARD } from './sections/fixtures';
import type { PointTablePayload } from './sections/pointTable';

describe('bestDays', () => {
  const best = bestDays(HALLOWEEN_POINT_TABLES);

  it('the orange hero shard: 750 on day 2, 500 on days 5 and 6 → day 2', () => {
    expect(best.get('item:253042')).toEqual({ days: [2], points: 750 });
  });

  it('a tie lists every day, ascending', () => {
    expect(best.get('resource:25')).toEqual({ days: [1, 3], points: 0.01 });
  });

  it('an item seen on one day only has no best day', () => {
    expect(best.has('item:200036')).toBe(false);
  });

  it('a row with no item_ref is not an item', () => {
    expect([...best.keys()].sort()).toEqual(['item:253042', 'resource:25']);
  });

  it('compares per unit, so 500 per 1 beats 750 per 10', () => {
    const tables: PointTablePayload[] = [
      { day: 1, theme: null, rows: [{ action: 'a', points: 750, item_ref: SHARD, per: 10 }] },
      { day: 2, theme: null, rows: [{ action: 'a', points: 500, item_ref: SHARD, per: 1 }] },
    ];
    expect(bestDays(tables).get('item:253042')).toEqual({ days: [2], points: 500 });
  });

  it('a row paying per 0 units is skipped, not divided by', () => {
    const tables: PointTablePayload[] = [
      { day: 1, theme: null, rows: [{ action: 'a', points: 100, item_ref: SHARD, per: 0 }] },
      { day: 2, theme: null, rows: [{ action: 'a', points: 5, item_ref: SHARD, per: 1 }] },
      { day: 3, theme: null, rows: [{ action: 'a', points: 5, item_ref: SHARD, per: 1 }] },
    ];
    expect(bestDays(tables).get('item:253042')).toEqual({ days: [2, 3], points: 5 });
  });

  it('a table with no day, and the same day listed in two tables, count as they should', () => {
    const tables: PointTablePayload[] = [
      { day: null, theme: 'slot', rows: [{ action: 'a', points: 900, item_ref: SHARD, per: 1 }] },
      { day: 4, theme: 'a', rows: [{ action: 'a', points: 5, item_ref: SHARD, per: 1 }] },
      { day: 4, theme: 'b', rows: [{ action: 'a', points: 7, item_ref: SHARD, per: 1 }] },
    ];
    expect(bestDays(tables).has('item:253042')).toBe(false);
  });
});
