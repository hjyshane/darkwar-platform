import { useMemo, useState } from 'react';
import { FavouriteButton } from '../../components/FavouriteButton';
import { FavouritesFilter } from '../../components/FavouritesFilter';
import { SortableTh } from '../../components/SortableTh';
import { TableSearch } from '../../components/TableSearch';
import { playerHash } from '../../lib/route';
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
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="power">
                {TERMS.power}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="kills">
                {TERMS.kills}
              </SortableTh>
            </tr>
          </thead>
          <tbody>
            {view.map((row) => (
              <tr key={row.snapshot_id}>
                <td className="num">{row.rank ?? '—'}</td>
                <td className="label">
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
                </td>
                <td className="num">{formatNumber(row.power)}</td>
                <td className="num">{formatNumber(row.kills)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {view.length === 0 && <p className="empty">No player matches “{query}”.</p>}
    </>
  );
}
