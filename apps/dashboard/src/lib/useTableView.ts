import { useCallback, useMemo, useState } from 'react';
import { type SortState, nextSort, searchRows, sortRows } from './tableControls';

/** Search box + sortable headers for one table.
 *
 * Search runs before sort so the count reflects what is on screen.
 *
 * `searchFields` must be a stable reference — declare it as a module-level
 * constant, not an inline array, or every render rebuilds the view.
 */
export function useTableView<T extends object>(
  rows: readonly T[],
  searchFields: readonly (keyof T & string)[],
) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState | null>(null);

  const view = useMemo(
    () => sortRows(searchRows(rows, query, searchFields), sort),
    [rows, query, searchFields, sort],
  );

  const onSort = useCallback((key: string) => {
    setSort((current) => nextSort(current, key));
  }, []);

  return { query, setQuery, sort, onSort, view, shown: view.length, total: rows.length };
}
