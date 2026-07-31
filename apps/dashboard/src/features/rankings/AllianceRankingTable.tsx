import { useMemo } from 'react';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { SortableTh } from '../../components/SortableTh';
import { TableSearch } from '../../components/TableSearch';
import { TERMS } from '../../lib/terms';
import { useTableView } from '../../lib/useTableView';

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

// Both, so "CBFW" finds the alliance whether the user knows it by tag or name.
const SEARCH_FIELDS = ['name', 'code'] as const;

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
  const latest = useMemo(() => latestPerAlliance(rows), [rows]);
  const { query, setQuery, sort, onSort, view, shown, total } = useTableView(latest, SEARCH_FIELDS);

  if (latest.length === 0) {
    return <p className="empty">No alliance ranking data yet.</p>;
  }
  return (
    <>
      <TableSearch
        label="Search alliances"
        onChange={setQuery}
        shown={shown}
        total={total}
        value={query}
      />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <SortableTh className="label" onSort={onSort} sort={sort} sortKey="name">
                {TERMS.alliance}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="server_id">
                {TERMS.server}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="power">
                {TERMS.power}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="member_count">
                {TERMS.members_count}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="captured_at">
                {TERMS.observed}
              </SortableTh>
            </tr>
          </thead>
          <tbody>
            {view.map((row) => (
              <tr key={row.external_id}>
                <td className="label">
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
      {view.length === 0 && <p className="empty">No alliance matches “{query}”.</p>}
    </>
  );
}
