import { FreshnessBadge } from '../../components/FreshnessBadge';
import { SortableTh } from '../../components/SortableTh';
import { TableSearch } from '../../components/TableSearch';
import { TERMS } from '../../lib/terms';
import { useTableView } from '../../lib/useTableView';

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

// Module level so the reference is stable across renders.
const SEARCH_FIELDS = ['current_name', 'game_uid'] as const;

function formatNumber(value: number | null): string {
  // FR-UI-008: unknown is unknown, never zero.
  return value === null ? '—' : numberFormat.format(value);
}

export function RosterTable({ rows, now }: { rows: RosterRow[]; now?: Date }) {
  const { query, setQuery, sort, onSort, view, shown, total } = useTableView(rows, SEARCH_FIELDS);

  if (rows.length === 0) {
    return <p className="empty">No member data yet.</p>;
  }
  return (
    <>
      <TableSearch
        label={`Search ${TERMS.members.toLowerCase()}`}
        onChange={setQuery}
        shown={shown}
        total={total}
        value={query}
      />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <SortableTh className="label" onSort={onSort} sort={sort} sortKey="current_name">
                {TERMS.name}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="hq_level">
                {TERMS.hq}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="power">
                {TERMS.power}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="kills">
                {TERMS.kills}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="daily_donation_score">
                {TERMS.dailyDonation}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="alliance_battle_score">
                {TERMS.allianceBattle}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="last_seen_at">
                {TERMS.lastSeen}
              </SortableTh>
            </tr>
          </thead>
          <tbody>
            {view.map((row) => (
              <tr key={row.player_id}>
                <td className="label">{row.current_name ?? `UID ${row.game_uid}`}</td>
                <td className="num">{row.hq_level ?? '—'}</td>
                <td className="num">{formatNumber(row.power)}</td>
                <td className="num">{formatNumber(row.kills)}</td>
                <td className="num">{formatNumber(row.daily_donation_score)}</td>
                <td className="num">{formatNumber(row.alliance_battle_score)}</td>
                <td className="num">
                  <FreshnessBadge capturedAt={row.last_seen_at} now={now} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {view.length === 0 && <p className="empty">No member matches “{query}”.</p>}
    </>
  );
}
