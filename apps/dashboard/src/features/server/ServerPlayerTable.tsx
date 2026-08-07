import { useMemo, useState } from 'react';
import { ArrangedTable, type Column } from '../../components/ArrangedTable';
import { FavouriteButton } from '../../components/FavouriteButton';
import { FavouritesFilter } from '../../components/FavouritesFilter';
import { TableSearch } from '../../components/TableSearch';
import { playerHash } from '../../lib/route';
import type { ColumnSpec } from '../../lib/tableLayout';
import { TERMS } from '../../lib/terms';
import { useFavourites } from '../../lib/useFavourites';
import { useTableView } from '../../lib/useTableView';

export interface ServerPlayerRow {
  snapshot_id: string;
  /** Present because favourites need something stable to hang on; a
   *  snapshot id changes with every capture. */
  player_id: string;
  rank: number | null;
  name: string | null;
  game_uid: number;
  server_id: number;
  power: number | null;
  kills: number | null;
  captured_at: string;
}

const numberFormat = new Intl.NumberFormat('ko-KR');
const SEARCH_FIELDS = ['name', 'game_uid'] as const;

/** This table's key in the shared column arrangement. */
export const TABLE_ID = 'server-players';

/** What the settings screen may see of this table: identity only.
 *
 * Written out rather than derived from the list inside the component, because
 * that list is built by a hook out of the signed-in reader's favourites — the
 * settings screen has no row to build it from and no business calling `cell`. */
export function serverPlayerColumnSpecs(): ColumnSpec[] {
  return [
    { id: 'rank', label: TERMS.rank },
    { id: 'name', label: TERMS.name, fixed: true },
    { id: 'power', label: TERMS.power },
    { id: 'kills', label: TERMS.kills },
  ];
}

function formatNumber(value: number | null): string {
  return value === null ? '—' : numberFormat.format(value);
}

export function ServerPlayerTable({
  rows,
  serverId,
}: {
  rows: ServerPlayerRow[];
  serverId: number;
}) {
  const { signedIn, isFavourite, toggle, count } = useFavourites();
  const [starredOnly, setStarredOnly] = useState(false);
  const visible = useMemo(
    () => (starredOnly ? rows.filter((row) => isFavourite('player', row.player_id)) : rows),
    [rows, starredOnly, isFavourite],
  );
  const { query, setQuery, sort, onSort, view, shown, total } = useTableView(
    visible,
    SEARCH_FIELDS,
    // ServerPage asks for rank asc.
    { key: 'rank', direction: 'asc' },
  );

  // Above the early return: hooks cannot be skipped.
  const columns = useMemo<Column<ServerPlayerRow>[]>(
    () => [
      {
        id: 'rank',
        label: TERMS.rank,
        sortKey: 'rank',
        numeric: true,
        cell: (row) => row.rank ?? '—',
      },
      {
        id: 'name',
        label: TERMS.name,
        sortKey: 'name',
        className: 'label',
        // Pinned left and the only thing telling one row of figures from
        // another, so it cannot be hidden.
        fixed: true,
        cell: (row) => (
          <>
            {signedIn && (
              <FavouriteButton
                id={row.player_id}
                isFavourite={isFavourite('player', row.player_id)}
                kind="player"
                label={row.name ?? `UID ${row.game_uid}`}
                onToggle={toggle}
              />
            )}
            <a href={playerHash(row.player_id)}>{row.name ?? `UID ${row.game_uid}`}</a>
          </>
        ),
      },
      {
        id: 'power',
        label: TERMS.power,
        sortKey: 'power',
        numeric: true,
        cell: (row) => formatNumber(row.power),
      },
      {
        id: 'kills',
        label: TERMS.kills,
        sortKey: 'kills',
        numeric: true,
        cell: (row) => formatNumber(row.kills),
      },
    ],
    [signedIn, isFavourite, toggle],
  );

  if (rows.length === 0) {
    return <p className="empty">No player seen on server {serverId} yet.</p>;
  }
  return (
    <>
      <TableSearch
        label="Search players"
        unit="players"
        onChange={setQuery}
        shown={shown}
        total={total}
        value={query}
      >
        {signedIn && (
          <FavouritesFilter
            active={starredOnly}
            count={count('player')}
            onChange={setStarredOnly}
          />
        )}
      </TableSearch>
      <ArrangedTable
        columns={columns}
        onSort={onSort}
        rowKey={(row) => row.snapshot_id}
        rows={view}
        sort={sort}
        tableId={TABLE_ID}
      />
      {view.length === 0 && <p className="empty">No player matches “{query}”.</p>}
    </>
  );
}
