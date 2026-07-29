import { FreshnessBadge } from '../../components/FreshnessBadge';

export interface AllianceRankingRow {
  snapshot_id: string;
  external_id: string;
  server_id: number;
  rank: number | null;
  name: string | null;
  code: string | null;
  power: number | null;
  member_count: number | null;
  captured_at: string;
}

const numberFormat = new Intl.NumberFormat('ko-KR');

/** One row per alliance, keeping the newest observation of each. Rows arrive
 * newest-first, so the first sighting of an alliance is the current one. */
export function latestPerAlliance(rows: AllianceRankingRow[]): AllianceRankingRow[] {
  const seen = new Set<string>();
  const latest: AllianceRankingRow[] = [];
  for (const row of rows) {
    if (seen.has(row.external_id)) {
      continue;
    }
    seen.add(row.external_id);
    latest.push(row);
  }
  return latest.sort((a, b) => (b.power ?? 0) - (a.power ?? 0));
}

export function AllianceRankingTable({
  rows,
  now,
}: {
  rows: AllianceRankingRow[];
  now?: Date;
}) {
  const latest = latestPerAlliance(rows);
  if (latest.length === 0) {
    return <p className="empty">연맹 순위 데이터가 아직 없습니다.</p>;
  }
  return (
    <table>
      <thead>
        <tr>
          <th scope="col">연맹</th>
          <th scope="col">서버</th>
          <th scope="col">전투력</th>
          <th scope="col">인원</th>
          <th scope="col">관측</th>
        </tr>
      </thead>
      <tbody>
        {latest.map((row) => (
          <tr key={row.external_id}>
            <td>
              {row.code ? `[${row.code}] ` : ''}
              {row.name ?? row.external_id.slice(0, 8)}
            </td>
            <td>{row.server_id}</td>
            <td>{row.power === null ? '—' : numberFormat.format(row.power)}</td>
            <td>{row.member_count ?? '—'}</td>
            <td>
              <FreshnessBadge capturedAt={row.captured_at} now={now} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
