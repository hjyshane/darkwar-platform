// `prep`: the prepare-now checklist — what to hoard, with caps (0309).
//
// prepCheck.ts evaluates these against the viewer's own stock.

import { compact, intIn, isRecord, list, optNum } from './common';
import { type ItemRef, parseItemRef } from './itemRef';

export interface PrepItem {
  item_ref: ItemRef;
  /** Stock units that make one scored unit (1 for a shard; 1000 for a
   * resource scored "per 1,000"). Defaults to 1. */
  unit: number;
  per_unit_points?: number;
  /** For ammo-like items: shots each unit buys rather than points. */
  per_unit_shots?: number;
  /** Most scored units that count (per the event or per `day`). */
  cap?: number;
  /** The day the item is best spent, when the table has one. */
  day?: number;
}

export interface PrepPayload {
  items: PrepItem[];
}

function parseItem(value: unknown): PrepItem | null {
  if (!isRecord(value)) return null;
  const item_ref = parseItemRef(value.item_ref);
  if (item_ref === null) return null;
  const unit = value.unit === undefined ? 1 : optNum(value.unit);
  if (unit === undefined || unit <= 0) return null;
  const day = value.day === undefined ? undefined : intIn(value.day, 1, 60);
  if (day === null) return null;
  return compact({
    item_ref,
    unit,
    per_unit_points: optNum(value.per_unit_points),
    per_unit_shots: optNum(value.per_unit_shots),
    cap: optNum(value.cap),
    day,
  });
}

export function parsePrep(value: unknown): PrepPayload | null {
  if (!isRecord(value)) return null;
  const items = list(value.items, parseItem);
  return items === null ? null : { items };
}
