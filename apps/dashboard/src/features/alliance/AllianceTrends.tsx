import { useQuery } from '@tanstack/react-query';
import { LineChart } from '../../components/LineChart';
import { StatTile } from '../../components/StatTile';
import { Sparkline } from '../../components/ui/Sparkline';
import {
  DEFAULT_TRENDS,
  baselineOf,
  membersAtLevel,
  useAllianceTrendsSetting,
} from '../../lib/allianceTrendsSetting';
import { compactNumber } from '../../lib/compactNumber';
import { type Translate, useT } from '../../lib/i18n';
import { type Point, type Series, forwardFill, thin } from '../../lib/series';
import { supabase } from '../../lib/supabase';

/** One alliance over time.
 *
 * TWO SOURCES, because two very different things are being asked, and which one
 * you get depends on whether we can open the alliance's member list:
 *
 *   `alliance_power_history`  every alliance · a dozen readings · power, rank, size
 *   `alliance_roster_history` ours only · 26 captures · aggregates per member
 *
 * The first is the ranking board, captured whenever somebody opens it, and it is
 * the only history there is for the 161 alliances that are not ours. The second
 * is one row per roster capture rather than one per member per capture — 26 rows
 * instead of 2,433 for the same nine-day picture.
 *
 * THE ONE THING THIS SCREEN MUST NOT DO is average a half-scrolled capture
 * beside a whole one. A roster read that stopped early is short, and a mean over
 * a short batch is a mean over whoever was at the TOP of the list — which, for a
 * list the game sorts by power, means the strong ones. Plotted raw it puts a
 * step in the line that nothing in the alliance caused. 0067 flags those batches;
 * this drops them and says how many it dropped.
 */
interface RosterPoint {
  captured_at: string;
  observed_members: number;
  expected_members: number | null;
  snapshot_complete: boolean;
  total_power: number | null;
  avg_power: number | null;
  median_power: number | null;
  avg_hq_level: number | null;
  members_at_hq35: number;
  /** Every known tower level in the capture (0342), which is what lets the
   * counted level be a setting. Absent from a database that has not had that
   * migration yet. */
  hq_levels?: number[] | null;
  officers: number;
}

/** One game day's board total for one kind of contribution.
 *
 * Replaced a mean activity SCORE, which was the wrong figure for this chart: a
 * score is a percentile blend, so it moves when the pool changes — a member
 * joining shifts everybody's — and an officer looking at a trend wants what the
 * game itself reports. Donated today, duel points today. */
interface DailyPoint {
  game_day: string;
  kind: string;
  total: number | null;
  members_counted: number;
  readings: number;
}

interface BoardPoint {
  captured_at: string;
  /** The alliance's own server, for naming the server board it appears on. */
  server_id: number | null;
  power: number | null;
  rank: number | null;
  member_count: number | null;
  /** Which board this reading came from (0081). Two boards report the same
   * alliance at different ranks minutes apart under one command name, so plotting
   * them as one series drew a sawtooth and called it movement. */
  board_scope: string;
  /** How many alliances were on that board. A rank without it says nothing —
   * 7th of 100 is not worse than 1st of 39. */
  board_size: number | null;
}

const ROSTER_COLUMNS =
  'captured_at, observed_members, expected_members, snapshot_complete, total_power, avg_power, median_power, avg_hq_level, members_at_hq35, officers';

function rosterQuery(allianceId: string, columns: string) {
  return supabase
    .from('alliance_roster_history')
    .select(columns)
    .eq('alliance_id', allianceId)
    .order('captured_at', { ascending: false })
    .limit(1000);
}

/** The roster captures, with the tower levels where the database has them.
 *
 * Merging publishes the dashboard and `db push` is a separate step, so this
 * page can be live before `hq_levels` (0342) exists. Asking for a missing
 * column fails the whole request (42703), which would take every chart on the
 * tab with it; asking again without it costs one round trip for as long as the
 * migration is pending, and the count falls back to the level 35 the view has
 * always carried. */
async function fetchRoster(allianceId: string) {
  const full = await rosterQuery(allianceId, `${ROSTER_COLUMNS}, hq_levels`);
  if (full.error?.code !== '42703') {
    return full;
  }
  return rosterQuery(allianceId, ROSTER_COLUMNS);
}

async function fetchTrends(allianceId: string) {
  const [board, roster, daily] = await Promise.all([
    supabase
      .from('alliance_power_history')
      .select('captured_at, server_id, power, rank, member_count, board_scope, board_size')
      .eq('alliance_id', allianceId)
      // Newest first, then reversed: `asc + limit` keeps the OLDEST rows, so a
      // long history froze the chart's recent end in the past. 1000 is
      // PostgREST's own ceiling — a larger limit is silently ignored.
      .order('captured_at', { ascending: false })
      .limit(1000),
    fetchRoster(allianceId),
    // Daily totals from 0074, which does the three things that are easy to get
    // wrong — the 02:00 UTC day boundary, taking the day's LARGEST reading rather
    // than summing readings of an accumulating board, and restricting to our own
    // members on a board that carries 189 rows for an alliance of 94.
    supabase
      .from('alliance_daily_contribution')
      .select('game_day, kind, total, members_counted, readings')
      .eq('alliance_id', allianceId)
      .order('game_day', { ascending: false })
      .limit(1000),
  ]);
  if (board.error) {
    throw new Error(`board history failed: ${board.error.message}`);
  }
  if (roster.error) {
    throw new Error(`roster history failed: ${roster.error.message}`);
  }
  if (daily.error) {
    throw new Error(`daily contribution failed: ${daily.error.message}`);
  }
  return {
    board: ((board.data ?? []) as BoardPoint[]).reverse(),
    roster: ((roster.data ?? []) as unknown as RosterPoint[]).reverse(),
    daily: ((daily.data ?? []) as DailyPoint[]).reverse(),
  };
}

const compact = compactNumber(2);
const plain = new Intl.NumberFormat('ko-KR');

function bigValue(value: number): string {
  return compact.format(value);
}

function wholeValue(value: number): string {
  return plain.format(Math.round(value));
}

function levelValue(value: number): string {
  return value.toFixed(1);
}

function day(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

function moment(t: number): string {
  return `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')}Z`;
}

/** A series from one numeric column of any capture list. */
function column<Row extends { captured_at: string }>(
  rows: readonly Row[],
  pick: (row: Row) => number | null,
  name: string,
  slot: number,
): Series {
  const points: Point[] = rows.map((row) => ({
    t: Date.parse(row.captured_at),
    v: pick(row),
  }));
  // A cap rather than a policy: 26 captures need no thinning today, and the
  // collector adds a batch every few minutes — 700 pixels stops being able to
  // show them individually somewhere past a hundred. Every-nth rather than an
  // average, so each drawn point is still a capture that happened and the
  // readout is never a figure the game did not report.
  return { name, slot, points: thin(points, 120) };
}

/** The newest reading of a series, formatted, or null when there is none. */
function lastValue(line: Series, format: (value: number) => string): string | null {
  for (let index = line.points.length - 1; index >= 0; index -= 1) {
    const value = line.points[index]?.v;
    if (value !== null && value !== undefined) {
      return format(value);
    }
  }
  return null;
}

/** Which day the tile's figure is FOR. A daily total with no day on it invites
 * being read as a running total. */
function lastDayNote(line: Series): string | undefined {
  const point = [...line.points].reverse().find((entry) => entry.v !== null);
  return point === undefined ? undefined : day(point.t);
}

/** Hold the last reading across gaps. Only for a figure that cannot fall. */
function filled(line: Series): Series {
  return { ...line, points: forwardFill(line.points) };
}

/** Whether any reading came from that board. A line for a board this alliance has
 * never been seen on would be an empty legend entry. */
function hasScope(board: readonly BoardPoint[], scope: string): boolean {
  return board.some((row) => row.board_scope === scope && row.rank !== null);
}

/** How big that board was, from the newest reading of it. */
function sizeOf(board: readonly BoardPoint[], scope: string): number | null {
  for (let index = board.length - 1; index >= 0; index -= 1) {
    const row = board[index];
    if (row?.board_scope === scope && row.board_size !== null) {
      return row.board_size;
    }
  }
  return null;
}

/** The server board's name, which is the alliance's own server number. */
function serverLabel(board: readonly BoardPoint[], t: Translate): string {
  const server = board.find((row) => row.server_id !== null)?.server_id ?? null;
  const size = sizeOf(board, 'server');
  if (server === null) {
    return size === null ? t('Rank on own server') : t('Rank on own server (of {size})', { size });
  }
  return size === null
    ? t('Rank on server {server}', { server })
    : t('Rank on server {server} (of {size})', { server, size });
}

function crossLabel(board: readonly BoardPoint[], t: Translate): string {
  const size = sizeOf(board, 'cross_server');
  return size === null ? t('Cross-server rank') : t('Cross-server rank (of {size})', { size });
}

/** One rank line per board, each on its own axis.
 *
 * Separate axes because the boards are different sizes. Sharing one puts 1st of 39
 * and 7th of 100 within a few pixels of each other, and the shape of neither line
 * survives that — which was the point of splitting them in the first place.
 *
 * An alliance seen on ONE board gets the left axis, whichever board that is. The
 * right axis exists to keep two lines apart; with one line it would only move the
 * numbers to the far side of the chart.
 */
function rankSeries(board: readonly BoardPoint[], t: Translate): Series[] {
  const server = hasScope(board, 'server');
  const cross = hasScope(board, 'cross_server');
  const line = (scope: string, name: string, slot: number, axis: 'left' | 'right'): Series => ({
    ...column(
      board.filter((row) => row.board_scope === scope),
      (row) => row.rank,
      name,
      slot,
    ),
    axis,
    invert: true,
  });
  if (server && cross) {
    return [
      line('server', serverLabel(board, t), 1, 'left'),
      line('cross_server', crossLabel(board, t), 2, 'right'),
    ];
  }
  if (server) {
    return [line('server', serverLabel(board, t), 1, 'left')];
  }
  if (cross) {
    return [line('cross_server', crossLabel(board, t), 2, 'left')];
  }
  return [];
}

/** Said in the chart's note, because two rank lines that are both "rank" need a
 * sentence explaining why one is higher. */
function scopeNote(board: readonly BoardPoint[], t: Translate): string {
  const server = hasScope(board, 'server');
  const cross = hasScope(board, 'cross_server');
  if (server && cross) {
    return t(
      'One line per board, each on its own axis — left is this alliance among its own server, right is among every server the board covers. Different questions, and a good answer to one can look poor beside the other, which is why they do not share a scale.',
    );
  }
  if (cross) {
    return t(
      'Only the cross-server board has been captured for this alliance, so there is one line.',
    );
  }
  return t('Only their own server board has been captured, so there is one line.');
}

/** One kind of daily board as a series, keyed on the game day it belongs to. */
function dailySeries(
  rows: readonly DailyPoint[],
  kind: string,
  name: string,
  slot: number,
  axis: 'left' | 'right',
): Series {
  return {
    name,
    slot,
    axis,
    points: rows
      .filter((row) => row.kind === kind)
      .map((row) => ({ t: Date.parse(row.game_day), v: row.total })),
  };
}

/** Everything the Activity tab plots, in one column.
 *
 * The blocks were a tab each (user 2026-10-05), then folded together: power
 * and towers under Activity on 2026-11-19, the ranking board on 2026-11-20.
 * Ours reads top-down from what the members did to where it put the alliance;
 * anybody else's leads with the ranking board, the only block they have. */
export function AllianceTrends({ allianceId, isOwn }: { allianceId: string; isOwn: boolean }) {
  const t = useT();
  // The alliance on screen's choices (0342); the defaults while they load, so
  // the charts are not held back by a setting.
  const setting = useAllianceTrendsSetting().data ?? DEFAULT_TRENDS;
  const { data, error, isPending } = useQuery({
    queryKey: ['alliance-trends', allianceId],
    queryFn: () => fetchTrends(allianceId),
  });

  if (isPending) {
    return <p className="empty loading">{t('Loading…')}</p>;
  }
  if (error) {
    return (
      <p className="error">{t('Could not load the trends: {error}', { error: error.message })}</p>
    );
  }

  const board = data?.board ?? [];
  const all = data?.roster ?? [];
  const usable = all.filter((row) => row.snapshot_complete);
  const dropped = all.length - usable.length;
  const latest = usable[usable.length - 1] ?? null;
  // Where "since" starts: the first complete capture, or the first one on or
  // after the day the alliance chose. Null when that day is after every
  // capture, which is said rather than measured from somewhere else.
  const first = baselineOf(usable, setting.since);
  const sinceLabel = setting.since === null ? t('the first capture') : setting.since;
  // The level the alliance counts from. A database without `hq_levels` can
  // only answer for 35, so that is what is counted — and named — there.
  const towerLevel = usable.some((row) => membersAtLevel(row, setting.towerLevel) !== null)
    ? setting.towerLevel
    : DEFAULT_TRENDS.towerLevel;
  const atLevel = (row: RosterPoint): number | null => membersAtLevel(row, towerLevel);

  // One series per kind of daily board. Donation and duel go on separate axes:
  // a day's donation total is in the hundreds of thousands and a day's duel
  // total in the tens of millions, so sharing a scale flattens the donation line
  // onto the floor and it is the one an officer chases.
  const daily = data?.daily ?? [];
  const donation = dailySeries(daily, 'daily_donation', t('Donated'), 0, 'left');
  const duel = dailySeries(daily, 'alliance_battle_daily', t('Duel points'), 1, 'right');
  const dailyDays = new Set(daily.map((row) => row.game_day)).size;
  // A day read once, early, is a partial day and looks like a bad day. Worth
  // naming rather than letting the dip be read as the alliance slacking.
  const partialDays = new Set(daily.filter((row) => row.readings <= 1).map((row) => row.game_day))
    .size;

  const powerChange =
    first === null ||
    latest === null ||
    first.total_power === null ||
    latest.total_power === null ||
    first.total_power === 0
      ? null
      : ((latest.total_power - first.total_power) / first.total_power) * 100;
  const hqChange =
    first?.avg_hq_level == null || latest?.avg_hq_level == null
      ? null
      : latest.avg_hq_level - first.avg_hq_level;

  // The ranking board, which every alliance has. Rank on its own chart rather
  // than beside power: it is a small integer against a figure in the billions,
  // and one axis cannot show both — the rank line would sit flat on the floor.
  const ranking = (
    <>
      <h3>{t('On the ranking board')}</h3>
      {board.length === 0 ? (
        <p className="empty">
          {t(
            'This alliance has never appeared in a captured ranking board, so there is nothing to plot.',
          )}
        </p>
      ) : board.length === 1 ? (
        <p className="empty">
          {t(
            'One sighting, on {day}. A second is what makes a trend — the boards are captured when somebody opens them, not on a schedule.',
            { day: day(Date.parse(board[0]?.captured_at ?? '')) },
          )}
        </p>
      ) : (
        <>
          {/* Members ride along with power rather than with rank. They belong to
              either — the board reports both — but the rank chart has only two
              axes and both are now spoken for, and power-and-size is the more
              useful pairing anyway: it says whether the alliance grew because
              members grew or because members arrived. */}
          <LineChart
            formatRight={wholeValue}
            formatTime={moment}
            formatValue={bigValue}
            label={t('Alliance power and member count as the ranking board reported them')}
            note={t(
              'Captured when somebody opens the board, so the gaps are ours and not theirs. Members are the dashed line on the right — power rising while that line is flat is the members themselves growing.',
            )}
            series={[
              column(board, (row) => row.power, t('Power'), 0),
              { ...column(board, (row) => row.member_count, t('Members'), 5), axis: 'right' },
            ]}
          />
          {/* Rank drawn UPSIDE DOWN. Rank 6 beats rank 9, so an ordinary axis
              makes improvement point downwards and gets misread by everybody
              exactly once.

              ONE LINE PER BOARD (0081), AND ONE AXIS EACH. These were a single
              series, and since the routine opens the server board and the
              cross-server board about three minutes apart, the line sawtoothed
              between 1st and 7th with the power unchanged — two true answers to
              two different questions, drawn as one lie.

              Separate axes rather than a shared one because the two boards are
              different sizes: 1st of 39 against 7th of 100 on one scale puts both
              lines in the same inch of chart, where the shape of neither can be
              read. Each axis now spans its own board, so what you see is movement
              within that board — which is the only movement that means anything. */}
          <LineChart
            formatRight={wholeValue}
            formatTime={moment}
            formatValue={wholeValue}
            label={t('Board rank over time, one line per board')}
            note={t('The rank axis is inverted, so climbing is a line going UP. {scope}', {
              scope: scopeNote(board, t),
            })}
            series={rankSeries(board, t)}
          />
        </>
      )}
    </>
  );

  return (
    <>
      {!isOwn && ranking}

      {/* Ours only, and not because of a permission. `rank_period_snapshots` is
          scored from contribution and duel boards, which exist for our members
          and nobody else — the rows come back unfiltered by alliance, so drawing
          them on a stranger's page would put OUR activity under THEIR name. */}
      {isOwn && (
        <>
          <h3>{t('Activity')}</h3>
          {dailyDays === 0 ? (
            <p className="empty">
              {t(
                'No daily board has been captured for this alliance yet. Donation and duel totals come from the daily ranking screens, which have to be opened before 02:00 UTC clears them.',
              )}
            </p>
          ) : (
            <>
              <div className="stats">
                <StatTile
                  hero
                  label={t('Donated, latest day')}
                  spark={<Sparkline values={donation.points.map((point) => point.v)} />}
                  note={lastDayNote(donation)}
                  value={lastValue(donation, wholeValue)}
                />
                <StatTile
                  label={t('Duel points, latest day')}
                  spark={<Sparkline values={duel.points.map((point) => point.v)} />}
                  note={lastDayNote(duel)}
                  value={lastValue(duel, bigValue)}
                />
                <StatTile
                  label={t('Days captured')}
                  note={t('{count} read only once', { count: partialDays })}
                  value={plain.format(dailyDays)}
                />
              </div>

              {dailyDays === 1 ? (
                // One day is not a trend, and a flat line across one point claims
                // a measurement that held still.
                <p className="empty">
                  {t(
                    'One game day captured so far. A second is what makes this a trend — the daily boards reset at 02:00 UTC, so each one has to be read before then or it is gone.',
                  )}
                </p>
              ) : (
                <LineChart
                  formatRight={bigValue}
                  formatTime={day}
                  formatValue={wholeValue}
                  label={t('Alliance donation and duel points per game day')}
                  note={t(
                    'A game day runs 02:00 to 02:00 UTC, and each figure is the largest reading taken that day — the boards accumulate, so summing our captures would count the same points twice. Duel points are the dashed line, on the right.',
                  )}
                  series={[donation, duel]}
                />
              )}

              {partialDays > 0 && (
                <p className="subtle">
                  {t(
                    '{count} of these days was read only once. The boards accumulate through the day, so a single early reading is a part of that day rather than its total — a dip there is our capture, not the alliance.',
                    { count: partialDays },
                  )}
                </p>
              )}
            </>
          )}
        </>
      )}

      {/* Everything below needs the member list opened, which we can only do for
          our own alliance. Saying so beats an empty section that reads as a
          collector that has not run. */}
      <h3>{t('Power and towers')}</h3>
      {usable.length === 0 || latest === null ? (
        <p className="empty">
          {t(
            "Per-member figures — power spread, tower levels, activity — need the alliance's own member list, which can only be opened from inside it.",
          )}{' '}
          {all.length > 0 &&
            (all.length === 1
              ? t(
                  '{count} capture of this roster exist but every one was cut short, and a mean over the top of a list the game sorts by power is not a mean over the alliance.',
                  { count: all.length },
                )
              : t(
                  '{count} captures of this roster exist but every one was cut short, and a mean over the top of a list the game sorts by power is not a mean over the alliance.',
                  { count: all.length },
                ))}
        </p>
      ) : (
        <>
          <div className="stats">
            <StatTile
              hero
              label={t('Total power')}
              spark={<Sparkline values={usable.map((row) => row.total_power)} />}
              note={
                usable.length === 1
                  ? t('over {count} complete capture', { count: usable.length })
                  : t('over {count} complete captures', { count: usable.length })
              }
              value={latest.total_power === null ? null : bigValue(latest.total_power)}
            />
            <StatTile
              label={t('Since {when}', { when: sinceLabel })}
              note={
                first === null
                  ? t('no complete capture on or after {when}', { when: sinceLabel })
                  : t('measured from {day}', { day: day(Date.parse(first.captured_at)) })
              }
              tone={
                powerChange === null
                  ? undefined
                  : powerChange > 0
                    ? 'up'
                    : powerChange < 0
                      ? 'down'
                      : 'flat'
              }
              value={
                powerChange === null
                  ? null
                  : `${powerChange > 0 ? '+' : ''}${powerChange.toFixed(1)}%`
              }
            />
            <StatTile
              label={t('Mean tower level')}
              spark={<Sparkline values={usable.map((row) => row.avg_hq_level)} />}
              note={
                hqChange === null
                  ? undefined
                  : t('{change} since {when}', {
                      change: `${hqChange > 0 ? '+' : ''}${hqChange.toFixed(2)}`,
                      when: sinceLabel,
                    })
              }
              value={latest.avg_hq_level === null ? null : levelValue(latest.avg_hq_level)}
            />
            {/* "Tower 35 or higher", not "At tower 35": the figure counts
                hq_level >= the level, and the old wording read as exactly that
                level — which would make it fall as people levelled past it.
                The level itself is the alliance's setting (0342). */}
            <StatTile
              label={t('Tower {level} or higher', { level: towerLevel })}
              spark={<Sparkline values={usable.map(atLevel)} />}
              note={t('of {count} members seen', { count: latest.observed_members })}
              value={plain.format(atLevel(latest) ?? 0)}
            />
          </div>

          {dropped > 0 && (
            // Said, not hidden. A reader who knows the collector ran 180 times
            // and counts 140 points will otherwise assume something is broken.
            <p className="subtle">
              {dropped === 1
                ? t(
                    '{count} capture left out of the charts below: each saw fewer members than the game reports, so it was cut short rather than finished. Averaging one beside a whole batch would put a step in the line that nothing in the alliance caused.',
                    { count: dropped },
                  )
                : t(
                    '{count} captures left out of the charts below: each saw fewer members than the game reports, so it was cut short rather than finished. Averaging one beside a whole batch would put a step in the line that nothing in the alliance caused.',
                    { count: dropped },
                  )}
            </p>
          )}

          <div className="chart-cell">
            <h3>{t('Power, member by member')}</h3>
            {/* Total on the left, per-member on the right. 17 billion against 180
              million is a hundredfold gap: on one axis the mean and the median
              lie on top of each other along the floor, and those two are the
              interesting pair — the total moves when somebody joins, the median
              only when members actually grow. */}
            <LineChart
              formatRight={bigValue}
              formatTime={moment}
              formatValue={bigValue}
              label={t(
                'Alliance power over time: total on the left, mean and median per member on the right',
              )}
              note={t(
                'The total moves with the roster size. The dashed pair is per member, on its own scale — that is where growth shows.',
              )}
              series={[
                column(usable, (row) => row.total_power, t('Total'), 0),
                { ...column(usable, (row) => row.avg_power, t('Mean'), 1), axis: 'right' },
                { ...column(usable, (row) => row.median_power, t('Median'), 2), axis: 'right' },
              ]}
            />
          </div>

          <div className="chart-cell">
            <h3>{t('Tower levels')}</h3>
            {/* Forward-filled, and only these two series are. A tower is never
              demolished, so a capture that did not carry the level is a gap in
              our reading rather than a fall — holding the last value is closer to
              the truth than breaking the line. Power and rank get no such
              treatment: both can genuinely drop. */}
            <LineChart
              formatRight={wholeValue}
              formatTime={moment}
              formatValue={levelValue}
              label={t('Mean tower level and how many members have reached level {level}', {
                level: towerLevel,
              })}
              note={t(
                'Levels never fall, so a capture missing the figure holds the last one. The dashed line counts members whose tower is level {level} or higher, on the right.',
                { level: towerLevel },
              )}
              series={[
                filled(column(usable, (row) => row.avg_hq_level, t('Mean level'), 2)),
                {
                  ...filled(column(usable, atLevel, t('Tower {level}+', { level: towerLevel }), 3)),
                  axis: 'right',
                },
              ]}
            />
          </div>
        </>
      )}

      {isOwn && ranking}
    </>
  );
}
