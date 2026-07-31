import { FreshnessBadge } from '../../components/FreshnessBadge';
import { TERMS } from '../../lib/terms';

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
    return <p className="empty">No alliance ranking data yet.</p>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">{TERMS.alliance}</th>
            <th className="num" scope="col">
              {TERMS.server}
            </th>
            <th className="num" scope="col">
              {TERMS.power}
            </th>
            <th className="num" scope="col">
              {TERMS.members_count}
            </th>
            <th className="num" scope="col">
              {TERMS.observed}
            </th>
          </tr>
        </thead>
        <tbody>
          {latest.map((row) => (
            <tr key={row.external_id}>
              <td>
                {row.code ? `[${row.code}] ` : ''}
                {row.name ?? row.external_id.slice(0, 8)}
              </td>
              <td className="num">{row.server_id}</td>
              <td className="num">{row.power === null ? '—' : numberFormat.format(row.power)}</td>
              <td className="num">{row.member_count ?? '—'}</td>
              <td className="num">
                <FreshnessBadge capturedAt={row.captured_at} now={now} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
