// Who took part: every current member against every event, over the season,
// one duel round, or one week (0204).
//
// TWO KINDS OF COLUMN, and the page keeps them visibly apart. Duel, donations,
// Black Gold and season buildings are CAPTURED — read off the game by the
// collector. The rest are TICKED by an officer, because nobody has captured
// those events yet; their header says so.
//
// A DASH IS NOT A ZERO. "2/5" for duel days means the board was read on five
// days in the range and the member scored on two. A day nobody read is not in
// the five, so a gap in our capture never counts against a member.

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { SortableTh } from '../../components/SortableTh';
import { BarCell } from '../../components/ui/BarCell';
import { Select } from '../../components/ui/Select';
import { Tabs } from '../../components/ui/Tabs';
import { isAllowed, usePermissions } from '../../lib/permissions';
import { type SortState, nextSort } from '../../lib/tableControls';
import { useSession } from '../../lib/useSession';
import { AttendanceRecorder } from './AttendanceRecorder';
import {
  type EventKind,
  type ParticipationRow,
  type SortKey,
  type TypedTally,
  fetchEventKinds,
  fetchParticipation,
  isLow,
  sortRows,
} from './data';
import { type Period, type PeriodKind, roundPeriods, seasonPeriod, weekPeriods } from './periods';

/** A season of readings changes when a sweep lands, not by the minute. */
const STALE_TIME = 5 * 60_000;

/** The report's tabs (2026-10-03): the everyday boards, the alliance's
 * events, and the season's own. Which event sits where is the event's
 * `board` (0213); buildings are season progress. */
type Board = 'daily' | 'event' | 'season';
const BOARDS: ReadonlyArray<[Board, string]> = [
  ['daily', 'Daily'],
  ['event', 'Events'],
  ['season', 'Season events'],
];

const KIND_LABELS: ReadonlyArray<[PeriodKind, string]> = [
  ['season', 'Season'],
  ['round', 'Duel round'],
  ['week', 'Week'],
];

function n(value: number): string {
  return value.toLocaleString('ko-KR');
}

/** Scored days out of read days. Marked when under half. */
function DaysCell({
  scored,
  onBoard,
  read,
  unit,
}: {
  scored: number;
  onBoard: number;
  read: number;
  unit: string;
}) {
  if (read === 0) {
    return <td className="num muted">—</td>;
  }
  const low = isLow(scored, read);
  const off = read - onBoard;
  return (
    <td
      className={`num ${low ? 'growth-down' : ''}`}
      title={`Scored on ${scored} of the ${read} ${unit}s the board was read. On the board ${onBoard}, not on it ${off}.`}
    >
      {low && (
        <span aria-label="Under half" className="below-minimum">
          ●
        </span>
      )}
      <span className="figure-bar">
        {scored}/{read}
        <BarCell low={low} max={read} value={scored} />
      </span>
    </td>
  );
}

/** The range's total, with how many of the read weeks it is made of. */
function TotalCell({
  total,
  onBoard,
  read,
}: {
  total: number | null;
  onBoard: number;
  read: number;
}) {
  if (total === null) {
    return <td className="num muted">—</td>;
  }
  return (
    <td className="num" title={`On ${onBoard} of the ${read} weekly boards read.`}>
      {n(total)}
      <span className="muted participation-sub">
        {onBoard}/{read} wk
      </span>
    </td>
  );
}

function BlackGoldCell({ row }: { row: ParticipationRow }) {
  if (row.black_gold_listed === 0 && row.black_gold_played === 0) {
    return <td className="num muted">—</td>;
  }
  const missed = row.black_gold_starter_missed + row.black_gold_substitute_missed;
  return (
    <td
      className="num"
      title={`Listed ${row.black_gold_listed}, played ${row.black_gold_played}. Missed as starter ${row.black_gold_starter_missed}, as substitute ${row.black_gold_substitute_missed}. Only battles with a captured report count.`}
    >
      {row.black_gold_played}/{row.black_gold_listed}
      {missed > 0 && (
        <>
          {' '}
          <span className="badge badge-loss">{missed} missed</span>
        </>
      )}
    </td>
  );
}

function TypedCell({ tally }: { tally: TypedTally | undefined }) {
  if (tally === undefined || tally.held === 0) {
    return <td className="num muted">—</td>;
  }
  const unrecorded = tally.held - tally.attended - tally.missed;
  const low = isLow(tally.attended, tally.held);
  return (
    <td
      className={`num ${low ? 'growth-down' : ''}`}
      title={`Held ${tally.held}: present ${tally.attended}, absent ${tally.missed}, not recorded ${unrecorded}.`}
    >
      {low && (
        <span aria-label="Under half" className="below-minimum">
          ●
        </span>
      )}
      <span className="figure-bar">
        <span>
          {tally.attended}/{tally.held}
          {unrecorded > 0 && <span className="muted"> ?{unrecorded}</span>}
        </span>
        <BarCell low={low} max={tally.held} value={tally.attended} />
      </span>
    </td>
  );
}

/** Watchtower level now, and levels gained in the range when it was read. */
function WatchtowerCell({ row }: { row: ParticipationRow }) {
  if (row.watchtower_level === null) {
    return <td className="num muted">—</td>;
  }
  return (
    <td
      className="num"
      title="Watchtower (main building) level at the end of the range, and levels gained inside it. No gain shown when nobody read the member in the range."
    >
      Lv {row.watchtower_level}
      {row.watchtower_gained !== null && (
        <span className={row.watchtower_gained > 0 ? undefined : 'muted'}>
          {' '}
          (+{row.watchtower_gained})
        </span>
      )}
    </td>
  );
}

function Summary({ rows, kinds }: { rows: ParticipationRow[]; kinds: EventKind[] }) {
  const first = rows[0];
  if (first === undefined) return null;
  const held = kinds
    .map((kind) => {
      const count = Math.max(0, ...rows.map((row) => row.typed_events[kind.kind]?.held ?? 0));
      return count > 0 ? `${kind.label} ${count}` : null;
    })
    .filter((entry): entry is string => entry !== null);
  return (
    <p className="subtle">
      {rows.length} members. Duel board read on {first.duel_days_read} days and{' '}
      {first.duel_weeks_read} weeks; donation board on {first.donation_days_read} days and{' '}
      {first.donation_weeks_read} weeks.{' '}
      {held.length > 0 ? (
        <>Recorded by officers: {held.join(', ')}.</>
      ) : (
        <>No event recorded by officers yet.</>
      )}
    </p>
  );
}

export function ParticipationPage() {
  const [now] = useState(() => new Date());
  const season = useMemo(() => seasonPeriod(now), [now]);
  const rounds = useMemo(() => roundPeriods(now), [now]);
  const weeks = useMemo(() => weekPeriods(now), [now]);

  const [kind, setKind] = useState<PeriodKind>('season');
  const [roundIndex, setRoundIndex] = useState(0);
  const [weekIndex, setWeekIndex] = useState(0);
  const period: Period =
    kind === 'round'
      ? (rounds[roundIndex] ?? season)
      : kind === 'week'
        ? (weeks[weekIndex] ?? season)
        : season;

  const [sort, setSort] = useState<SortState>({ key: 'name', direction: 'asc' });
  const [board, setBoard] = useState<Board>('daily');

  const { data: session } = useSession();
  const { data: permissions } = usePermissions();
  const mayRecord = isAllowed(permissions?.grants, session?.role, 'data.enter');

  const report = useQuery({
    queryKey: ['participation', period.from, period.to],
    queryFn: () => fetchParticipation(period.from, period.to),
    staleTime: STALE_TIME,
  });
  const kinds = useQuery({
    queryKey: ['attendance-kinds'],
    queryFn: fetchEventKinds,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const rows = report.data ?? [];
  const eventKinds = kinds.data ?? [];
  const boardKinds = eventKinds.filter((eventKind) => eventKind.board === board);
  const ordered = sortRows(rows, sort.key as SortKey, sort.direction === 'desc');
  const onSort = (key: string) => setSort(nextSort(sort, key));

  return (
    <section aria-labelledby="participation-heading">
      <h2 id="participation-heading">Participation</h2>

      <div className="row">
        <Tabs
          label="Period"
          items={KIND_LABELS.map(([id, label]) => ({ id, label }))}
          value={kind}
          onChange={setKind}
        />
        {kind === 'round' && (
          <label>
            Round{' '}
            <Select onChange={(chosen) => setRoundIndex(Number(chosen))} value={roundIndex}>
              {rounds.map((round, index) => (
                <option key={round.from} value={index}>
                  {round.label}
                  {index === 0 ? ' (current)' : ''}
                </option>
              ))}
            </Select>
          </label>
        )}
        {kind === 'week' && (
          <label>
            Week{' '}
            <Select onChange={(chosen) => setWeekIndex(Number(chosen))} value={weekIndex}>
              {weeks.map((week, index) => (
                <option key={week.from} value={index}>
                  {week.label}
                  {index === 0 ? ' (this week)' : ''}
                </option>
              ))}
            </Select>
          </label>
        )}
        {kind === 'season' && <span className="subtle">{season.label}</span>}
      </div>

      {report.isPending && <p className="empty">Loading…</p>}
      {report.error && (
        <p className="error">Could not load participation: {report.error.message}</p>
      )}
      {report.data && rows.length === 0 && (
        <p className="empty">Nobody is on the roster for this alliance yet.</p>
      )}

      {rows.length > 0 && (
        <>
          <Summary kinds={eventKinds} rows={rows} />
          <Tabs
            label="Report"
            className="row"
            items={BOARDS.map(([id, label]) => ({ id, label }))}
            value={board}
            onChange={setBoard}
          />
          <div className="table-wrap">
            <table className="compact">
              <thead>
                <tr>
                  <SortableTh className="label" onSort={onSort} sort={sort} sortKey="name">
                    Member
                  </SortableTh>
                  {board === 'daily' && (
                    <>
                      <SortableTh numeric onSort={onSort} sort={sort} sortKey="duel_days">
                        Duel days
                      </SortableTh>
                      <SortableTh numeric onSort={onSort} sort={sort} sortKey="duel_total">
                        Duel total
                      </SortableTh>
                      <SortableTh numeric onSort={onSort} sort={sort} sortKey="donation_days">
                        Donation days
                      </SortableTh>
                      <SortableTh numeric onSort={onSort} sort={sort} sortKey="donation_total">
                        Donation total
                      </SortableTh>
                    </>
                  )}
                  {board === 'event' && (
                    <SortableTh numeric onSort={onSort} sort={sort} sortKey="black_gold">
                      Black Gold
                    </SortableTh>
                  )}
                  {board === 'season' && (
                    <>
                      <SortableTh numeric onSort={onSort} sort={sort} sortKey="buildings">
                        Season buildings
                      </SortableTh>
                      <SortableTh numeric onSort={onSort} sort={sort} sortKey="watchtower">
                        Watchtower
                      </SortableTh>
                    </>
                  )}
                  {boardKinds.map((eventKind) => (
                    <SortableTh
                      key={eventKind.kind}
                      numeric
                      onSort={onSort}
                      sort={sort}
                      sortKey={`typed:${eventKind.kind}`}
                    >
                      {eventKind.label}
                      {!eventKind.captured && (
                        <span className="muted" title="Recorded by an officer, not captured">
                          {' '}
                          ✎
                        </span>
                      )}
                    </SortableTh>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ordered.map((row) => (
                  <tr key={row.player_id}>
                    <td className="label">
                      <a href={`#/player/${row.player_id}`}>
                        {row.current_name ?? row.player_id.slice(0, 8)}
                      </a>
                    </td>
                    {board === 'daily' && (
                      <>
                        <DaysCell
                          onBoard={row.duel_days_on_board}
                          read={row.duel_days_read}
                          scored={row.duel_days_scored}
                          unit="day"
                        />
                        <TotalCell
                          onBoard={row.duel_weeks_on_board}
                          read={row.duel_weeks_read}
                          total={row.duel_total}
                        />
                        <DaysCell
                          onBoard={row.donation_days_on_board}
                          read={row.donation_days_read}
                          scored={row.donation_days_scored}
                          unit="day"
                        />
                        <TotalCell
                          onBoard={row.donation_weeks_on_board}
                          read={row.donation_weeks_read}
                          total={row.donation_total}
                        />
                      </>
                    )}
                    {board === 'event' && <BlackGoldCell row={row} />}
                    {board === 'season' && (
                      <>
                        <td
                          className="num"
                          title="Season building levels gained in this range, as far as our map sweeps have seen."
                        >
                          {row.season_levels_gained === null ? (
                            <span className="muted">—</span>
                          ) : (
                            `+${row.season_levels_gained}`
                          )}
                        </td>
                        <WatchtowerCell row={row} />
                      </>
                    )}
                    {boardKinds.map((eventKind) => (
                      <TypedCell key={eventKind.kind} tally={row.typed_events[eventKind.kind]} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="note">
            Days and events read <strong>scored / read</strong>: the days the board was read for the
            alliance, and how many of them the member scored on. Duel days are Monday to Saturday:
            the duel does not run on Sunday. A day nobody captured is left out, so a gap in our
            capture never counts against anybody; a dash means there was nothing to judge. ● marks
            under half. Black Gold is played / listed, from battles whose report was captured.
            Buildings are levels gained as far as our map sweeps have seen. Columns marked ✎ are
            ticked by officers, not captured, and ?N is event days nobody ticked this member for.
            Hover a cell for the detail.
          </p>
        </>
      )}

      {mayRecord && rows.length > 0 && eventKinds.length > 0 && (
        <AttendanceRecorder kinds={eventKinds} members={rows} now={now} />
      )}
    </section>
  );
}
