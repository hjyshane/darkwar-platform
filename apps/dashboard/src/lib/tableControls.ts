// Sorting and searching for the ranking tables.
//
// Pure functions over rows, so the behaviour that matters — chiefly what
// happens to unknown values — is testable without rendering anything.
//
// The rule that drives the rest: **a missing value is not a small one**
// (FR-ACT-004, and the reason every table already prints "—" rather than 0).
// Sorting nulls as zero would put an unobserved player at the bottom of a
// power ranking as though we had measured them and found nothing. They go
// last in BOTH directions instead: last is "we do not know", which is true
// either way round.

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  key: string;
  direction: SortDirection;
}

type Comparable = string | number | boolean | null | undefined;

function compare(a: Comparable, b: Comparable): number {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return Number(a) - Number(b);
  }
  // localeCompare so Korean and Latin names order sensibly next to each
  // other; numeric so "Member2" precedes "Member10".
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

// Rows are plain objects, but the constraint stops at `object` rather than
// `Record<string, unknown>`: an interface has no implicit index signature, so
// the stricter constraint makes every caller's row type widen to unknown at
// the point of use. The lookups below are cast instead, in one place.
function read(row: object, key: string): Comparable {
  return (row as Record<string, Comparable>)[key];
}

/** How many keys a table sorts by at once.
 *
 * Two. One cannot answer "the R3s, weakest first" — that is a single question
 * needing two keys. Three is a control nobody can predict from looking at it,
 * because the third key only ever breaks ties the second already broke. */
export const MAX_SORT_KEYS = 2;

/** One key's comparison, unknowns last in both directions. */
function compareBy<T extends object>(left: T, right: T, sort: SortState): number {
  const a = read(left, sort.key);
  const b = read(right, sort.key);
  const aMissing = a === null || a === undefined;
  const bMissing = b === null || b === undefined;
  if (aMissing || bMissing) {
    // Not multiplied by the direction: reversing the sort must not promote
    // "unknown" to the top of the table.
    return aMissing && bMissing ? 0 : aMissing ? 1 : -1;
  }
  return compare(a, b) * (sort.direction === 'asc' ? 1 : -1);
}

/** Sort by one or two keys, keeping unknown values at the end whichever way
 * each one runs.
 *
 * The second key speaks only where the first ties, which is the whole point:
 * rank and then power answers "who in each rank is strongest", and no single key
 * can. Rows still tied after the last key keep their existing order — sort is
 * stable, so the previous arrangement shows through instead of the table
 * reshuffling on every render.
 */
export function sortRows<T extends object>(
  rows: readonly T[],
  sort: SortState | readonly SortState[] | null,
): T[] {
  const keys: readonly SortState[] = sort === null ? [] : Array.isArray(sort) ? sort : [sort];
  if (keys.length === 0) {
    return [...rows];
  }
  return [...rows].sort((left, right) => {
    for (const key of keys) {
      const result = compareBy(left, right, key);
      if (result !== 0) {
        return result;
      }
    }
    return 0;
  });
}

/** Click a header when a table sorts by more than one key.
 *
 * A plain click means "sort by this, only this" — the common case, and it must
 * not silently keep a second key the reader may have forgotten setting. Shift or
 * Ctrl adds a key, or flips one already there.
 *
 * At the cap, an added key replaces the LAST one rather than the first. The
 * primary key is what the reader is thinking about; the tiebreaker is the part
 * they are still adjusting.
 */
export function nextSortKeys(
  current: readonly SortState[],
  key: string,
  additive: boolean,
): SortState[] {
  const at = current.findIndex((entry) => entry.key === key);
  if (!additive) {
    // Flip only when it is ALREADY the primary key. Plain-clicking a column that
    // happens to be the tiebreaker promotes it, descending, like a fresh column.
    return current[0]?.key === key ? [flip(current[0])] : [{ key, direction: 'desc' }];
  }
  if (at >= 0) {
    return current.map((entry, index) => (index === at ? flip(entry) : entry));
  }
  const kept = current.slice(0, MAX_SORT_KEYS - 1);
  return [...kept, { key, direction: 'desc' }];
}

function flip(sort: SortState): SortState {
  return { key: sort.key, direction: sort.direction === 'desc' ? 'asc' : 'desc' };
}

/** Which sort level a column holds, 1-based, or null when it is not sorted.
 *
 * Only worth showing when there are two: a lone "1" next to the arrow is noise,
 * and the arrow already says the column is sorted.
 */
export function sortLevel(
  sort: SortState | readonly SortState[] | null,
  key: string,
): number | null {
  const keys: readonly SortState[] = sort === null ? [] : Array.isArray(sort) ? sort : [sort];
  if (keys.length < 2) {
    return null;
  }
  const at = keys.findIndex((entry) => entry.key === key);
  return at < 0 ? null : at + 1;
}

/** Case- and accent-insensitive substring match over the named fields. */
export function searchRows<T extends object>(
  rows: readonly T[],
  query: string,
  fields: readonly (keyof T & string)[],
): T[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === '') {
    return [...rows];
  }
  return rows.filter((row) =>
    fields.some((field) => {
      const value = read(row, field);
      if (value === null || value === undefined) {
        return false;
      }
      return String(value).toLocaleLowerCase().includes(needle);
    }),
  );
}

/** Click a header: first click sorts descending, clicking again flips it.
 *
 * Descending first because every column worth sorting here is a ranking —
 * power, kills, score — and "who is top" is the question being asked. An
 * ascending first click would answer the opposite one. */
export function nextSort(current: SortState | null, key: string): SortState {
  if (current === null || current.key !== key) {
    return { key, direction: 'desc' };
  }
  return { key, direction: current.direction === 'desc' ? 'asc' : 'desc' };
}

/** The value for a th's aria-sort attribute.
 *
 * Reported for the tiebreaker as well as the primary key. `aria-sort` has no way
 * to say "second", so a table sorted two ways announces two sorted columns —
 * which is true, and less misleading than announcing one of them as unsorted.
 */
export function ariaSort(
  current: SortState | readonly SortState[] | null,
  key: string,
): 'ascending' | 'descending' | undefined {
  const keys: readonly SortState[] =
    current === null ? [] : Array.isArray(current) ? current : [current];
  const found = keys.find((entry) => entry.key === key);
  if (found === undefined) {
    return undefined;
  }
  return found.direction === 'asc' ? 'ascending' : 'descending';
}
