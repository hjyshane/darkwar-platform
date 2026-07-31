import { FreshnessBadge } from '../../components/FreshnessBadge';
import { SortableTh } from '../../components/SortableTh';
import { TableSearch } from '../../components/TableSearch';
import { TERMS } from '../../lib/terms';
import { useTableView } from '../../lib/useTableView';

export interface ArenaHeader {
  snapshot_id: string;
  week_start: string;
  captured_at: string;
  entry_count: number | null;
}

export interface ArenaEntryRow {
  snapshot_id: string;
  rank: number;
  name: string | null;
  game_uid: number;
  server_id: number;
  /** As the arena response reported it — text, because the payload carries
   * no alliance id to resolve against public.alliances. */
  alliance_name: string | null;
  alliance_code: string | null;
  score: number | null;
  defense_power: number | null;
}

const numberFormat = new Intl.NumberFormat('ko-KR');

// A cross-server board is scanned by who is in it: "who from LovE made the
// top 100", or "how many of these are from 582".
const SEARCH_FIELDS = ['name', 'game_uid', 'alliance_name', 'alliance_code', 'server_id'] as const;

export function ArenaTable({
  header,
  entries,
  now,
}: {
  header: ArenaHeader;
  entries: ArenaEntryRow[];
  now?: Date;
}) {
  const { query, setQuery, sort, onSort, view, shown, total } = useTableView(
    entries,
    SEARCH_FIELDS,
  );
  const weekLabel = new Date(header.week_start).toISOString().slice(0, 10);
  return (
    <>
      <p>
        <span>Week {weekLabel}</span> <FreshnessBadge capturedAt={header.captured_at} now={now} />
      </p>
      <TableSearch
        label="Search arena"
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
              <SortableTh onSort={onSort} sort={sort} sortKey="alliance_code">
                {TERMS.alliance}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="server_id">
                {TERMS.server}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="score">
                {TERMS.score}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="defense_power">
                {TERMS.defensePower}
              </SortableTh>
            </tr>
          </thead>
          <tbody>
            {view.map((entry) => (
              <tr key={entry.snapshot_id}>
                <td className="num">{entry.rank}</td>
                <td className="label">{entry.name ?? `UID ${entry.game_uid}`}</td>
                <td>
                  {/* Tag first because that is what people say out loud;
                      the full name is there for the ones nobody knows by
                      tag. Unallied stays an em dash, like every other
                      unknown in these tables. */}
                  {entry.alliance_code ?? entry.alliance_name ?? '—'}
                </td>
                <td className="num">{entry.server_id}</td>
                <td className="num">
                  {entry.score === null ? '—' : numberFormat.format(entry.score)}
                </td>
                <td className="num">
                  {entry.defense_power === null ? '—' : numberFormat.format(entry.defense_power)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {view.length === 0 && <p className="empty">No arena entry matches “{query}”.</p>}
    </>
  );
}
