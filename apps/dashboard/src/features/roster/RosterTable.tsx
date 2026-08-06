import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Fragment, useMemo, useState } from 'react';
import { FavouriteButton } from '../../components/FavouriteButton';
import { FavouritesFilter } from '../../components/FavouritesFilter';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { SortableTh } from '../../components/SortableTh';
import { TableSearch } from '../../components/TableSearch';
import { formatLastOnline } from '../../lib/freshness';
import { fieldsOf } from '../../lib/memberFormulas';
import { GAME_RANKS, isAllowed, usePermissions } from '../../lib/permissions';
import { playerHash } from '../../lib/route';
import { supabase } from '../../lib/supabase';
import { TERMS } from '../../lib/terms';
import { useFavourites } from '../../lib/useFavourites';
import { useSession } from '../../lib/useSession';
import { useTableView } from '../../lib/useTableView';

export interface RosterRow {
  /** The rank the GAME reports, from the member list itself (1-5, R5 being the
   * leader). Distinct from both fields below: `assigned_rank` is what an admin
   * typed and is null for most of the roster, and `computed_rank` is what the
   * scoring worked out. This is the one the alliance actually runs on, so it is
   * what the table groups by. */
  member_rank: number | null;
  /** What an admin set, which wins over anything computed. */
  assigned_rank: string | null;
  /** What the newest period worked out — R1-R3 only, because R4 and R5 are
   * limited seats handed out by hand. */
  computed_rank: string | null;
  /** The score that rank came from. A rank on its own is an assertion; this
   * is what makes it arguable. */
  rank_score: number | null;
  /** Power at the most recent 02:05 UTC against the same point a day and a
   * week earlier (0051). Null where there is no earlier snapshot to compare
   * with — which is not the same as 0% and must not render as one. */
  growth_1d: number | null;
  growth_7d: number | null;
  growth_1d_at: string | null;
  growth_7d_at: string | null;
  player_id: string;
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

/** The rank a member holds, in front of their name.
 *
 * In the name cell rather than a column of its own, for the same reason the
 * favourite star is: the name cell is the one pinned to the left, and a
 * column placed before it would slide underneath the pinned name the moment
 * the table scrolls sideways. The CSS above already carries that scar from
 * Arena's rank column.
 *
 * Editable in place for whoever may manage members. A rank is decided by
 * looking at somebody's figures, and those figures are on this row — sending
 * the reader to a settings page to act on what they just read is the kind of
 * separation that stops people bothering.
 *
 * A computed rank shows faded: it is what the last period worked out, not
 * what anybody decided, and the difference is worth seeing at a glance.
 */
function RankBadge({
  row,
  editable,
  onSet,
}: {
  row: RosterRow;
  editable: boolean;
  onSet: (playerId: string, rank: string | null) => void;
}) {
  const shown = row.assigned_rank ?? row.computed_rank;
  if (!editable) {
    return shown === null ? null : (
      <span
        className={`rank-badge ${row.assigned_rank === null ? 'rank-badge-computed' : ''}`}
        title={row.assigned_rank === null ? 'Worked out from the last period' : 'Set by an admin'}
      >
        {shown}
      </span>
    );
  }
  return (
    <select
      aria-label={`Rank for ${row.current_name ?? 'an unnamed member'}`}
      className={`rank-badge ${row.assigned_rank === null ? 'rank-badge-computed' : ''}`}
      onChange={(event) => onSet(row.player_id, event.target.value || null)}
      title={
        row.assigned_rank === null
          ? 'Worked out from the last period — choosing here overrides it'
          : 'Set by an admin'
      }
      value={row.assigned_rank ?? ''}
    >
      {/* Blank means "use the computed one", not "no rank". Clearing an
          override has to be possible from the same control that sets it. */}
      <option value="">{row.computed_rank ?? '—'}</option>
      {GAME_RANKS.map((rank) => (
        <option key={rank} value={rank}>
          {rank}
        </option>
      ))}
    </select>
  );
}

/** A signed percentage, coloured by direction.
 *
 * Green up, red down, and a plain dash for "no earlier snapshot" — the
 * colour is never the only carrier, since the sign is right there in the
 * text (NFR-011). Zero gets neither colour: it moved by nothing, which is
 * news of a different kind from moving down.
 */
function GrowthCell({ value, since }: { value: number | null; since: string | null }) {
  if (value === null) {
    return (
      <td className="num" title="No earlier snapshot to compare against">
        —
      </td>
    );
  }
  const rounded = Math.round(value * 10) / 10;
  return (
    <td
      className={`num ${rounded > 0 ? 'growth-up' : rounded < 0 ? 'growth-down' : ''}`}
      // What it actually compared against. The measurement point is fixed
      // at 02:05 UTC, but the collector may not have run then, so the cell
      // names the reading it really used rather than implying yesterday.
      title={since === null ? undefined : `vs ${new Date(since).toISOString().slice(0, 10)}`}
    >
      {rounded > 0 ? '+' : ''}
      {rounded.toFixed(1)}%
    </td>
  );
}

// Module level so the reference is stable across renders.
// Rank is searchable rather than sortable. It rides inside the name cell
// (see below), so there is no column header to sort by — typing R3 is how
// you get "everyone I would promote".
// game_uid is deliberately absent. It is not on screen any more, and a
// field you can search but cannot see is a way of reading it out one guess
// at a time.
const SEARCH_FIELDS = ['current_name', 'assigned_rank', 'computed_rank'] as const;

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

/** How many columns the table has before the admin's computed ones.
 *
 * Counted once, here, because a group heading has to span the whole width and a
 * heading that spans the wrong number leaves a cell sitting under it. If a column is
 * added to the header, this changes with it.
 */
const BASE_COLUMNS = 16;

/** What each in-game rank is called.
 *
 * R5 is the leader and R1 the newest member, which is the game's own ordering and
 * the opposite of the computed tier's — where R3 is the best (see 0087). Two
 * meanings of "R3" in one product is unfortunate and not ours to rename, so the
 * headings say which one this is.
 */
const RANK_LABELS: Record<number, string> = {
  5: 'R5 · leader',
  4: 'R4 · officers',
  3: 'R3',
  2: 'R2',
  1: 'R1',
};

interface RankGroup {
  key: string;
  label: string;
  rows: RosterRow[];
}

/** The rows split by game rank, highest first.
 *
 * SORTING IS PRESERVED INSIDE EACH GROUP. Grouping and sorting would otherwise
 * fight: somebody who sorts by power expects the strongest first, and re-sorting by
 * rank would throw that away. So the sort decides the order within a group and the
 * group decides where the block sits — "the strongest R4s" is then one glance, which
 * neither arrangement alone gives.
 *
 * Members whose rank nobody has read fall into a group of their own at the bottom
 * rather than being dropped or lumped in with R1. That happens to a logged-out
 * reader, for whom the roster answer is withheld entirely.
 */
function grouped(rows: readonly RosterRow[]): RankGroup[] {
  const byRank = new Map<number, RosterRow[]>();
  const unranked: RosterRow[] = [];
  for (const row of rows) {
    if (row.member_rank === null) {
      unranked.push(row);
      continue;
    }
    const bucket = byRank.get(row.member_rank);
    if (bucket === undefined) {
      byRank.set(row.member_rank, [row]);
    } else {
      bucket.push(row);
    }
  }
  const out: RankGroup[] = [...byRank.entries()]
    .sort(([a], [b]) => b - a)
    .map(([rank, group]) => ({
      key: `rank-${rank}`,
      label: RANK_LABELS[rank] ?? `R${rank}`,
      rows: group,
    }));
  if (unranked.length > 0) {
    out.push({ key: 'rank-none', label: 'Rank not read', rows: unranked });
  }
  return out;
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
  const { data: session } = useSession();
  const { data: permissions } = usePermissions();
  const queryClient = useQueryClient();
  const [rankError, setRankError] = useState<string | null>(null);
  const mayRank = isAllowed(permissions?.grants, session?.role, 'members.manage');

  const setRank = useMutation({
    mutationFn: async ({ playerId, rank }: { playerId: string; rank: string | null }) => {
      // Clearing an override is a delete, not a null: the row exists only
      // while somebody has decided something, and its absence is what makes
      // the computed tier take over again.
      if (rank === null) {
        const { error, count: removed } = await supabase
          .from('player_ranks')
          .delete({ count: 'exact' })
          .eq('player_id', playerId);
        if (error) {
          throw new Error(error.message);
        }
        // Nothing to remove is success, not a refusal — the override may
        // already have been absent.
        if (removed === 0) {
          return;
        }
        return;
      }
      // set_by is stamped by a trigger from the session (0059), so it is
      // deliberately not sent.
      const { error, count: written } = await supabase
        .from('player_ranks')
        .upsert({ player_id: playerId, assigned_rank: rank }, { count: 'exact' });
      if (error) {
        throw new Error(error.message);
      }
      if (written === 0) {
        throw new Error('Nothing was written. Setting a rank needs "Manage members".');
      }
    },
    onSuccess: () => {
      setRankError(null);
      void queryClient.invalidateQueries({ queryKey: ['roster'] });
    },
    onError: (error: Error) => setRankError(error.message),
  });
  const [starredOnly, setStarredOnly] = useState(false);
  // Before the search, so the count reads "3 / 8 of my starred members"
  // rather than "3 / 50 of everyone".
  const computed = useMemo(() => withFormulas(rows, columns), [rows, columns]);
  // The rank the cell actually shows, as a field, so the column can be sorted on
  // it. Derived rather than stored: `assigned_rank ?? computed_rank` is already
  // how RankBadge decides what to print, and duplicating that rule in a sort
  // comparator is how the two drift apart.
  const ranked = useMemo(
    () => computed.map((row) => ({ ...row, rank_shown: row.assigned_rank ?? row.computed_rank })),
    [computed],
  );
  const visible = useMemo(
    () => (starredOnly ? ranked.filter((row) => isFavourite('player', row.player_id)) : ranked),
    [ranked, starredOnly, isFavourite],
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
      {rankError !== null && <p className="error">{rankError}</p>}
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
      {/* `pinned-rank` is what shifts the name column right by the rank column's
          width. A marker on the wrapper rather than :nth-child, for the reason
          every other rule in that stylesheet carries: column positions here have
          already moved twice, and the one place that inferred a column from its
          position right-aligned Arena's names against the scores. */}
      <div className="table-wrap pinned-rank">
        <table>
          <thead>
            <tr>
              {/* Sorted on the SHOWN rank, not on `assigned_rank`: 71 of 94
                  members have no assignment, and sorting the stored column would
                  file all of them at the end regardless of what the last period
                  worked out for them. `rank_shown` is the value in the cell, so
                  the order matches what the reader is looking at.
                  R1 < R2 < … < R5 alphabetically, so descending puts the leader
                  first, which is what a first click on a rank column should do. */}
              <SortableTh className="pin-rank" onSort={onSort} sort={sort} sortKey="rank_shown">
                {TERMS.rank}
              </SortableTh>
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
              {/* Growth sits with the figure it is derived from rather than
                  at the end: power is the number, these two are which way it
                  is going, and reading them apart makes neither useful. */}
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="growth_1d">
                Growth (1d)
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="growth_7d">
                Growth (1w)
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="last_online_at">
                {TERMS.lastOnline}
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="last_seen_at">
                {TERMS.lastSeen}
              </SortableTh>
              {/* The score the rank came from. Next to the derived columns
                  rather than next to the name, because it is worked out
                  rather than observed — but before them, because it is the
                  one the alliance runs on. */}
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="rank_score">
                Rank score
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
            {grouped(view).map((group) => (
              <Fragment key={group.key}>
                {/* A heading row per game rank. `scope="colgroup"` so a screen
                    reader announces it as heading the rows beneath rather than as a
                    stray cell, and it spans every column so nothing lines up under
                    it by accident. */}
                <tr className="group-row">
                  <th colSpan={BASE_COLUMNS + columns.length} scope="colgroup">
                    {group.label}{' '}
                    <span className="subtle">
                      {group.rows.length} member{group.rows.length === 1 ? '' : 's'}
                    </span>
                  </th>
                </tr>
                {group.rows.map((row) => (
                  <tr key={row.player_id}>
                    {/* Inside the name cell, not a column of its own: on a
                    phone that cell is the one pinned to the left, so the
                    star stays reachable instead of scrolling away with the
                    figures. */}
                    {/* Rank in its own cell, pinned to the left of the name. It used
                    to sit inside the name cell — see RankBadge — which kept it
                    visible while scrolling but made it unsortable, and "R3s,
                    weakest first" is a question this table exists to answer. Both
                    cells are pinned now, so nothing slid under anything. */}
                    <td className="pin-rank">
                      <RankBadge
                        editable={mayRank}
                        onSet={(playerId, rank) => setRank.mutate({ playerId, rank })}
                        row={row}
                      />
                    </td>
                    <td className="label">
                      {signedIn && (
                        <FavouriteButton
                          id={row.player_id}
                          isFavourite={isFavourite('player', row.player_id)}
                          kind="player"
                          label={row.current_name ?? 'an unnamed member'}
                          onToggle={toggle}
                        />
                      )}
                      {/* No uid fallback here. Every member on this screen has
                      a name, and printing the game uid for the one who does
                      not would put an identifier on the page that the rest
                      of it deliberately leaves off. The row still links, so
                      the player page can say who it is. */}
                      <a href={playerHash(row.player_id)}>{row.current_name ?? 'Unnamed'}</a>
                    </td>
                    <td className="num">{row.hq_level ?? '—'}</td>
                    <td className="num">{formatNumber(row.power)}</td>
                    <td className="num">{formatNumber(row.kills)}</td>
                    <td className="num group-start">{formatNumber(row.daily_donation_score)}</td>
                    <td className="num">{formatNumber(row.weekly_donation_score)}</td>
                    <td className="num group-start">{formatNumber(row.duel_daily_score)}</td>
                    <td className="num">{formatNumber(row.duel_weekly_score)}</td>
                    <td className="num">{formatNumber(row.duel_round_score)}</td>
                    <GrowthCell since={row.growth_1d_at} value={row.growth_1d} />
                    <GrowthCell since={row.growth_7d_at} value={row.growth_7d} />
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
                    <td className="num" title={row.computed_rank ?? undefined}>
                      {row.rank_score === null ? '—' : row.rank_score.toFixed(1)}
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
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {view.length === 0 && <p className="empty">No member matches “{query}”.</p>}
    </>
  );
}
