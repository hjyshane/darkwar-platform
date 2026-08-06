import { useCallback, useMemo, useState } from 'react';
import { type SortState, nextSortKeys, searchRows, sortRows } from './tableControls';

/** Search box + sortable headers for one table.
 *
 * Search runs before sort so the count reflects what is on screen.
 *
 * `searchFields` must be a stable reference — declare it as a module-level
 * constant, not an inline array, or every render rebuilds the view.
 *
 * The sort is a LIST of up to two keys, and it lives here rather than in each
 * table: every table in the app already routes its headers through this hook, so
 * putting the tiebreaker here gives it to all of them instead of only the screen
 * that asked. A table that never receives a shift-click behaves exactly as it did
 * with one key.
 */
export function useTableView<T extends object>(
  rows: readonly T[],
  searchFields: readonly (keyof T & string)[],
  /** The order the QUERY already returned the rows in.
   *
   * Every panel sorts server-side and then handed the table a null sort, so
   * the arrows all read "unsorted" while the rows plainly were — the reader
   * could see an order with nothing on screen accounting for it, and the
   * first click on that same column appeared to do nothing.
   *
   * Passing it here states the order rather than re-deriving it: sortRows
   * reproduces the same sequence, so nothing moves, and the header now says
   * what it is. */
  initialSort: SortState | null = null,
) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState[]>(initialSort === null ? [] : [initialSort]);

  const view = useMemo(
    () => sortRows(searchRows(rows, query, searchFields), sort),
    [rows, query, searchFields, sort],
  );

  // Defaulted rather than required, so a header that only passes a key — every
  // one of them before this change — still compiles and still replaces the sort.
  const onSort = useCallback((key: string, additive = false) => {
    setSort((current) => nextSortKeys(current, key, additive));
  }, []);

  return { query, setQuery, sort, onSort, view, shown: view.length, total: rows.length };
}
