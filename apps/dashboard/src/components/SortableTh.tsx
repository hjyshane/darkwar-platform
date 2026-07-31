import { type SortState, ariaSort } from '../lib/tableControls';

/** A column header you can sort by.
 *
 * The button is inside the th rather than the th being clickable: a th is
 * not focusable or operable by keyboard, and wiring click handlers to one
 * leaves the column unusable without a mouse (NFR-011).
 *
 * `aria-sort` lives on the th, which is where the ARIA spec puts it, and
 * the stylesheet draws the arrow off that same attribute — so what is
 * announced and what is drawn cannot disagree.
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
  sort: SortState | null;
  onSort: (key: string) => void;
  numeric?: boolean;
  /** `rank` or `label` — the stylesheet pins those columns on narrow
   * screens, and the header has to carry the same marker as its cells. */
  className?: string;
  children: React.ReactNode;
}) {
  const active = sort?.key === sortKey;
  const classes = [numeric ? 'num' : null, className].filter(Boolean).join(' ');
  return (
    <th aria-sort={ariaSort(sort, sortKey)} className={classes || undefined} scope="col">
      <button className="sort" onClick={() => onSort(sortKey)} type="button">
        {children}
        <span aria-hidden="true" className="sort-arrow">
          {active ? (sort?.direction === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  );
}
