// game_event_score_items laid over a client point table (0310).
//
// The client's score table names an action but no item, so the importer's
// point_table rows carry a `score_id` and nothing else. Officers map a score
// id to an item once; at render time a row with no item_ref of its own takes
// the map's entry. bestDays and the prep check read the merged rows, so they
// work on imported data as soon as the map is filled.

import { type ItemRef, parseItemRef } from './sections/itemRef';
import type { PointTablePayload } from './sections/pointTable';

export interface ScoreItem {
  item_ref: ItemRef;
  /** Units of the item one scored action consumes. */
  per: number;
}

export type ScoreItemMap = Map<string, ScoreItem>;

/** From `game_event_score_items` rows. A row whose item_ref does not parse is
 * dropped — a half-typed mapping must not attach a wrong item to a score. */
export function scoreItemMapFrom(
  rows: readonly { score_id: string; item_ref: unknown; per: number | null }[],
): ScoreItemMap {
  const out: ScoreItemMap = new Map();
  for (const row of rows) {
    const item_ref = parseItemRef(row.item_ref);
    if (item_ref === null) continue;
    out.set(row.score_id, { item_ref, per: row.per !== null && row.per > 0 ? row.per : 1 });
  }
  return out;
}

/** A new table whose bare rows (no item_ref, a score_id the map knows) carry
 * the map's item and per. A row that already names its item is kept as it is:
 * the officer who typed it saw the row; the map did not. */
export function mergeScoreItems(table: PointTablePayload, map: ScoreItemMap): PointTablePayload {
  return {
    ...table,
    rows: table.rows.map((row) => {
      if (row.item_ref !== undefined || row.score_id === undefined) return row;
      const mapped = map.get(row.score_id);
      return mapped === undefined ? row : { ...row, item_ref: mapped.item_ref, per: mapped.per };
    }),
  };
}
