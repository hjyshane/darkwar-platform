import { classifyPass, formatPass } from '../../lib/freshness';
import { TERMS } from '../../lib/terms';

export interface MonthCardRow {
  player_id: string;
  expires_at: string;
  observed_at: string;
  players: {
    current_name: string | null;
    game_uid: number;
  } | null;
}

export function MonthCardTable({ rows, now }: { rows: MonthCardRow[]; now?: Date }) {
  const current = now ?? new Date();
  if (rows.length === 0) {
    // True for an admin before any pass was observed AND for everyone
    // else (RLS returns nothing). Deliberately the same message: this
    // page does not confirm to a non-admin that there is data to miss.
    return <p className="empty">Nothing to show.</p>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">{TERMS.name}</th>
            <th className="num" scope="col">
              {TERMS.status}
            </th>
            <th className="num" scope="col">
              {TERMS.expires}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.player_id}>
              <td>{row.players?.current_name ?? `UID ${row.players?.game_uid ?? '?'}`}</td>
              <td className="num">
                <span className={`badge badge-pass-${classifyPass(row.expires_at, current)}`}>
                  {formatPass(row.expires_at, current)}
                </span>
              </td>
              <td className="num">{row.expires_at.slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
