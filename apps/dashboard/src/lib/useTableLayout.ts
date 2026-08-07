import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { TABLE_LAYOUT_KEY, type TableLayout, type TableLayouts } from './tableLayout';

/** The shared column arrangement, for every table at once.
 *
 * One query and one cache entry, because the settings row holds every table: a
 * screen with two tables should not fetch it twice, and React Query dedupes on the
 * key rather than on the caller.
 *
 * A FAILURE IS AN ABSENT ARRANGEMENT, NOT AN ERROR. `app_settings` is readable by
 * members, but a logged-out reader gets 42501 — and the right response to that is
 * the table's declared column order, not a broken screen. The same applies to a
 * malformed value: an admin cannot make the members table unrenderable by saving
 * something odd.
 */
export function useTableLayouts() {
  return useQuery({
    queryKey: ['table-layout'],
    // It changes when an admin rearranges a table, which is rare, and it is read on
    // most screens.
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<TableLayouts> => {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', TABLE_LAYOUT_KEY)
        .maybeSingle();
      if (error) {
        if (error.code === '42501') {
          return {};
        }
        throw new Error(`table layout query failed: ${error.message}`);
      }
      const value = data?.value;
      return value !== null && typeof value === 'object' ? (value as TableLayouts) : {};
    },
  });
}

/** One table's arrangement. Undefined until the query answers, which callers treat
 * as "no arrangement" — rendering the declared order for a beat is better than
 * rendering nothing. */
export function useTableLayout(tableId: string): TableLayout | undefined {
  const { data } = useTableLayouts();
  return data?.[tableId];
}
