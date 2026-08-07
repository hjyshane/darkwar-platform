import type { ReactNode } from 'react';
import { useMemo } from 'react';
import type { SortState } from '../lib/tableControls';
import { type ColumnSpec, arrangeColumns, columnWidth } from '../lib/tableLayout';
import { useTableLayout } from '../lib/useTableLayout';
import { SortableTh } from './SortableTh';

/** A column, declared rather than hand-written.
 *
 * The renderer stays with the table — `cell` is a function the table supplies,
 * not something generic that would have to know about freshness badges and rank
 * dropdowns. What this adds over fifteen hand-written `<th>`s is that the set of
 * columns becomes a VALUE: something an admin can reorder, hide and size, and
 * something a settings screen can list without importing the table's markup.
 */
export interface Column<Row> extends ColumnSpec {
  /** What `useTableView` orders by. Omit for a column with nothing to sort on —
   * a row of buttons, say — and it renders a plain header. */
  sortKey?: string;
  numeric?: boolean;
  /** `label` or `rank`: the stylesheet pins those columns on narrow screens, and
   * the header must carry the same marker as its cells. */
  className?: string;
  cell: (row: Row) => ReactNode;
  /** Extra class decided by the VALUE rather than by the column — growth is green
   * or red by its sign. */
  cellClassName?: (row: Row) => string;
  cellTitle?: (row: Row) => string | undefined;
}

/** A table that reads the shared column arrangement.
 *
 * ONE PLACE, so a table joins by declaring columns and picking an id: no table
 * has to reimplement the colgroup, the arrangement lookup or the sortable header.
 * That was the whole reason only the members table had this — every other table
 * hand-wrote its headers, and adding the feature meant editing each one.
 *
 * Tables with a shape this cannot express keep their own markup and share only
 * `Column` and `arrangeColumns` — the members table does, because it draws a
 * heading row between rank groups.
 */
export function ArrangedTable<Row>({
  tableId,
  columns,
  rows,
  rowKey,
  sort = null,
  onSort,
}: {
  tableId: string;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string | number;
  sort?: SortState | readonly SortState[] | null;
  /** Omit on a table that does not sort. Every column then renders a plain
   * header, whatever `sortKey` says. */
  onSort?: (key: string, additive: boolean) => void;
}) {
  const layout = useTableLayout(tableId);
  const arranged = useMemo(
    () => arrangeColumns(columns, layout) as Column<Row>[],
    [columns, layout],
  );

  return (
    <div className="table-wrap">
      <table>
        {/* Widths in a colgroup rather than a style on every cell: one element per
            column instead of one per cell, and the browser applies it to the
            column as a whole. */}
        <colgroup>
          {arranged.map((column) => {
            const width = columnWidth(layout, column.id);
            return <col key={column.id} style={width === undefined ? undefined : { width }} />;
          })}
        </colgroup>
        <thead>
          <tr>
            {arranged.map((column) =>
              column.sortKey === undefined || onSort === undefined ? (
                <th
                  key={column.id}
                  className={[column.numeric === true ? 'num' : '', column.className ?? '']
                    .filter(Boolean)
                    .join(' ')}
                  scope="col"
                >
                  {column.label}
                </th>
              ) : (
                <SortableTh
                  key={column.id}
                  className={column.className}
                  numeric={column.numeric}
                  onSort={onSort}
                  sort={sort}
                  sortKey={column.sortKey}
                >
                  {column.label}
                </SortableTh>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {arranged.map((column) => (
                <td
                  key={column.id}
                  className={[
                    column.numeric === true ? 'num' : '',
                    column.className ?? '',
                    column.cellClassName?.(row) ?? '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  title={column.cellTitle?.(row)}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
