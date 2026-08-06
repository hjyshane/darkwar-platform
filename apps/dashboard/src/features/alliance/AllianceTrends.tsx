import { useQuery } from '@tanstack/react-query';
import { LineChart } from '../../components/LineChart';
import { StatTile } from '../../components/StatTile';
import { type Point, type Series, thin } from '../../lib/series';
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
  officers: number;
}

interface PeriodPoint {
  period_start: string;
  activity_score: number | null;
  tier: string | null;
}

interface BoardPoint {
  captured_at: string;
  power: number | null;
  rank: number | null;
  member_count: number | null;
}

async function fetchTrends(allianceId: string) {
  const [board, roster, periods] = await Promise.all([
    supabase
      .from('alliance_power_history')
      .select('captured_at, power, rank, member_count')
      .eq('alliance_id', allianceId)
      .order('captured_at', { ascending: true })
      .limit(500),
    supabase
      .from('alliance_roster_history')
      .select(
        'captured_at, observed_members, expected_members, snapshot_complete, total_power, avg_power, median_power, avg_hq_level, members_at_hq35, officers',
      )
      .eq('alliance_id', allianceId)
      .order('captured_at', { ascending: true })
      .limit(2000),
    // The scored fortnights. `rank_period_latest`, not the table: 0071 keeps
    // every scoring version, so the table holds a member twice per period as
    // soon as one is rebuilt and every average here would be a blend of two
    // formulas.
    supabase
      .from('rank_period_latest')
      .select('period_start, activity_score, tier')
      .order('period_start', { ascending: true })
      .limit(5000),
  ]);
  if (board.error) {
    throw new Error(`board history failed: ${board.error.message}`);
  }
  if (roster.error) {
    throw new Error(`roster history failed: ${roster.error.message}`);
  }
  if (periods.error) {
    throw new Error(`rank period query failed: ${periods.error.message}`);
  }
  return {
    board: (board.data ?? []) as BoardPoint[],
    roster: (roster.data ?? []) as RosterPoint[],
    periods: (periods.data ?? []) as PeriodPoint[],
  };
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 });
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

export function AllianceTrends({ allianceId, isOwn }: { allianceId: string; isOwn: boolean }) {
  const { data, error, isPending } = useQuery({
    queryKey: ['alliance-trends', allianceId],
    queryFn: () => fetchTrends(allianceId),
  });

  if (isPending) {
    return <p className="empty">Loading…</p>;
  }
  if (error) {
    return <p className="error">Could not load the trends: {error.message}</p>;
  }

  const board = data?.board ?? [];
  const all = data?.roster ?? [];
  const usable = all.filter((row) => row.snapshot_complete);
  const dropped = all.length - usable.length;
  const latest = usable[usable.length - 1] ?? null;
  const first = usable[0] ?? null;

  // Fortnight averages of the activity score, over the members who were graded.
  // Ungraded rows are excluded rather than counted as zero: since 0072 an
  // officer is measured but not ranked and a fortnight-old member is not
  // measured at all, and folding either into the mean makes the alliance look
  // like it slowed down when a member joined.
  const byPeriod = new Map<string, number[]>();
  for (const row of data?.periods ?? []) {
    if (row.activity_score === null || row.tier === null) {
      continue;
    }
    const bucket = byPeriod.get(row.period_start) ?? [];
    bucket.push(row.activity_score);
    byPeriod.set(row.period_start, bucket);
  }
  const activity: Series = {
    name: 'Mean activity score',
    slot: 4,
    points: [...byPeriod.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([period, scores]) => ({
        t: Date.parse(period),
        v: scores.reduce((sum, score) => sum + score, 0) / scores.length,
      })),
  };

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

  return (
    <>
      {/* The ranking board, which every alliance has. Rank on its own chart
          rather than beside power: it is a small integer against a figure in the
          billions, and one axis cannot show both — the rank line would sit flat
          on the floor. */}
      <h3>On the ranking board</h3>
      {board.length === 0 ? (
        <p className="empty">
          This alliance has never appeared in a captured ranking board, so there is nothing to plot.
        </p>
      ) : board.length === 1 ? (
        <p className="empty">
          One sighting, on {day(Date.parse(board[0]?.captured_at ?? ''))}. A second is what makes a
          trend — the boards are captured when somebody opens them, not on a schedule.
        </p>
      ) : (
        <>
          <LineChart
            formatTime={moment}
            formatValue={bigValue}
            label="Alliance power as the ranking board reported it"
            note="Captured when somebody opens the board, so the gaps are ours and not theirs."
            series={[column(board, (row) => row.power, 'Power', 0)]}
          />
          <LineChart
            formatTime={moment}
            formatValue={wholeValue}
            label="Board rank and member count over time"
            note="Rank falls as an alliance climbs, so a line going DOWN here is them doing better."
            series={[
              column(board, (row) => row.rank, 'Rank', 1),
              column(board, (row) => row.member_count, 'Members', 5),
            ]}
          />
        </>
      )}

      {/* Everything below needs the member list opened, which we can only do for
          our own alliance. Saying so beats an empty section that reads as a
          collector that has not run. */}
      {usable.length === 0 || latest === null || first === null ? (
        <p className="empty">
          Per-member figures — power spread, tower levels, activity — need the alliance's own member
          list, which can only be opened from inside it.{' '}
          {all.length > 0 &&
            `${all.length} capture${all.length === 1 ? '' : 's'} of this roster exist but every one was cut short, and a mean over the top of a list the game sorts by power is not a mean over the alliance.`}
        </p>
      ) : (
        <>
          <div className="stats">
            <StatTile
              hero
              label="Total power"
              note={`over ${usable.length} complete capture${usable.length === 1 ? '' : 's'}`}
              value={latest.total_power === null ? null : bigValue(latest.total_power)}
            />
            <StatTile
              label="Since the first capture"
              note={`since ${day(Date.parse(first.captured_at))}`}
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
              label="Mean tower level"
              note={
                hqChange === null
                  ? undefined
                  : `${hqChange > 0 ? '+' : ''}${hqChange.toFixed(2)} since the first capture`
              }
              value={latest.avg_hq_level === null ? null : levelValue(latest.avg_hq_level)}
            />
            <StatTile
              label="At tower 35"
              note={`of ${latest.observed_members} seen`}
              value={plain.format(latest.members_at_hq35)}
            />
          </div>

          {dropped > 0 && (
            // Said, not hidden. A reader who knows the collector ran 180 times
            // and counts 140 points will otherwise assume something is broken.
            <p className="subtle">
              {dropped} capture{dropped === 1 ? '' : 's'} left out of the charts below: each saw
              fewer members than the game reports, so it was cut short rather than finished.
              Averaging one beside a whole batch would put a step in the line that nothing in the
              alliance caused.
            </p>
          )}

          <h3>Power, member by member</h3>
          <LineChart
            formatTime={moment}
            formatValue={bigValue}
            label="Alliance power over time: total, mean per member, and median per member"
            note="Total moves with the roster size; the median moves only when members actually grow."
            series={[
              column(usable, (row) => row.total_power, 'Total', 0),
              column(usable, (row) => row.avg_power, 'Mean', 1),
              column(usable, (row) => row.median_power, 'Median', 2),
            ]}
          />

          <h3>Tower levels</h3>
          <LineChart
            formatTime={moment}
            formatValue={levelValue}
            label="Mean tower level and how many members have reached level 35"
            note="The mean drifts; the count at the cap moves in steps, one member at a time."
            series={[
              column(usable, (row) => row.avg_hq_level, 'Mean level', 2),
              column(usable, (row) => row.members_at_hq35, 'At level 35', 3),
            ]}
          />

          <h3>Roster size</h3>
          <LineChart
            formatTime={moment}
            formatValue={wholeValue}
            label="Members observed in each complete roster capture, against the count the game reports"
            note="A drop here is a departure, because only complete captures are plotted."
            series={[
              column(usable, (row) => row.observed_members, 'Observed', 0),
              column(usable, (row) => row.expected_members, 'Game reports', 5),
              column(usable, (row) => row.officers, 'R4 and above', 3),
            ]}
          />
        </>
      )}

      {/* Ours only, and not because of a permission. `rank_period_snapshots` is
          scored from contribution and duel boards, which exist for our members
          and nobody else — the rows come back unfiltered by alliance, so drawing
          them on a stranger's page would put OUR activity under THEIR name. */}
      {isOwn && (
        <>
          <h3>Activity</h3>
          {activity.points.length === 0 ? (
            <p className="empty">
              No fortnight has been scored yet. The rank report builds a period; until one exists
              there is no activity score to average.
            </p>
          ) : activity.points.length === 1 ? (
            // One point is not a trend, and drawing it as a flat line implies we
            // measured something staying still.
            <p className="empty">
              One scored fortnight so far, averaging{' '}
              <strong>{(activity.points[0]?.v ?? 0).toFixed(1)}</strong> across the graded members.
              A second period is what makes this a trend.
            </p>
          ) : (
            <LineChart
              formatTime={day}
              formatValue={levelValue}
              label="Mean activity score per rank period, across graded members"
              note="Graded members only: an officer is measured but not ranked, and a member who joined inside the fortnight is not measured at all."
              series={[activity]}
            />
          )}
        </>
      )}
    </>
  );
}
