import { useMemo, useState } from 'react';
import { Pager } from '../../components/Pager';
import { SortableTh } from '../../components/SortableTh';
import { TableSearch } from '../../components/TableSearch';
import { type CsvColumn, downloadCsv, toCsv } from '../../lib/csv';
import {
  type GameRow,
  type GameTable,
  type TextMode,
  cellText,
  emptyColumns,
  refTarget,
  viewerHash,
} from '../../lib/gameTables';
import { type SortState, nextSortKeys, searchRows, sortRows } from '../../lib/tableControls';

const PAGE = 100;
const CELL_MAX = 80;
/** The row id's key in a flattened row. No client column is spelled this way. */
const ID_KEY = '__id';

type Flat = Record<string, string | number | boolean | null>;

/** One table's rows, sortable, searchable, paged.
 *
 * Rows are flattened once per language: a localised column becomes its text,
 * a nested table its JSON, so the generic sort and search helpers see plain
 * values and "sort by name" orders the words on screen rather than the keys
 * behind them. The raw value is still drawn from the row itself, so a link or
 * a title can show what the file holds.
 */
export function GameDataGrid({
  table,
  tables,
  mode,
  selected,
  onPickRow,
}: {
  table: GameTable;
  tables: ReadonlySet<string>;
  mode: TextMode;
  selected: string | null;
  onPickRow: (id: string) => void;
}) {
  const { meta, rows, strings } = table;
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState[]>([]);
  const [rawPage, setPage] = useState(1);
  const [hideEmpty, setHideEmpty] = useState(true);
  const localised = useMemo(() => new Set(meta.loc_columns), [meta.loc_columns]);
  const text = mode === 'raw' ? {} : strings[mode];

  // A new filter or sort starts at the first page: page 7 of a table with
  // three pages is a blank screen that looks like an empty table. (A new
  // TABLE remounts this component: the parent keys it by name.)
  const changeQuery = (value: string) => {
    setQuery(value);
    setPage(1);
  };
  const changeSort = (key: string, additive: boolean) => {
    setSort((current) => nextSortKeys(current, key, additive));
    setPage(1);
  };

  const empty = useMemo(() => emptyColumns(meta.columns, rows), [meta.columns, rows]);
  // Nearly every table's first column repeats the row id. The id is the pinned
  // first cell already; drawing it twice costs a column and says nothing.
  const idRepeated = useMemo(
    () => meta.columns.includes('id') && rows.every((row) => String(row.values.id) === row.id),
    [meta.columns, rows],
  );
  const shownColumns = useMemo(
    () =>
      meta.columns.filter(
        (column) => !(hideEmpty && empty.has(column)) && !(idRepeated && column === 'id'),
      ),
    [meta.columns, empty, hideEmpty, idRepeated],
  );
  const targets = useMemo(
    () => new Map(meta.columns.map((column) => [column, refTarget(column, tables)] as const)),
    [meta.columns, tables],
  );

  const flat = useMemo<Flat[]>(
    () =>
      rows.map((row) => {
        const out: Flat = { [ID_KEY]: row.id };
        for (const column of meta.columns) {
          const value = row.values[column];
          out[column] =
            value === null || value === undefined
              ? null
              : typeof value === 'object' || localised.has(column)
                ? cellText(value, localised.has(column), mode, text)
                : value;
        }
        return out;
      }),
    [rows, meta.columns, localised, mode, text],
  );
  const byId = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);

  const searchable = useMemo(() => [ID_KEY, ...shownColumns], [shownColumns]);
  const visible = useMemo(
    () => sortRows(searchRows(flat, query, searchable), sort),
    [flat, query, searchable, sort],
  );
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE));
  const page = Math.min(rawPage, pageCount);
  const slice = visible.slice((page - 1) * PAGE, page * PAGE);

  const exportCsv = () => {
    const columns: CsvColumn<Flat>[] = [
      { header: 'id', value: (row) => row[ID_KEY] },
      ...shownColumns.map((column) => ({
        header: column,
        value: (row: Flat) => row[column],
      })),
    ];
    downloadCsv(`${meta.name}-${mode}.csv`, toCsv(visible, columns));
  };

  return (
    <div className="gd-grid">
      <div className="gd-toolbar">
        <TableSearch
          label={`Search ${meta.name}`}
          onChange={changeQuery}
          shown={visible.length}
          total={rows.length}
          unit="rows"
          value={query}
        >
          <label className="gd-check">
            <input
              checked={hideEmpty}
              onChange={(event) => setHideEmpty(event.target.checked)}
              type="checkbox"
            />
            Hide {empty.size} empty {empty.size === 1 ? 'column' : 'columns'}
          </label>
          <button disabled={visible.length === 0} onClick={exportCsv} type="button">
            Download CSV
          </button>
        </TableSearch>
      </div>
      <div className="table-wrap gd-table-wrap">
        <table className="gd-table">
          <thead>
            <tr>
              <SortableTh
                className="label"
                numeric
                onSort={changeSort}
                sort={sort}
                sortKey={ID_KEY}
              >
                id
              </SortableTh>
              {shownColumns.map((column) => (
                <SortableTh key={column} onSort={changeSort} sort={sort} sortKey={column}>
                  {column}
                  {localised.has(column) && (
                    <span className="gd-col-mark" title="Holds localisation keys; drawn as text">
                      T
                    </span>
                  )}
                  {targets.get(column) && (
                    <span className="gd-col-mark" title={`Links into ${targets.get(column)}`}>
                      →
                    </span>
                  )}
                </SortableTh>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((flatRow) => {
              const id = String(flatRow[ID_KEY]);
              const row = byId.get(id);
              return (
                <tr className={id === selected ? 'gd-selected' : undefined} key={id}>
                  <td className="label num">
                    <button
                      aria-pressed={id === selected}
                      className="gd-row-pick"
                      onClick={() => onPickRow(id)}
                      title="Open this row"
                      type="button"
                    >
                      {id}
                    </button>
                  </td>
                  {shownColumns.map((column) => (
                    <Cell
                      column={column}
                      key={column}
                      localised={localised.has(column)}
                      mode={mode}
                      row={row}
                      target={targets.get(column) ?? null}
                      text={text}
                    />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {visible.length === 0 && <p className="empty">No row matches.</p>}
      <Pager onGo={setPage} page={page} pageCount={pageCount} />
    </div>
  );
}

function Cell({
  row,
  column,
  localised,
  target,
  mode,
  text,
}: {
  row: GameRow | undefined;
  column: string;
  localised: boolean;
  target: string | null;
  mode: TextMode;
  text: Record<string, string>;
}) {
  const value = row?.values[column];
  if (value === null || value === undefined || value === '') {
    return <td className="gd-null" />;
  }
  if (typeof value === 'object') {
    const json = JSON.stringify(value);
    return (
      <td>
        <code className="gd-json" title={json.length > CELL_MAX ? json : undefined}>
          {json.length > CELL_MAX ? `${json.slice(0, CELL_MAX)}…` : json}
        </code>
      </td>
    );
  }
  const raw = String(value);
  if (target !== null && (typeof value === 'number' || /^\d+$/.test(raw))) {
    return (
      <td className="num">
        <a href={viewerHash({ table: target, row: raw, mode })} title={`${target} ${raw}`}>
          {raw}
        </a>
      </td>
    );
  }
  const shown = cellText(value, localised, mode, text);
  const clipped = shown.length > CELL_MAX ? `${shown.slice(0, CELL_MAX)}…` : shown;
  const title = shown !== raw ? `${raw}` : shown.length > CELL_MAX ? shown : undefined;
  return (
    <td className={typeof value === 'number' ? 'num' : localised ? 'gd-text' : undefined}>
      <span title={title}>{clipped}</span>
    </td>
  );
}
