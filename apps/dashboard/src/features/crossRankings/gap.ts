// How far each row is behind the one above it, for the ranking tables.

import type { SortState } from '../../lib/tableControls';

/** For each row, the amount it is short of the row before it; null for the first
 * row and wherever either figure is unknown. Only meaningful when the rows are
 * in board order, which `inBoardOrder` decides: sorted by name, the row above is
 * simply a different player and the difference means nothing. */
export function gapsToAbove(rows: readonly { value: number | null }[]): (number | null)[] {
  return rows.map((row, index) => {
    const above = index === 0 ? undefined : rows[index - 1];
    if (above === undefined || above.value === null || row.value === null) return null;
    return Math.max(above.value - row.value, 0);
  });
}

/** Whether the table is showing the board's own order with nothing filtered out:
 * rank ascending or value descending, and no search. A search removes the true
 * neighbours, so the row above is no longer the one to pass. */
export function inBoardOrder(sort: readonly SortState[], query: string): boolean {
  if (query.trim() !== '') return false;
  const first = sort[0];
  if (first === undefined) return true;
  return (
    (first.key === 'rank' && first.direction === 'asc') ||
    (first.key === 'value' && first.direction === 'desc')
  );
}
