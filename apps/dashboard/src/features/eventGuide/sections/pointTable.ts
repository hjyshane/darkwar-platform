// `point_table`: what scores on one day (or in one theme) and for how much (0309).
//
// One section per day. The importer writes these from game_event_scores for
// client-sourced activities, with `score_id` on each row and no `item_ref`;
// game_event_score_items supplies the item at render time (scoreItems.ts).
// An officer-typed table carries `item_ref` on the row itself.

import { compact, intIn, isRecord, list, nullStr, num, optNum, optStr, str } from './common';
import { type ItemRef, parseItemRef } from './itemRef';

export interface PointRow {
  /** "Consume 1 orange hero shard" — the client's action text, or the officer's. */
  action: string;
  /** Points paid per `per` units of the item (per action when `per` is absent). */
  points: number;
  /** The client's score id, on imported rows. */
  score_id?: string;
  item_ref?: ItemRef;
  /** Units of the item one payment of `points` is made for. */
  per?: number;
  /** Officer's note, e.g. "best on day 2". */
  best_day_hint?: string;
}

export interface PointTablePayload {
  /** Day of the event (1-based), or null for a theme that is not tied to a
   * day (Survival Preparedness themes rotate through slots). */
  day: number | null;
  theme: string | null;
  rows: PointRow[];
}

function parseRow(value: unknown): PointRow | null {
  if (!isRecord(value)) return null;
  const action = str(value.action);
  const points = num(value.points);
  if (action === null || points === null) return null;
  const item_ref = value.item_ref === undefined ? undefined : parseItemRef(value.item_ref);
  if (item_ref === null) return null;
  return compact({
    action,
    points,
    score_id: optStr(value.score_id),
    item_ref,
    per: optNum(value.per),
    best_day_hint: optStr(value.best_day_hint),
  });
}

export function parsePointTable(value: unknown): PointTablePayload | null {
  if (!isRecord(value)) return null;
  const day = value.day === null || value.day === undefined ? null : intIn(value.day, 1, 60);
  if (value.day !== null && value.day !== undefined && day === null) return null;
  const rows = list(value.rows, parseRow);
  return rows === null ? null : { day, theme: nullStr(value.theme), rows };
}
