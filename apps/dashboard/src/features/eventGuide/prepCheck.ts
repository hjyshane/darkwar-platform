// The prepare-now checklist against the viewer's own stock (0310).
//
// Pure: the stock is the planner's `Account` shape from account_state_latest
// (features/planner/accounts.ts), the same gate and the same path. "412 held
// → 309,000 pts on day 2" is `min(floor(held / unit), cap) × per_unit_points`.
// A viewer with no linked account gets the rule only: every figure null.

import type { Account } from '../planner/accounts';
import type { PrepItem, PrepPayload } from './sections/prep';

export type Stock = Pick<Account, 'items' | 'resources'>;

export interface PrepLine {
  item: PrepItem;
  /** Units of stock held, or null when the stock does not say (no account,
   * a kind that is not stock, or an id the login never listed). Null is not
   * zero: an empty cell is a gap in what we read, not an empty bag. */
  held: number | null;
  /** Scored units that count: floor(held / unit), capped. */
  counted: number | null;
  points: number | null;
  shots: number | null;
}

function heldOf(item: PrepItem, stock: Stock | null): number | null {
  if (stock === null) return null;
  const { kind, id } = item.item_ref;
  const value =
    kind === 'item' ? stock.items[id] : kind === 'resource' ? stock.resources[id] : undefined;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function derivePrep(prep: PrepPayload, stock: Stock | null): PrepLine[] {
  return prep.items.map((item) => {
    const held = heldOf(item, stock);
    if (held === null) return { item, held, counted: null, points: null, shots: null };
    const units = Math.floor(held / item.unit);
    const counted = item.cap === undefined ? units : Math.min(units, item.cap);
    return {
      item,
      held,
      counted,
      points: item.per_unit_points === undefined ? null : counted * item.per_unit_points,
      shots: item.per_unit_shots === undefined ? null : counted * item.per_unit_shots,
    };
  });
}
