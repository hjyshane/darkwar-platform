import { type ReactNode, useState } from 'react';
import './console.css';

export interface StepColumn<Row> {
  key: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  /** Right-aligned tabular figures (`.num`, the same hook every table uses). */
  numeric?: boolean;
}

export interface StepTableProps<Row> {
  columns: readonly StepColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** Rendered last, in the foot, on the raised surface with amber figures. */
  total?: Row;
  /** Rows beyond this many hide behind "Show all N" until clicked. Exactly
   * this many shows them all with no control. */
  foldAt?: number;
  caption?: string;
}

const DEFAULT_FOLD = 20;

/** A step-by-step cost table: one row per upgrade step, costs as columns,
 * a total row, and a fold so a 52-step table opens short. Generic over the
 * row type; the caller decides what a cell says. */
export function StepTable<Row>({
  columns,
  rows,
  rowKey,
  total,
  foldAt = DEFAULT_FOLD,
  caption,
}: StepTableProps<Row>) {
  const [open, setOpen] = useState(false);
  const folded = !open && rows.length > foldAt;
  const shown = folded ? rows.slice(0, foldAt) : rows;
  return (
    <div className="step-table-wrap">
      <table className="step-table">
        {caption && <caption>{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th className={c.numeric ? 'num' : undefined} key={c.key} scope="col">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td className={c.numeric ? 'num' : undefined} key={c.key}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {total !== undefined && (
          <tfoot>
            <tr className="step-total">
              {columns.map((c) => (
                <td className={c.numeric ? 'num' : undefined} key={c.key}>
                  {c.cell(total)}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
      {folded && (
        <button className="step-fold" onClick={() => setOpen(true)} type="button">
          Show all {rows.length}
        </button>
      )}
    </div>
  );
}
