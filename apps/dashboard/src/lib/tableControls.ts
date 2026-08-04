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

/** Sort by `key`, keeping unknown values at the end whichever way it runs. */
export function sortRows<T extends object>(rows: readonly T[], sort: SortState | null): T[] {
  if (sort === null) {
    return [...rows];
  }
  const factor = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => {
    const a = read(left, sort.key);
    const b = read(right, sort.key);
    const aMissing = a === null || a === undefined;
    const bMissing = b === null || b === undefined;
    if (aMissing || bMissing) {
      // Not multiplied by factor: reversing the sort must not promote
      // "unknown" to the top of the table.
      return aMissing && bMissing ? 0 : aMissing ? 1 : -1;
    }
    return compare(a, b) * factor;
  });
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

/** Why a table's view came out empty — the reason, deliberately not the
 * sentence.
 *
 * The tables that call this say "member", "alliance" and "player", and the
 * roster has a case the others do not: your starred players can all be real
 * and none of them be on THIS board. A helper that returned finished copy
 * would pull all three toward one "No rows matched", which is exactly the
 * flattening the empty-state wording elsewhere in this app was written to
 * avoid ("never observed" and "not yours to see" are not the same fact).
 *
 * The bug this exists for: the starred filter runs before the search, so a
 * table filtered to nothing by the STAR while the search box was empty
 * printed `No member matches ""` — an empty pair of quotes. It is reachable
 * because `useFavourites` counts favourites globally, not per table: star a
 * player on a server drill-down, open Members, press the toggle.
 */
export function emptyViewReason(
  query: string,
  starredOnly: boolean,
): 'search' | 'starred' | 'starred-search' | null {
  const searching = query.trim() !== '';
  if (starredOnly) {
    return searching ? 'starred-search' : 'starred';
  }
  return searching ? 'search' : null;
}

/** The value for a th's aria-sort attribute. */
export function ariaSort(
  current: SortState | null,
  key: string,
): 'ascending' | 'descending' | undefined {
  if (current === null || current.key !== key) {
    return undefined;
  }
  return current.direction === 'asc' ? 'ascending' : 'descending';
}
