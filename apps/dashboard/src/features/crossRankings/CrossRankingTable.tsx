export type RankingMetric = 'power' | 'kills';

export interface CrossRankingRow {
  snapshot_id: string;
  rank: number | null;
  name: string | null;
  game_uid: number;
  server_id: number;
  power: number | null;
  kills: number | null;
  captured_at: string;
}

const numberFormat = new Intl.NumberFormat('ko-KR');

function formatNumber(value: number | null): string {
  // FR-UI-008: unknown is unknown, never zero.
  return value === null ? '—' : numberFormat.format(value);
}

export function CrossRankingTable({
  rows,
  metric,
}: {
  rows: CrossRankingRow[];
  metric: RankingMetric;
}) {
  if (rows.length === 0) {
    return <p className="empty">랭킹 데이터가 아직 없습니다.</p>;
  }
  return (
    <table>
      <thead>
        <tr>
          <th scope="col">순위</th>
          <th scope="col">이름</th>
          <th scope="col">서버</th>
          <th scope="col">{metric === 'power' ? '전투력' : '킬'}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.snapshot_id}>
            <td>{row.rank ?? '—'}</td>
            <td>{row.name ?? `UID ${row.game_uid}`}</td>
            <td>{row.server_id}</td>
            <td>{formatNumber(metric === 'power' ? row.power : row.kills)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
