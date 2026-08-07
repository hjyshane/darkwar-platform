import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Fragment, type ReactNode, useMemo, useState } from 'react';
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
import { type ColumnSpec, arrangeColumns, columnWidth } from '../../lib/tableLayout';
import { TERMS } from '../../lib/terms';
import { type FavouriteKind, useFavourites } from '../../lib/useFavourites';
import { useSession } from '../../lib/useSession';
import { useTableLayout } from '../../lib/useTableLayout';
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
/** Growth as text, colour and tooltip — three pieces rather than a cell.
 *
 * It used to render its own `<td>`, which is why it could not be one of the
 * declared columns: the table owns the cell now, so a column contributes what goes
 * IN one and what it should be called, not the element itself.
 */
function growthText(value: number | null): string {
  if (value === null) {
    return '—';
  }
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}%`;
}

function growthClass(value: number | null): string {
  if (value === null) {
    return '';
  }
  const rounded = Math.round(value * 10) / 10;
  return rounded > 0 ? 'growth-up' : rounded < 0 ? 'growth-down' : '';
}

/** What it actually compared against. The measurement point is fixed at 02:05 UTC
 * but the collector may not have run then, so the cell names the reading it really
 * used rather than implying yesterday. */
function growthTitle(value: number | null, since: string | null): string | undefined {
  if (value === null) {
    return 'No earlier snapshot to compare against';
  }
  return since === null ? undefined : `vs ${new Date(since).toISOString().slice(0, 10)}`;
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

/** What the cells need that the row does not carry. Passed once rather than
 * captured, so a column's renderer is a plain function and stays testable. */
interface CellContext {
  now: Date | undefined;
  signedIn: boolean;
  mayRank: boolean;
  isFavourite: (kind: FavouriteKind, id: string | number) => boolean;
  toggleFavourite: (kind: FavouriteKind, id: string | number) => void;
  setRank: (playerId: string, rank: string | null) => void;
}

interface BaseColumn extends ColumnSpec {
  /** The key `sortRows` orders by. Every base column is sortable; the id and the
   * sort key differ only where the shown value is not the stored one. */
  sortKey: string;
  className?: string;
  numeric?: boolean;
  cell: (row: RosterRow, context: CellContext) => ReactNode;
  /** Extra class for the cell, when the value decides it — growth is green or red
   * by its sign, which is a property of the reading rather than of the column. */
  cellClassName?: (row: RosterRow) => string;
  cellTitle?: (row: RosterRow) => string | undefined;
}

/** The members table, as data.
 *
 * It was fifteen hand-written `<th>`s and fifteen hand-written `<td>`s, which is
 * why an admin could not reorder or hide anything: there was nothing to reorder.
 * Declaring the columns is what lets `arrangeColumns` do its job, and what lets the
 * next table adopt the same settings screen by declaring its own.
 *
 * The reasoning that sat beside each header has come with it, because that is the
 * part that is expensive to rediscover.
 */
/** This table's key in the shared arrangement. A new table picks its own and
 * needs nothing else. */
export const TABLE_ID = 'members';

/** What the settings screen is allowed to see of this table: identity, nothing
 * else. Exported separately from `BASE_COLUMNS` so the admin form cannot reach a
 * cell renderer — arranging columns is a question about names and order, and a
 * form that could call `cell()` would need a row to call it with. */
export function columnSpecs(): ColumnSpec[] {
  return BASE_COLUMNS.map((column) =>
    column.fixed === true
      ? { id: column.id, label: column.label, fixed: true }
      : { id: column.id, label: column.label },
  );
}

const BASE_COLUMNS: BaseColumn[] = [
  {
    // Sorted on the SHOWN rank, not on `assigned_rank`: 71 of 94 members have no
    // assignment, and sorting the stored column would file all of them at the end
    // regardless of what the last period worked out. R1 < R2 < … < R5
    // alphabetically, so descending puts the leader first.
    id: 'rank',
    label: TERMS.rank,
    sortKey: 'rank_shown',
    className: 'pin-rank',
    cell: (row, context) => (
      <RankBadge editable={context.mayRank} onSet={context.setRank} row={row} />
    ),
  },
  {
    // Fixed: the name is how you tell one row from another, and hiding it leaves a
    // grid of figures belonging to nobody. The favourite star lives inside this
    // cell because on a phone this is the one pinned to the left.
    id: 'name',
    label: TERMS.name,
    sortKey: 'current_name',
    className: 'label',
    fixed: true,
    cell: (row, context) => (
      <>
        {context.signedIn && (
          <FavouriteButton
            id={row.player_id}
            isFavourite={context.isFavourite('player', row.player_id)}
            kind="player"
            label={row.current_name ?? 'an unnamed member'}
            onToggle={context.toggleFavourite}
          />
        )}
        {/* No uid fallback. Every member here has a name, and printing the game uid
            for one who does not would put an identifier on a page that deliberately
            leaves it off. The row still links, so the player page can say who. */}
        <a href={playerHash(row.player_id)}>{row.current_name ?? 'Unnamed'}</a>
      </>
    ),
  },
  {
    id: 'hq_level',
    label: TERMS.hq,
    sortKey: 'hq_level',
    numeric: true,
    cell: (row) => row.hq_level ?? '—',
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
  {
    // `group-start` marks where the donation family begins, and again where the
    // duel family does. Five adjacent figures otherwise invite a comparison that
    // means nothing — a daily donation against a total over four duel rounds.
    id: 'daily_donation_score',
    label: TERMS.dailyDonation,
    sortKey: 'daily_donation_score',
    className: 'group-start',
    numeric: true,
    cell: (row) => formatNumber(row.daily_donation_score),
  },
  {
    // Two donation commands, two columns. The weekly figure is reported by the
    // game, not summed from the daily one.
    id: 'weekly_donation_score',
    label: TERMS.weeklyDonation,
    sortKey: 'weekly_donation_score',
    numeric: true,
    cell: (row) => formatNumber(row.weekly_donation_score),
  },
  {
    // Three boards, three columns. They shared one until 0028, which meant the
    // figure shown depended on which of the three was inserted last.
    id: 'duel_daily_score',
    label: TERMS.duelDaily,
    sortKey: 'duel_daily_score',
    className: 'group-start',
    numeric: true,
    cell: (row) => formatNumber(row.duel_daily_score),
  },
  {
    id: 'duel_weekly_score',
    label: TERMS.duelWeekly,
    sortKey: 'duel_weekly_score',
    numeric: true,
    cell: (row) => formatNumber(row.duel_weekly_score),
  },
  {
    id: 'duel_round_score',
    label: TERMS.duelRound,
    sortKey: 'duel_round_score',
    numeric: true,
    cell: (row) => formatNumber(row.duel_round_score),
  },
  {
    id: 'growth_1d',
    label: 'Growth (1d)',
    sortKey: 'growth_1d',
    numeric: true,
    cell: (row) => growthText(row.growth_1d),
    cellClassName: (row) => growthClass(row.growth_1d),
    cellTitle: (row) => growthTitle(row.growth_1d, row.growth_1d_at),
  },
  {
    id: 'growth_7d',
    label: 'Growth (1w)',
    sortKey: 'growth_7d',
    numeric: true,
    cell: (row) => growthText(row.growth_7d),
    cellClassName: (row) => growthClass(row.growth_7d),
    cellTitle: (row) => growthTitle(row.growth_7d, row.growth_7d_at),
  },
  {
    // Two different facts, deliberately side by side: when the player was last in
    // the game, and when we last looked. They were conflated until 0024 — Last Seen
    // was captured_at wearing a name that reads like presence.
    id: 'last_online_at',
    label: TERMS.lastOnline,
    sortKey: 'last_online_at',
    numeric: true,
    cell: (row, context) =>
      formatLastOnline(row.online_state, row.last_online_at, context.now ?? new Date()),
  },
  {
    id: 'last_seen_at',
    label: TERMS.lastSeen,
    sortKey: 'last_seen_at',
    numeric: true,
    cell: (row, context) => <FreshnessBadge capturedAt={row.last_seen_at} now={context.now} />,
  },
  {
    id: 'rank_score',
    label: 'Rank score',
    sortKey: 'rank_score',
    numeric: true,
    cell: (row) => (row.rank_score === null ? '—' : row.rank_score.toFixed(1)),
    cellTitle: (row) => row.computed_rank ?? undefined,
  },
];

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
  // The shared arrangement (0-migration: it lives in `app_settings`). Undefined
  // until the query answers, which `arrangeColumns` reads as "no arrangement" and
  // renders the declared order — a beat of the default beats a blank table.
  const layout = useTableLayout(TABLE_ID);
  const arranged = useMemo(() => arrangeColumns(BASE_COLUMNS, layout) as BaseColumn[], [layout]);
  const widthStyle = (id: string) => {
    const width = columnWidth(layout, id);
    return width === undefined ? undefined : { width: `${width}px` };
  };
  const cellContext: CellContext = {
    now,
    signedIn,
    mayRank,
    isFavourite,
    toggleFavourite: toggle,
    setRank: (playerId, rank) => setRank.mutate({ playerId, rank }),
  };

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
          {/* Widths, when an admin set any. A colgroup rather than a style on every
              cell: one element per column, and the browser applies it to the whole
              column including the group heading rows. */}
          <colgroup>
            {arranged.map((column) => (
              <col key={column.id} style={widthStyle(column.id)} />
            ))}
            {columns.map((column) => (
              <col key={column.id} style={widthStyle(column.id)} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {arranged.map((column) => (
                <SortableTh
                  key={column.id}
                  className={column.className}
                  numeric={column.numeric}
                  onSort={onSort}
                  sort={sort}
                  sortKey={column.sortKey}
                >
                  {column.label}
                </SortableTh>
              ))}
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
                  <th colSpan={arranged.length + columns.length} scope="colgroup">
                    {/* The cell spans every column, so it scrolls sideways with the
                        table and the label leaves the screen. Sticking the LABEL
                        inside it keeps "R4 · officers" in view while the figures
                        scroll past — the cell cannot stick, because it is the thing
                        being scrolled (see `.group-label`).

                        The span counts the ARRANGED columns, not a fixed number: an
                        admin can hide columns now, and a colSpan that outlived the
                        columns it counted would stretch the heading past the table. */}
                    <span className="group-label">
                      {group.label}{' '}
                      <span className="subtle">
                        {group.rows.length} member{group.rows.length === 1 ? '' : 's'}
                      </span>
                    </span>
                  </th>
                </tr>
                {group.rows.map((row) => (
                  <tr key={row.player_id}>
                    {arranged.map((column) => (
                      <td
                        className={[
                          column.numeric === true ? 'num' : '',
                          column.className ?? '',
                          column.cellClassName?.(row) ?? '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        key={column.id}
                        title={column.cellTitle?.(row)}
                      >
                        {column.cell(row, cellContext)}
                      </td>
                    ))}
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
