import { useMemo, useState } from 'react';
import { ArrangedTable, type Column } from '../../components/ArrangedTable';
import { FavouriteButton } from '../../components/FavouriteButton';
import { FavouritesFilter } from '../../components/FavouritesFilter';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { TableSearch } from '../../components/TableSearch';
import { allianceHash, serverHash } from '../../lib/route';
import type { ColumnSpec } from '../../lib/tableLayout';
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

/** This table's key in the shared column arrangement. */
export const TABLE_ID = 'alliance-rankings';

/** Identity only, for the settings screen. */
export function allianceRankingColumnSpecs(): ColumnSpec[] {
  return [
    { id: 'name', label: TERMS.alliance, fixed: true },
    { id: 'server', label: TERMS.server },
    { id: 'power', label: TERMS.power },
    { id: 'members', label: TERMS.members_count },
    { id: 'seen', label: TERMS.lastSeen },
  ];
}

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

  // Above the early return: hooks cannot be skipped.
  const columns = useMemo<Column<AllianceRankingRow>[]>(
    () => [
      {
        id: 'name',
        label: TERMS.alliance,
        sortKey: 'name',
        className: 'label',
        // Pinned left and the only thing telling one row from another.
        fixed: true,
        cell: (row) => (
          <>
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
          </>
        ),
      },
      {
        id: 'server',
        label: TERMS.server,
        sortKey: 'server_id',
        numeric: true,
        cell: (row) => <a href={serverHash(row.server_id)}>{row.server_id}</a>,
      },
      {
        id: 'power',
        label: TERMS.power,
        sortKey: 'power',
        numeric: true,
        cell: (row) => (row.power === null ? '—' : numberFormat.format(row.power)),
      },
      {
        id: 'members',
        label: TERMS.members_count,
        sortKey: 'member_count',
        numeric: true,
        cell: (row) => row.member_count ?? '—',
      },
      {
        id: 'seen',
        label: TERMS.lastSeen,
        sortKey: 'captured_at',
        numeric: true,
        cell: (row) => <FreshnessBadge capturedAt={row.captured_at} now={now} />,
      },
    ],
    [signedIn, isFavourite, toggle, now],
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
      <ArrangedTable
        columns={columns}
        onSort={onSort}
        rowKey={(row) => row.external_id}
        rows={view}
        sort={sort}
        tableId={TABLE_ID}
      />
      {view.length === 0 && <p className="empty">No alliance matches “{query}”.</p>}
    </>
  );
}
