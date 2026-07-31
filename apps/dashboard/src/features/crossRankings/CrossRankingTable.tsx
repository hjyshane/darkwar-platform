import { TERMS } from '../../lib/terms';
import type { Board, BoardRow } from './boards';

const numberFormat = new Intl.NumberFormat('ko-KR');

function formatNumber(value: number | null): string {
  // FR-UI-008: unknown is unknown, never zero.
  return value === null ? '—' : numberFormat.format(value);
}

export function CrossRankingTable({ rows, board }: { rows: BoardRow[]; board: Board }) {
  if (rows.length === 0) {
    return <p className="empty">No ranking data yet.</p>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">{TERMS.rank}</th>
            <th scope="col">{TERMS.name}</th>
            <th scope="col">{TERMS.server}</th>
            <th scope="col">{board.valueLabel}</th>
            {board.unitLabel && <th scope="col">{board.unitLabel}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.rank ?? '—'}</td>
              <td>{row.name ?? `UID ${row.game_uid}`}</td>
              <td>{row.server_id}</td>
              <td>{formatNumber(row.value)}</td>
              {board.unitLabel && <td>{row.unit_id ?? '—'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
