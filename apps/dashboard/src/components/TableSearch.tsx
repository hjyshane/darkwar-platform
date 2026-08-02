import { useId } from 'react';

/** Filter-as-you-type over a table, with the count of what survived.
 *
 * The count is the point of showing it: with a filter applied, "4 rows" is
 * ambiguous between "four matched" and "there are only four" — and this app
 * has spent a lot of effort elsewhere on not letting absence read as fact.
 *
 * It says what it counts. A bare "100" beside a search box is a number with
 * no noun: rows, matches, members, or something about the search itself —
 * the reader cannot tell, and the one case it most needs to be clear about
 * is the filtered one.
 */
export function TableSearch({
  value,
  onChange,
  label,
  unit,
  shown,
  total,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  /** Plural noun for what a row is here — "members", "entries", "alliances". */
  unit: string;
  shown: number;
  total: number;
  /** Extra controls for this table — the favourites filter, so far. */
  children?: React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="toolbar">
      <label className="search" htmlFor={id}>
        <span className="visually-hidden">{label}</span>
        <input
          autoComplete="off"
          id={id}
          onChange={(event) => onChange(event.target.value)}
          placeholder={label}
          type="search"
          value={value}
        />
      </label>
      <output className="count" htmlFor={id}>
        {value.trim() === '' ? `${total} ${unit}` : `${shown} of ${total} ${unit}`}
      </output>
      {children}
    </div>
  );
}
