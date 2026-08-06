import { type SortState, ariaSort, sortLevel } from '../lib/tableControls';

/** A column header you can sort by.
 *
 * The button is inside the th rather than the th being clickable: a th is
 * not focusable or operable by keyboard, and wiring click handlers to one
 * leaves the column unusable without a mouse (NFR-011).
 *
 * `aria-sort` lives on the th, which is where the ARIA spec puts it, and
 * the stylesheet draws the arrow off that same attribute — so what is
 * announced and what is drawn cannot disagree.
 *
 * TWO KEYS. `sort` accepts a list as well as one state, and shift- or
 * ctrl-clicking adds a tiebreaker rather than replacing the sort. A table that
 * passes a single state sees no change at all — including the level number,
 * which only appears once there are two levels to tell apart.
 *
 * The modifier is discoverable from the button's title rather than from a legend
 * on the page: a legend for something most readers never reach for is a line of
 * noise above every table that has one.
 */
export function SortableTh({
  sortKey,
  sort,
  onSort,
  numeric = false,
  className,
  children,
}: {
  sortKey: string;
  sort: SortState | readonly SortState[] | null;
  /** `additive` is true when the reader held shift, ctrl or cmd. A caller that
   * sorts by one key can ignore the second argument. */
  onSort: (key: string, additive: boolean) => void;
  numeric?: boolean;
  /** `rank` or `label` — the stylesheet pins those columns on narrow
   * screens, and the header has to carry the same marker as its cells. */
  className?: string;
  children: React.ReactNode;
}) {
  const keys: readonly SortState[] = sort === null ? [] : Array.isArray(sort) ? sort : [sort];
  const active = keys.find((entry) => entry.key === sortKey);
  const level = sortLevel(sort, sortKey);
  const classes = [numeric ? 'num' : null, className].filter(Boolean).join(' ');
  return (
    <th aria-sort={ariaSort(sort, sortKey)} className={classes || undefined} scope="col">
      <button
        className="sort"
        // Read off the click event, so the keyboard gets it too: shift+Enter on a
        // focused button reports the modifier the same way a shift-click does.
        onClick={(event) => onSort(sortKey, event.shiftKey || event.ctrlKey || event.metaKey)}
        title="Click to sort. Shift-click to sort by this as well, within the first column."
        type="button"
      >
        {children}
        {/* The level before the arrow, so the pair reads "2 ▼": which column,
            then which way. Absent unless two keys are in play. */}
        {level !== null && <span className="sort-level">{level}</span>}
        <span aria-hidden="true" className="sort-arrow">
          {active === undefined ? '↕' : active.direction === 'asc' ? '▲' : '▼'}
        </span>
      </button>
    </th>
  );
}
