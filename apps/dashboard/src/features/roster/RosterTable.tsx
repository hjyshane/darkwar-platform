import { useMemo, useState } from 'react';
import { FavouriteButton } from '../../components/FavouriteButton';
import { FavouritesFilter } from '../../components/FavouritesFilter';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { SortableTh } from '../../components/SortableTh';
import { TableSearch } from '../../components/TableSearch';
import { formatLastOnline } from '../../lib/freshness';
import { TERMS } from '../../lib/terms';
import { useFavourites } from '../../lib/useFavourites';
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
  online_state: string | null;
  last_online_at: string | null;
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
  const { signedIn, isFavourite, toggle, count } = useFavourites();
  const [starredOnly, setStarredOnly] = useState(false);
  // Before the search, so the count reads "3 / 8 of my starred members"
  // rather than "3 / 50 of everyone".
  const visible = useMemo(
    () => (starredOnly ? rows.filter((row) => isFavourite('player', row.player_id)) : rows),
    [rows, starredOnly, isFavourite],
  );
  const { query, setQuery, sort, onSort, view, shown, total } = useTableView(
    visible,
    SEARCH_FIELDS,
  );

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
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="last_online_at">
                {TERMS.lastOnline}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="last_seen_at">
                {TERMS.lastSeen}
              </SortableTh>
            </tr>
          </thead>
          <tbody>
            {view.map((row) => (
              <tr key={row.player_id}>
                {/* Inside the name cell, not a column of its own: on a
                    phone that cell is the one pinned to the left, so the
                    star stays reachable instead of scrolling away with the
                    figures. */}
                <td className="label">
                  {signedIn && (
                    <FavouriteButton
                      id={row.player_id}
                      isFavourite={isFavourite('player', row.player_id)}
                      kind="player"
                      label={row.current_name ?? `UID ${row.game_uid}`}
                      onToggle={toggle}
                    />
                  )}
                  {row.current_name ?? `UID ${row.game_uid}`}
                </td>
                <td className="num">{row.hq_level ?? '—'}</td>
                <td className="num">{formatNumber(row.power)}</td>
                <td className="num">{formatNumber(row.kills)}</td>
                <td className="num">{formatNumber(row.daily_donation_score)}</td>
                <td className="num">{formatNumber(row.alliance_battle_score)}</td>
                {/* Two different facts, deliberately side by side: when
                    the player was last in the game, and when we last looked.
                    They were conflated until 0024 — Last Seen was captured_at
                    wearing a name that reads like presence. */}
                <td className="num">
                  {formatLastOnline(row.online_state, row.last_online_at, now ?? new Date())}
                </td>
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
