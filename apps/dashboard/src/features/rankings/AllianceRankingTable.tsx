import { useMemo, useState } from 'react';
import { FavouriteButton } from '../../components/FavouriteButton';
import { FavouritesFilter } from '../../components/FavouritesFilter';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { SortableTh } from '../../components/SortableTh';
import { TableSearch } from '../../components/TableSearch';
import { allianceHash, serverHash } from '../../lib/route';
import { TERMS } from '../../lib/terms';
import { useFavourites } from '../../lib/useFavourites';
import { useTableView } from '../../lib/useTableView';

export interface AllianceRankingRow {
  snapshot_id: string;
  /** The resolved alliance, stable across name and tag changes — which is
   *  what a favourite has to hang on. */
  alliance_id: string;
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

export function AllianceRankingTable({
  rows,
  now,
}: {
  rows: AllianceRankingRow[];
  now?: Date;
}) {
  const { signedIn, isFavourite, toggle, count } = useFavourites();
  const [starredOnly, setStarredOnly] = useState(false);
  const visible = useMemo(
    () => (starredOnly ? rows.filter((row) => isFavourite('alliance', row.alliance_id)) : rows),
    [rows, starredOnly, isFavourite],
  );
  const { query, setQuery, sort, onSort, view, shown, total } = useTableView(
    visible,
    SEARCH_FIELDS,
    // Matches what the query asks for AND what the rows arrive in. Those
    // were two different things until 0035: the panel ordered by captured_at
    // while this file re-sorted by power on the way out, so the header
    // described an order nothing was in.
    { key: 'power', direction: 'desc' },
  );

  if (rows.length === 0) {
    return <p className="empty">No alliance ranking data yet.</p>;
  }
  return (
    <>
      <TableSearch
        label="Search alliances"
        unit="alliances"
        onChange={setQuery}
        shown={shown}
        total={total}
        value={query}
      >
        {signedIn && (
          <FavouritesFilter
            active={starredOnly}
            count={count('alliance')}
            onChange={setStarredOnly}
          />
        )}
      </TableSearch>
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
                {TERMS.lastSeen}
              </SortableTh>
            </tr>
          </thead>
          <tbody>
            {view.map((row) => (
              <tr key={row.external_id}>
                <td className="label">
                  {signedIn && (
                    <FavouriteButton
                      id={row.alliance_id}
                      isFavourite={isFavourite('alliance', row.alliance_id)}
                      kind="alliance"
                      label={row.name ?? row.code ?? row.external_id.slice(0, 8)}
                      onToggle={toggle}
                    />
                  )}
                  <a href={allianceHash(row.alliance_id)}>
                    {row.code ? `[${row.code}] ` : ''}
                    {row.name ?? row.external_id.slice(0, 8)}
                  </a>
                </td>
                <td className="num">
                  <a href={serverHash(row.server_id)}>{row.server_id}</a>
                </td>
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
