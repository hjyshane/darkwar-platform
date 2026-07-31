import { SortableTh } from '../../components/SortableTh';
import { TableSearch } from '../../components/TableSearch';
import { TERMS } from '../../lib/terms';
import { useTableView } from '../../lib/useTableView';
import type { Board, BoardRow } from './boards';

const numberFormat = new Intl.NumberFormat('ko-KR');

// Server included: "580" is a reasonable thing to type when the board spans
// eight of them.
const SEARCH_FIELDS = ['name', 'game_uid', 'server_id'] as const;

function formatNumber(value: number | null): string {
  // FR-UI-008: unknown is unknown, never zero.
  return value === null ? '—' : numberFormat.format(value);
}

export function CrossRankingTable({ rows, board }: { rows: BoardRow[]; board: Board }) {
  const { query, setQuery, sort, onSort, view, shown, total } = useTableView(rows, SEARCH_FIELDS);

  if (rows.length === 0) {
    return <p className="empty">No ranking data yet.</p>;
  }
  return (
    <>
      <TableSearch
        label="Search players"
        onChange={setQuery}
        shown={shown}
        total={total}
        value={query}
      />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="rank">
                {TERMS.rank}
              </SortableTh>
              <SortableTh className="label" onSort={onSort} sort={sort} sortKey="name">
                {TERMS.name}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="server_id">
                {TERMS.server}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="value">
                {board.valueLabel}
              </SortableTh>
              {board.unitLabel && (
                <SortableTh numeric onSort={onSort} sort={sort} sortKey="unit_id">
                  {board.unitLabel}
                </SortableTh>
              )}
            </tr>
          </thead>
          <tbody>
            {view.map((row) => (
              <tr key={row.id}>
                <td className="num">{row.rank ?? '—'}</td>
                <td className="label">{row.name ?? `UID ${row.game_uid}`}</td>
                <td className="num">{row.server_id}</td>
                <td className="num">{formatNumber(row.value)}</td>
                {board.unitLabel && <td className="num">{row.unit_id ?? '—'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {view.length === 0 && <p className="empty">No player matches “{query}”.</p>}
    </>
  );
}
