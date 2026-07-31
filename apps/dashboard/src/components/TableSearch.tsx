import { useId } from 'react';

/** Filter-as-you-type over a table, with the count of what survived.
 *
 * The count is the point of showing it: with a filter applied, "4 rows" is
 * ambiguous between "four matched" and "there are only four" — and this app
 * has spent a lot of effort elsewhere on not letting absence read as fact.
 */
export function TableSearch({
  value,
  onChange,
  label,
  shown,
  total,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
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
        {value.trim() === '' ? `${total}` : `${shown} / ${total}`}
      </output>
      {children}
    </div>
  );
}
