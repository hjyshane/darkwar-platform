import { useMemo, useState } from 'react';
import { FavouriteButton } from '../../components/FavouriteButton';
import { FavouritesFilter } from '../../components/FavouritesFilter';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { SortableTh } from '../../components/SortableTh';
import { TableSearch } from '../../components/TableSearch';
import { formatLastOnline } from '../../lib/freshness';
import { fieldsOf } from '../../lib/memberFormulas';
import { playerHash } from '../../lib/route';
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
  weekly_donation_score: number | null;
  duel_daily_score: number | null;
  duel_weekly_score: number | null;
  duel_round_score: number | null;
  online_state: string | null;
  last_online_at: string | null;
  last_seen_at: string | null;
}

const numberFormat = new Intl.NumberFormat('ko-KR');
// Same shortening the overview tiles offer — 4.4M rather than 4,400,000 —
// because a described column is usually a score, and a score with seven
// digits is read as a shape rather than a number.
const compactFormat = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

// Module level so the reference is stable across renders.
const SEARCH_FIELDS = ['current_name', 'game_uid'] as const;

function formatNumber(value: number | null): string {
  // FR-UI-008: unknown is unknown, never zero.
  return value === null ? '—' : numberFormat.format(value);
}

/** A member formula's value for one row, under the formula's own id.
 *
 * Computed into the row rather than rendered on the fly, so the table's
 * existing sort works on it — a column you cannot sort by is half a column,
 * and the sort machinery reads keys off the row object. */
function withFormulas(rows: RosterRow[], formulas: readonly ComputedColumn[]): RosterRow[] {
  if (formulas.length === 0) {
    return rows;
  }
  return rows.map((row) => {
    const values = fieldsOf(row);
    const extra: Record<string, number | null> = {};
    for (const formula of formulas) {
      extra[formula.id] = formula.evaluate(values);
    }
    // The extra keys are named at runtime by whoever wrote the formula, so
    // they cannot be in RosterRow's type. They ride along untyped and are
    // read back through an index signature at the one place that renders
    // them — which is honest about what they are.
    return { ...row, ...extra } as RosterRow;
  });
}

export interface ComputedColumn {
  id: string;
  label: string;
  compact: boolean;
  evaluate: (values: Record<string, number | null>) => number | null;
}

export function RosterTable({
  rows,
  now,
  columns = [],
}: {
  rows: RosterRow[];
  now?: Date;
  /** Columns an admin described. Empty is the normal case. */
  columns?: readonly ComputedColumn[];
}) {
  const { signedIn, isFavourite, toggle, count } = useFavourites();
  const [starredOnly, setStarredOnly] = useState(false);
  // Before the search, so the count reads "3 / 8 of my starred members"
  // rather than "3 / 50 of everyone".
  const computed = useMemo(() => withFormulas(rows, columns), [rows, columns]);
  const visible = useMemo(
    () => (starredOnly ? computed.filter((row) => isFavourite('player', row.player_id)) : computed),
    [computed, starredOnly, isFavourite],
  );
  // RosterPanel asks PostgREST for power desc; say so rather than letting
  // the header claim the rows arrived in no order at all.
  const { query, setQuery, sort, onSort, view, shown, total } = useTableView(
    visible,
    SEARCH_FIELDS,
    { key: 'power', direction: 'desc' },
  );

  if (rows.length === 0) {
    return <p className="empty">No member data yet.</p>;
  }
  return (
    <>
      <TableSearch
        label={`Search ${TERMS.members.toLowerCase()}`}
        unit={TERMS.members.toLowerCase()}
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
              {/* group-start marks where the donation family begins, and
                  again where the duel family does. Five adjacent figures
                  otherwise invite a comparison that means nothing — a daily
                  donation against a total over four duel rounds. */}
              <SortableTh
                className="group-start"
                numeric
                onSort={onSort}
                sort={sort}
                sortKey="daily_donation_score"
              >
                {TERMS.dailyDonation}
              </SortableTh>
              {/* Two donation commands, two columns. The weekly figure is
                  reported by the game, not summed from the daily one. */}
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="weekly_donation_score">
                {TERMS.weeklyDonation}
              </SortableTh>
              {/* Three boards, three columns. They shared one until 0028,
                  which meant the figure shown depended on which of the three
                  happened to be inserted last. */}
              <SortableTh
                className="group-start"
                numeric
                onSort={onSort}
                sort={sort}
                sortKey="duel_daily_score"
              >
                {TERMS.duelDaily}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="duel_weekly_score">
                {TERMS.duelWeekly}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="duel_round_score">
                {TERMS.duelRound}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="last_online_at">
                {TERMS.lastOnline}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="last_seen_at">
                {TERMS.lastSeen}
              </SortableTh>
              {/* Described columns go last: they are derived from the ones
                  to their left, and putting them there keeps the figures
                  the game actually reported in one block. */}
              {columns.map((column) => (
                <SortableTh key={column.id} numeric onSort={onSort} sort={sort} sortKey={column.id}>
                  {column.label}
                </SortableTh>
              ))}
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
                  <a href={playerHash(row.player_id)}>
                    {row.current_name ?? `UID ${row.game_uid}`}
                  </a>
                </td>
                <td className="num">{row.hq_level ?? '—'}</td>
                <td className="num">{formatNumber(row.power)}</td>
                <td className="num">{formatNumber(row.kills)}</td>
                <td className="num group-start">{formatNumber(row.daily_donation_score)}</td>
                <td className="num">{formatNumber(row.weekly_donation_score)}</td>
                <td className="num group-start">{formatNumber(row.duel_daily_score)}</td>
                <td className="num">{formatNumber(row.duel_weekly_score)}</td>
                <td className="num">{formatNumber(row.duel_round_score)}</td>
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
                {columns.map((column) => {
                  const value = (row as unknown as Record<string, unknown>)[column.id];
                  return (
                    <td className="num" key={column.id}>
                      {/* Unknown stays unknown: a formula that read a member's
                          missing duel score has no answer, and a 0 there
                          would rank them below somebody who scored 1. */}
                      {typeof value !== 'number'
                        ? '—'
                        : column.compact
                          ? compactFormat.format(value)
                          : numberFormat.format(Math.round(value))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {view.length === 0 && <p className="empty">No member matches “{query}”.</p>}
    </>
  );
}
