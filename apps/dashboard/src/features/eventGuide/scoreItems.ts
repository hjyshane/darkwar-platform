// game_event_score_items: the item a client score id consumes (0310).
//
// The client's score table names an action but no item, so the importer's
// point_table rows carry a `score_id` and nothing else. Officers map a score
// id to an item once, in the admin editor; one row serves every event that
// reuses the id.

import { type ItemRef, parseItemRef } from './sections/itemRef';

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
