import { useQuery } from '@tanstack/react-query';
import { LineChart } from '../../components/LineChart';
import { type Series, forwardFill } from '../../lib/series';
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
  /** WHICH BOARD, and it decides what `rank` even means (0084).
   *
   * `server.rank` ranks by power and `kill.rank` ranks by kills. Both write to the
   * same column, so plotted together our own R4 alternated between 32 and 104 one
   * reading apart — two true numbers about two different things. */
  source_command: string;
  /** How many entries that board held. A rank without it says nothing. */
  board_size: number | null;
}

async function fetchTrend(playerId: string): Promise<TrendRow[]> {
  const { data, error } = await supabase
    .from('player_power_history')
    .select('captured_at, power, hq_level, kills, rank, source_command, board_size')
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

/** One numeric column, taken only from the readings that CARRY it.
 *
 * Mapping over every row and letting the misses be null shredded both lines: a
 * `server.rank` reading has no kills and a `kill.rank` reading has no power, they
 * arrive a minute apart, so every second point was a gap and `linePath` broke the
 * line at each one. A board that did not report kills is not a player with no
 * kills — it is a reading about something else.
 */
function carried(
  rows: readonly TrendRow[],
  pick: (row: TrendRow) => number | null,
  name: string,
  slot: number,
  axis: 'left' | 'right' = 'left',
): Series {
  return {
    name,
    slot,
    axis,
    points: rows
      .filter((row) => pick(row) !== null)
      .map((row) => ({ t: Date.parse(row.captured_at), v: pick(row) })),
  };
}

/** One board's rank line, labelled with what that board held.
 *
 * Null when this player has never appeared on it — an empty legend entry for a
 * board they are not on reads as a query that failed.
 */
function rankSeries(
  rows: readonly TrendRow[],
  command: string,
  name: string,
  slot: number,
): Series | null {
  const mine = rows.filter((row) => row.source_command === command && row.rank !== null);
  if (mine.length === 0) {
    return null;
  }
  // From the newest reading of that board. Boards do change size.
  const size = [...mine].reverse().find((row) => row.board_size !== null)?.board_size ?? null;
  return {
    ...carried(mine, (row) => row.rank, size === null ? name : `${name} (of ${size})`, slot),
    invert: true,
  };
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
  const powerRank = rankSeries(rows, 'server.rank', 'Power rank', 3);
  const killRank = rankSeries(rows, 'kill.rank', 'Kill rank', 4);

  return (
    <>
      <p className="subtle">
        {rows.length} sightings over {span.toFixed(1)} days.
      </p>

      {/* Separate axes. A player's power runs to the hundreds of millions and
          their kill count to the thousands — a hundred-thousandfold gap, so on
          one scale the kill line is indistinguishable from the axis itself.

          EACH LINE FROM THE READINGS THAT CARRY IT. These used to map over every
          row, so the power line broke at every kill-board reading and the kill line
          broke at every power-board one — they arrive a minute apart, so both were
          drawn as a row of disconnected stubs. */}
      <LineChart
        formatRight={wholeValue}
        formatTime={moment}
        formatValue={bigValue}
        label="Power on the left, kills on the right, as the ranking boards reported them"
        note="Gaps are captures we do not have. For somebody outside our alliance a reading happens when a board is opened. Kills are the dashed line."
        series={[
          carried(rows, (row) => row.power, 'Power', 0),
          carried(rows, (row) => row.kills, 'Kills', 1, 'right'),
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
          label="Tower level over time"
          note="Levels never fall, so a capture missing the figure holds the last one."
          series={[
            // Forward-filled: a tower is never demolished, so a board that did not
            // carry the level is our gap and not their loss. Rank gets no such
            // treatment below — a rank genuinely falls.
            {
              ...carried(rows, (row) => row.hq_level, 'Tower level', 2),
              points: forwardFill(
                rows.map((row, index) => ({ t: times[index] ?? 0, v: row.hq_level })),
              ),
            },
          ]}
        />
      )}

      {/* RANK ON ITS OWN CHART, ONE LINE PER BOARD (0084).
          This was a single "Board rank" line sharing an axis with the tower level,
          and it was two different quantities drawn as one: `server.rank` ranks by
          POWER and `kill.rank` ranks by KILLS, both write to the same column, and
          they are captured a minute apart. Our own R4 appeared to swing between
          32nd and 104th every minute while nothing about them changed.

          One axis each, because the boards are the same size today but measure
          unrelated things — sharing a scale invites reading one against the other. */}
      <h4>On the ranking boards</h4>
      {powerRank === null && killRank === null ? (
        <p className="empty">
          No ranking board has placed this player yet. Their power and kills above came from a
          roster capture or their profile being opened, neither of which carries a rank.
        </p>
      ) : (
        <LineChart
          formatRight={wholeValue}
          formatTime={moment}
          formatValue={wholeValue}
          height={180}
          label="Board rank over time, one line per board"
          note="Both axes are inverted, so climbing is a line going UP. These are two different boards — one ranks power, the other kills — and both cover every server the game puts on them (577 to 588), not server 580 alone. A rank here is not a position within our own server."
          series={[
            ...(powerRank === null ? [] : [powerRank]),
            ...(killRank === null ? [] : [{ ...killRank, axis: 'right' as const }]),
          ]}
        />
      )}
    </>
  );
}
