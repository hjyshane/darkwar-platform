// Best day per item, derived from the point tables and never stored (0310).
//
// For each item_ref that appears in point_table rows across the days, the day
// its unit pays most, ties listed. Shown only when the item appears on at
// least two distinct days: a best day read off one table is not a comparison,
// it is a guess, and the spec's anti-goal is exactly that guess.

import { itemRefKey } from './sections/itemRef';
import type { PointTablePayload } from './sections/pointTable';

export interface BestDay {
  /** Days (ascending) paying the most per unit; more than one on a tie. */
  days: number[];
  /** Points per unit of the item on those days. */
  points: number;
}

/** Keyed by `itemRefKey`. A row with no item_ref, a per of 0 or less, or a
 * table with no day takes no part. The same item twice on one day counts as
 * one day at its better rate. */
export function bestDays(tables: readonly PointTablePayload[]): Map<string, BestDay> {
  // item → day → best per-unit points that day
  const perItem = new Map<string, Map<number, number>>();
  for (const table of tables) {
    if (table.day === null) continue;
    for (const row of table.rows) {
      if (row.item_ref === undefined) continue;
      const per = row.per ?? 1;
      if (per <= 0) continue;
      const perUnit = row.points / per;
      const key = itemRefKey(row.item_ref);
      const days = perItem.get(key) ?? new Map<number, number>();
      days.set(table.day, Math.max(days.get(table.day) ?? Number.NEGATIVE_INFINITY, perUnit));
      perItem.set(key, days);
    }
  }

  const out = new Map<string, BestDay>();
  for (const [key, days] of perItem) {
    if (days.size < 2) continue;
    const points = Math.max(...days.values());
    const best = [...days.entries()]
      .filter(([, value]) => value === points)
      .map(([day]) => day)
      .sort((a, b) => a - b);
    out.set(key, { days: best, points });
  }
  return out;
}
