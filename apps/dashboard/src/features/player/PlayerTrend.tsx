import { useQuery } from '@tanstack/react-query';
import { LineChart } from '../../components/LineChart';
import { supabase } from '../../lib/supabase';

/** One player's readings over time — for ANY player, not only our members.
 *
 * The tiles above this give deltas: against a fixed baseline (0049) or against
 * the previous reading (0069). Neither gives the shape, and shape is exactly what
 * an outsider's figures need. They are captured when somebody opens a ranking
 * board, so their series is a handful of irregular points, and "+12%" over an
 * unstated interval cannot distinguish steady growth from one jump.
 *
 * `player_power_history` (0073) over `player_snapshots`, which carries
 * `public_read` and covers every player a board has ever listed. Our own members
 * have the roster history screen for this and more; this is the one that works
 * for the other 279.
 *
 * Two charts, not one. Power runs to the hundreds of millions and a tower level
 * to 35 — on a shared axis the level line lies flat on the floor and tells you
 * nothing, which is the whole reason the tower level was asked for.
 */
interface TrendRow {
  captured_at: string;
  power: number | null;
  hq_level: number | null;
  kills: number | null;
  rank: number | null;
}

async function fetchTrend(playerId: string): Promise<TrendRow[]> {
  const { data, error } = await supabase
    .from('player_power_history')
    .select('captured_at, power, hq_level, kills, rank')
    .eq('player_id', playerId)
    .order('captured_at', { ascending: true })
    .limit(500);
  if (error) {
    throw new Error(`history query failed: ${error.message}`);
  }
  return (data ?? []) as TrendRow[];
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 });
const plain = new Intl.NumberFormat('ko-KR');

function bigValue(value: number): string {
  return compact.format(value);
}

function wholeValue(value: number): string {
  return plain.format(Math.round(value));
}

function moment(t: number): string {
  return `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')}Z`;
}

export function PlayerTrend({ playerId }: { playerId: string }) {
  const { data, error, isPending } = useQuery({
    queryKey: ['player-trend', playerId],
    queryFn: () => fetchTrend(playerId),
  });

  if (isPending) {
    return <p className="empty">Loading…</p>;
  }
  if (error) {
    return <p className="error">Could not load the history: {error.message}</p>;
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    return (
      <p className="empty">
        No ranking board has ever listed this player, so there is nothing to plot. Their figures
        above came from somewhere else — a roster capture, or their profile being opened.
      </p>
    );
  }
  if (rows.length === 1) {
    // A single point drawn as a line implies a measurement that held still.
    return (
      <p className="empty">
        One sighting so far, on {moment(Date.parse(rows[0]?.captured_at ?? ''))}. A second reading
        is what turns this into a trend — for somebody outside our alliance that happens when a
        board is captured, not on a schedule.
      </p>
    );
  }

  const times = rows.map((row) => Date.parse(row.captured_at));
  const span = ((times[times.length - 1] ?? 0) - (times[0] ?? 0)) / 86_400_000;
  const levels = rows.filter((row) => row.hq_level !== null);

  return (
    <>
      <p className="subtle">
        {rows.length} sightings over {span.toFixed(1)} days.
      </p>

      <LineChart
        formatTime={moment}
        formatValue={bigValue}
        label="Power and kills as the ranking boards reported them"
        note="Gaps are captures we do not have. For somebody outside our alliance a reading happens when a board is opened."
        series={[
          {
            name: 'Power',
            slot: 0,
            points: rows.map((row, index) => ({ t: times[index] ?? 0, v: row.power })),
          },
          {
            name: 'Kills',
            slot: 1,
            points: rows.map((row, index) => ({ t: times[index] ?? 0, v: row.kills })),
          },
        ]}
      />

      {/* Only when a board actually carried it. About a quarter of the readings
          do not, and an empty chart under a heading reads as a broken query
          rather than a field the board did not include. */}
      {levels.length < 2 ? (
        <p className="empty">
          Tower level was recorded {levels.length === 0 ? 'in none' : 'in only one'} of these
          sightings — not every board carries it.
        </p>
      ) : (
        <LineChart
          formatTime={moment}
          formatValue={wholeValue}
          height={160}
          label="Tower level and board rank over time"
          note="Rank falls as a player climbs, so a line going DOWN here is them doing better."
          series={[
            {
              name: 'Tower level',
              slot: 2,
              points: rows.map((row, index) => ({ t: times[index] ?? 0, v: row.hq_level })),
            },
            {
              name: 'Board rank',
              slot: 3,
              points: rows.map((row, index) => ({ t: times[index] ?? 0, v: row.rank })),
            },
          ]}
        />
      )}
    </>
  );
}
