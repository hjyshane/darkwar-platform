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
import { StatTile } from '../../components/StatTile';
import { BarCell } from '../../components/ui/BarCell';
import { Select } from '../../components/ui/Select';
import { Tabs } from '../../components/ui/Tabs';
import { rich, useT } from '../../lib/i18n';
import { isAllowed, usePermissions } from '../../lib/permissions';
import {
  FALLBACK_SEASONS,
  SEASON3_START,
  currentSeason,
  pastSeason,
  seasonPhase,
  useSeasons,
} from '../../lib/seasons';
import { type SortState, nextSort } from '../../lib/tableControls';
import { useSession } from '../../lib/useSession';
import { AttendanceRecorder } from './AttendanceRecorder';
import {
  type EventKind,
  NO_BARS,
  type ParticipationRow,
  type SortKey,
  type TypedTally,
  blackGoldExpected,
  fetchBars,
  fetchEventKinds,
  fetchParticipation,
  isLow,
  sortRows,
  tallyCounts,
  useLowShare,
} from './data';
import {
  type Period,
  type PeriodKind,
  breakPeriod,
  customPeriod,
  endedSeasonPeriod,
  gameDate,
  roundPeriods,
  seasonPeriod,
  weekPeriods,
} from './periods';
import { participationStrip } from './strip';

/** A season of readings changes when a sweep lands, not by the minute. */
const STALE_TIME = 5 * 60_000;

/** The report's tabs (2026-10-03): the everyday boards, the alliance's
 * events, and the season's own. Which event sits where is the event's
 * `board` (0213); buildings are season progress. */
type Board = 'daily' | 'event' | 'season';
export const BOARDS: ReadonlyArray<[Board, string]> = [
  ['daily', 'Daily'],
  ['event', 'Events'],
  ['season', 'Season events'],
];

/** The screen's two views (2026-10-11): the report, and the officers' attendance
 * form, which sat under the table where it took a scroll to the bottom to
 * reach. Only people with data.enter get the second. */
type View = 'report' | 'record';

/** The period tabs. Inside a season: this season, the one before it, then the
 * round / week / custom ranges. In the break between two seasons there is no
 * season in progress, so the break comes first and the season that just ended
 * is the previous one. */
export const REST_KINDS: ReadonlyArray<[PeriodKind, string]> = [
  ['round', 'Duel round'],
  ['week', 'Week'],
  ['custom', 'Custom'],
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
  const lowShare = useLowShare();
  const t = useT();
  if (read === 0) {
    return <td className="num muted">—</td>;
  }
  const low = isLow(scored, read, lowShare);
  const off = read - onBoard;
  return (
    <td
      className={`num ${low ? 'growth-down' : ''}`}
      title={t(
        'Scored on {scored} of the {read} {units} the board was read. On the board {onboard}, not on it {off}.',
        {
          scored,
          read,
          units: unit === 'day' ? t('days') : `${unit}s`,
          onboard: onBoard,
          off,
        },
      )}
    >
      {low && (
        <span aria-label={t('Under half')} className="below-minimum">
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

/** Days the daily board reached the bar, out of the days it was read. */
function OverCell({ over, read, bar }: { over: number | null; read: number; bar: number }) {
  const lowShare = useLowShare();
  const t = useT();
  if (over === null || read === 0) {
    return <td className="num muted">—</td>;
  }
  const low = isLow(over, read, lowShare);
  return (
    <td
      className={`num ${low ? 'growth-down' : ''}`}
      title={t('Reached {bar} on {over} of the {read} days the board was read.', {
        bar: n(bar),
        over,
        read,
      })}
    >
      <span className="figure-bar">
        {over}/{read}
        <BarCell low={low} max={read} value={over} />
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
  const t = useT();
  if (total === null) {
    return <td className="num muted">—</td>;
  }
  return (
    <td
      className="num"
      title={t('On {onboard} of the {read} weekly boards read.', { onboard: onBoard, read })}
    >
      {n(total)}
      <span className="muted participation-sub">
        {onBoard}/{read} {t('wk')}
      </span>
    </td>
  );
}

function BlackGoldCell({ row }: { row: ParticipationRow }) {
  const t = useT();
  const expected = blackGoldExpected(row);
  if (expected === 0 && row.black_gold_played === 0) {
    return <td className="num muted">—</td>;
  }
  // Only a starter who did not play missed. A substitute who played took part;
  // one who did not play was not needed and is neither a miss nor expected.
  const missed = row.black_gold_starter_missed;
  return (
    <td
      className="num"
      title={t(
        'Played {played} of {expected}: every battle as a starter, and the ones a substitute played. Missed as starter {missed}. A substitute who did not play ({unneeded}) is not counted. Only battles with a captured report count.',
        {
          played: row.black_gold_played,
          expected,
          missed: row.black_gold_starter_missed,
          unneeded: row.black_gold_substitute_missed,
        },
      )}
    >
      {row.black_gold_played}/{expected}
      {missed > 0 && (
        <>
          {' '}
          <span className="badge badge-loss">{t('{count} missed', { count: missed })}</span>
        </>
      )}
    </td>
  );
}

function TypedCell({ kind, tally }: { kind: string; tally: TypedTally | undefined }) {
  const lowShare = useLowShare();
  const t = useT();
  if (tally === undefined || tally.held === 0) {
    return <td className="num muted">—</td>;
  }
  const { missed, unrecorded } = tallyCounts(kind, tally);
  const low = isLow(tally.attended, tally.held, lowShare);
  return (
    <td
      className={`num ${low ? 'growth-down' : ''}`}
      title={t('Held {held}: present {attended}, absent {missed}, not recorded {unrecorded}.', {
        held: tally.held,
        attended: tally.attended,
        missed,
        unrecorded,
      })}
    >
      {low && (
        <span aria-label={t('Under half')} className="below-minimum">
          ●
        </span>
      )}
      <span className="figure-bar">
        <span>
          {tally.attended}/{tally.held}
          {unrecorded > 0 && <span className="muted"> ?{unrecorded}</span>}
          {tally.score !== null && tally.score !== undefined && (
            <span
              className="muted participation-sub"
              title={t(
                'Total score over the days held: typed by an officer, or scanned where nobody typed one.',
              )}
            >
              {n(tally.score)}
            </span>
          )}
          {tally.damage !== null && tally.damage !== undefined && (
            <span
              className="muted participation-sub"
              title={t(
                "Total damage dealt over the days held, from the battle log. Troops taken off the other side, not the event's own score.",
              )}
            >
              {t('{damage} dmg', { damage: n(tally.damage) })}
            </span>
          )}
        </span>
        <BarCell low={low} max={tally.held} value={tally.attended} />
      </span>
    </td>
  );
}

/** Watchtower level now, and levels gained in the range when it was read. */
function WatchtowerCell({ row }: { row: ParticipationRow }) {
  const t = useT();
  if (row.watchtower_level === null) {
    return <td className="num muted">—</td>;
  }
  return (
    <td
      className="num"
      title={t(
        'Watchtower (main building) level at the end of the range, and levels gained inside it. No gain shown when nobody read the member in the range.',
      )}
    >
      {t('Lv {level}', { level: row.watchtower_level })}
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
  const t = useT();
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
      {t(
        '{members} members. Duel board read on {duel_days} days and {duel_weeks} weeks; donation board on {donation_days} days and {donation_weeks} weeks.',
        {
          members: rows.length,
          duel_days: first.duel_days_read,
          duel_weeks: first.duel_weeks_read,
          donation_days: first.donation_days_read,
          donation_weeks: first.donation_weeks_read,
        },
      )}{' '}
      {held.length > 0 ? (
        <>{t('Recorded by officers: {events}.', { events: held.join(', ') })}</>
      ) : (
        <>{t('No event recorded by officers yet.')}</>
      )}
    </p>
  );
}

export function ParticipationPage() {
  const t = useT();
  const [now] = useState(() => new Date());
  // The periods count from the current season's start (0242). Until the seasons
  // load, or when there are none, the constant Season 3 start answers.
  const seasonList = useSeasons();
  const seasons = seasonList.data ?? FALLBACK_SEASONS;
  const current = currentSeason(seasons, now);
  // Between seasons the "current" one is the one that just ended.
  const phase = seasonPhase(seasons, now);
  const inBreak = phase.phase === 'break';
  const seasonStart = current?.startsAt ?? SEASON3_START;
  const seasonName = current?.name ?? 'Season 3';
  // A season that has ended stops at its end; the break after it is not in it.
  const seasonEnd = current?.endsAt ?? null;
  const season = useMemo(
    () => seasonPeriod(now, seasonStart, seasonName, seasonEnd, t),
    [now, seasonStart, seasonName, seasonEnd, t],
  );
  const rounds = useMemo(
    () => roundPeriods(now, seasonStart, seasonEnd, t),
    [now, seasonStart, seasonEnd, t],
  );
  const weeks = useMemo(
    () => weekPeriods(now, seasonStart, seasonEnd, t),
    [now, seasonStart, seasonEnd, t],
  );
  // The custom range, as the two game dates an officer typed. Seeded with the
  // last week so the tab opens on something.
  const today = gameDate(now);
  const [customFrom, setCustomFrom] = useState(() =>
    gameDate(new Date(now.getTime() - 6 * 86_400_000)),
  );
  const [customTo, setCustomTo] = useState(today);

  // The season before the one in progress (in a break, the one that ended).
  const earlier = inBreak ? current : pastSeason(seasons, now);
  const previous = useMemo(
    () =>
      endedSeasonPeriod(earlier?.name ?? '', earlier?.startsAt ?? null, earlier?.endsAt ?? null, t),
    [earlier, t],
  );
  const betweenSeasons = useMemo(
    () =>
      phase.phase === 'break'
        ? breakPeriod(now, phase.ended.endsAt, phase.next?.startsAt ?? null, t)
        : null,
    [now, phase, t],
  );
  const periodKinds: [PeriodKind, string][] = [];
  if (inBreak) {
    if (betweenSeasons !== null) periodKinds.push(['break', t('Season break')]);
    if (previous !== null) periodKinds.push(['previous', t('Previous season')]);
  } else {
    periodKinds.push(['season', t('Season')]);
    if (previous !== null) periodKinds.push(['previous', t('Previous season')]);
  }
  periodKinds.push(...REST_KINDS.map(([id, label]): [PeriodKind, string] => [id, t(label)]));

  const [picked, setKind] = useState<PeriodKind>('season');
  // A kind that this phase does not offer (the seasons load after the first
  // paint) falls to the first one that it does.
  const kind: PeriodKind = periodKinds.some(([id]) => id === picked)
    ? picked
    : (periodKinds[0]?.[0] ?? 'season');
  const [roundIndex, setRoundIndex] = useState(0);
  const [weekIndex, setWeekIndex] = useState(0);
  const custom = customPeriod(customFrom, customTo, now, t);
  const period: Period =
    kind === 'round'
      ? (rounds[roundIndex] ?? season)
      : kind === 'week'
        ? (weeks[weekIndex] ?? season)
        : kind === 'custom'
          ? (custom ?? season)
          : kind === 'previous'
            ? (previous ?? season)
            : kind === 'break'
              ? (betweenSeasons ?? season)
              : season;

  const [sort, setSort] = useState<SortState>({ key: 'name', direction: 'asc' });
  const [board, setBoard] = useState<Board>('daily');
  const [view, setView] = useState<View>('report');

  const { data: session } = useSession();
  const { data: permissions } = usePermissions();
  const mayRecord = isAllowed(permissions?.grants, session?.role, 'data.enter');

  // The bars first: the report is the heavy call, and asking with the bars in
  // hand means it runs once, not once without them and again with.
  const barsQuery = useQuery({
    queryKey: ['participation-bars'],
    queryFn: fetchBars,
    staleTime: STALE_TIME,
  });
  const bars = barsQuery.data ?? NO_BARS;
  const report = useQuery({
    queryKey: ['participation', period.from, period.to, bars.duel, bars.donation],
    queryFn: () => fetchParticipation(period.from, period.to, bars),
    staleTime: STALE_TIME,
    enabled: !barsQuery.isPending,
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
  // A viewer who may not record never sees the second tab; one who lost the
  // permission mid-session falls back to the report.
  const activeView: View = mayRecord ? view : 'report';

  return (
    <section aria-labelledby="participation-heading" className="participation-screen">
      <div className="entity">
        <header className="entity-head">
          <span aria-hidden="true" className="entity-mark">
            PA
          </span>
          <div>
            <h2 id="participation-heading">{t('Participation')}</h2>
            <p className="entity-meta">
              <span>{period.label}</span>
              <span>{t('Server time, UTC−2')}</span>
            </p>
          </div>
        </header>
        {rows.length > 0 && (
          <div className="strip">
            {participationStrip(rows, bars, t).map((cell, index) => (
              <StatTile
                hero={index === 0}
                key={cell.label}
                label={cell.label}
                note={cell.note}
                value={cell.value}
              />
            ))}
          </div>
        )}
        {rows.length > 0 && (
          <div className="entity-foot">
            <Summary kinds={eventKinds} rows={rows} />
          </div>
        )}
      </div>

      {mayRecord && (
        <Tabs
          label={t('View')}
          className="row"
          items={[
            { id: 'report' as const, label: t('Report') },
            { id: 'record' as const, label: t('Record attendance') },
          ]}
          value={activeView}
          onChange={setView}
        />
      )}

      {activeView === 'report' && (
        <div className="row">
          <Tabs
            label={t('Period')}
            items={periodKinds.map(([id, label]) => ({ id, label }))}
            value={kind}
            onChange={setKind}
          />
          {kind === 'round' && (
            <label>
              {t('Round')}{' '}
              <Select onChange={(chosen) => setRoundIndex(Number(chosen))} value={roundIndex}>
                {rounds.map((round, index) => (
                  <option key={round.from} value={index}>
                    {round.label}
                    {index === 0 ? ` (${t('current')})` : ''}
                  </option>
                ))}
              </Select>
            </label>
          )}
          {kind === 'week' && (
            <label>
              {t('Week')}{' '}
              <Select onChange={(chosen) => setWeekIndex(Number(chosen))} value={weekIndex}>
                {weeks.map((week, index) => (
                  <option key={week.from} value={index}>
                    {week.label}
                    {index === 0 ? ` (${t('this week')})` : ''}
                  </option>
                ))}
              </Select>
            </label>
          )}
          {kind === 'custom' && (
            <>
              <label>
                {t('From')}{' '}
                <input
                  max={today}
                  onChange={(event) => setCustomFrom(event.target.value)}
                  type="date"
                  value={customFrom}
                />
              </label>
              <label>
                {t('To')}{' '}
                <input
                  max={today}
                  min={customFrom}
                  onChange={(event) => setCustomTo(event.target.value)}
                  type="date"
                  value={customTo}
                />
              </label>
              {custom === null ? (
                <span className="error">
                  {t('Pick a start on or before the end, no later than today.')}
                </span>
              ) : (
                <span className="subtle">{custom.label}</span>
              )}
            </>
          )}
          {(kind === 'season' || kind === 'previous' || kind === 'break') && (
            <span className="subtle">{period.label}</span>
          )}
        </div>
      )}

      {report.isPending && <p className="empty loading">{t('Loading…')}</p>}
      {report.error && (
        <p className="error">
          {t('Could not load participation: {error}', { error: report.error.message })}
        </p>
      )}
      {report.data && rows.length === 0 && (
        <p className="empty">{t('Nobody is on the roster for this alliance yet.')}</p>
      )}

      {activeView === 'report' && rows.length > 0 && (
        <div className="panel participation-board">
          <Tabs
            label={t('Report')}
            className="row"
            items={BOARDS.map(([id, label]) => ({ id, label: t(label) }))}
            value={board}
            onChange={setBoard}
          />
          <div className="table-wrap">
            <table className="compact">
              <thead>
                <tr>
                  <SortableTh className="label" onSort={onSort} sort={sort} sortKey="name">
                    {t('Member')}
                  </SortableTh>
                  {board === 'daily' && (
                    <>
                      <SortableTh numeric onSort={onSort} sort={sort} sortKey="duel_days">
                        {t('Duel days')}
                      </SortableTh>
                      {bars.duel !== null && (
                        <SortableTh numeric onSort={onSort} sort={sort} sortKey="duel_over">
                          {t('Duel ≥ {bar}', { bar: n(bars.duel) })}
                        </SortableTh>
                      )}
                      <SortableTh numeric onSort={onSort} sort={sort} sortKey="duel_total">
                        {t('Duel total')}
                      </SortableTh>
                      <SortableTh numeric onSort={onSort} sort={sort} sortKey="donation_days">
                        {t('Donation days')}
                      </SortableTh>
                      {bars.donation !== null && (
                        <SortableTh numeric onSort={onSort} sort={sort} sortKey="donation_over">
                          {t('Donation ≥ {bar}', { bar: n(bars.donation) })}
                        </SortableTh>
                      )}
                      <SortableTh numeric onSort={onSort} sort={sort} sortKey="donation_total">
                        {t('Donation total')}
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
                        {t('Season buildings')}
                      </SortableTh>
                      <SortableTh numeric onSort={onSort} sort={sort} sortKey="watchtower">
                        {t('Watchtower')}
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
                        <span className="muted" title={t('Recorded by an officer, not captured')}>
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
                        {bars.duel !== null && (
                          <OverCell
                            bar={bars.duel}
                            over={row.duel_days_over}
                            read={row.duel_days_read}
                          />
                        )}
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
                        {bars.donation !== null && (
                          <OverCell
                            bar={bars.donation}
                            over={row.donation_days_over}
                            read={row.donation_days_read}
                          />
                        )}
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
                          title={t(
                            'Season building levels gained in this range, as far as our map sweeps have seen.',
                          )}
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
                      <TypedCell
                        key={eventKind.kind}
                        kind={eventKind.kind}
                        tally={row.typed_events[eventKind.kind]}
                      />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="note">
            {rich(
              t(
                "Days and events read {ratio}: the days the board was read for the alliance, and how many of them the member scored on. Duel days are Monday to Saturday: the duel does not run on Sunday. A day nobody captured is left out, so a gap in our capture never counts against anybody; a dash means there was nothing to judge. ● marks under half. Black Gold is played / listed, from battles whose report was captured. Buildings are levels gained as far as our map sweeps have seen. Columns marked ✎ are ticked by officers, not captured, and ?N is event days nobody ticked this member for. Capital Clash counts a member present when they are on its score board (the top 100 of the server group), teleported into the capital, or had a city inside it while the battle ran; absent when they were seen outside it in the battle's last 15 minutes and on none of those; otherwise ?N, which is not known. Frankie counts each round once its damage board was opened inside the event: round 1 is who was on the board when round 2 began, and round 2 is whoever's damage grew after that; a round whose board was not opened after it ended shows ?N. Hover a cell for the detail.",
              ),
              { ratio: <strong>{t('scored / read')}</strong> },
            )}
          </p>
        </div>
      )}

      {activeView === 'record' && rows.length > 0 && eventKinds.length > 0 && (
        <div className="panel">
          <AttendanceRecorder kinds={eventKinds} members={rows} now={now} />
        </div>
      )}
    </section>
  );
}
