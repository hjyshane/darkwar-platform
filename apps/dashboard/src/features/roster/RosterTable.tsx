import { FreshnessBadge } from '../../components/FreshnessBadge';
import { TERMS } from '../../lib/terms';

export interface RosterRow {
  player_id: string;
  game_uid: number;
  current_name: string | null;
  hq_level: number | null;
  power: number | null;
  kills: number | null;
  daily_donation_score: number | null;
  alliance_battle_score: number | null;
  last_seen_at: string | null;
}

const numberFormat = new Intl.NumberFormat('ko-KR');

function formatNumber(value: number | null): string {
  // FR-UI-008: unknown is unknown, never zero.
  return value === null ? '—' : numberFormat.format(value);
}

export function RosterTable({ rows, now }: { rows: RosterRow[]; now?: Date }) {
  if (rows.length === 0) {
    return <p className="empty">No member data yet.</p>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">{TERMS.name}</th>
            <th className="num" scope="col">
              {TERMS.hq}
            </th>
            <th className="num" scope="col">
              {TERMS.power}
            </th>
            <th className="num" scope="col">
              {TERMS.kills}
            </th>
            <th className="num" scope="col">
              {TERMS.dailyDonation}
            </th>
            <th className="num" scope="col">
              {TERMS.allianceBattle}
            </th>
            <th className="num" scope="col">
              {TERMS.lastSeen}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.player_id}>
              <td>{row.current_name ?? `UID ${row.game_uid}`}</td>
              <td className="num">{row.hq_level ?? '—'}</td>
              <td className="num">{formatNumber(row.power)}</td>
              <td className="num">{formatNumber(row.kills)}</td>
              <td className="num">{formatNumber(row.daily_donation_score)}</td>
              <td className="num">{formatNumber(row.alliance_battle_score)}</td>
              <td>
                <FreshnessBadge capturedAt={row.last_seen_at} now={now} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
