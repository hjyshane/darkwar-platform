import { FreshnessBadge } from '../../components/FreshnessBadge';

export interface RosterRow {
  player_id: string;
  game_uid: number;
  current_name: string | null;
  hq_level: number | null;
  power: number | null;
  kills: number | null;
  last_seen_at: string | null;
}

const numberFormat = new Intl.NumberFormat('ko-KR');

function formatNumber(value: number | null): string {
  // FR-UI-008: unknown is unknown, never zero.
  return value === null ? '—' : numberFormat.format(value);
}

export function RosterTable({ rows, now }: { rows: RosterRow[]; now?: Date }) {
  if (rows.length === 0) {
    return <p className="empty">로스터 데이터가 아직 없습니다.</p>;
  }
  return (
    <table>
      <thead>
        <tr>
          <th scope="col">이름</th>
          <th scope="col">HQ</th>
          <th scope="col">전투력</th>
          <th scope="col">킬</th>
          <th scope="col">마지막 관측</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.player_id}>
            <td>{row.current_name ?? `UID ${row.game_uid}`}</td>
            <td>{row.hq_level ?? '—'}</td>
            <td>{formatNumber(row.power)}</td>
            <td>{formatNumber(row.kills)}</td>
            <td>
              <FreshnessBadge capturedAt={row.last_seen_at} now={now} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
