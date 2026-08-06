import { useQuery } from '@tanstack/react-query';
import { LineChart } from '../../components/LineChart';
import type { Series } from '../../lib/series';
import { supabase } from '../../lib/supabase';

/** Hero and pet power over time, and where those put the player on each board.
 *
 * Four boards are captured per player and the page only showed their newest
 * reading as a tile. A tile answers "how strong now"; it cannot answer "are they
 * still building" — and for a hero roster that is the more useful question,
 * because hero power moves in STEPS when a shard threshold is crossed and a step
 * is invisible in a single figure.
 *
 * TWO CHARTS, AND THE SPLIT IS BY MAGNITUDE RATHER THAN BY FAMILY.
 *
 * The obvious arrangement is one chart for heroes and one for pets. It reads worse:
 * within heroes the total is ten times the best (74M against 7.5M), so the best
 * line lies along the floor of its own chart. Totals against totals and bests
 * against bests are the comparable pairs — 74M/9.9M on one axis, 7.5M/3.2M on the
 * other — and putting each pair on its own axis is what makes all four legible at
 * once.
 *
 * The ranks then get a chart to themselves. They are small integers where the
 * powers are millions, so they were never going to share.
 */
interface ComponentRow {
  captured_at: string;
  metric: string;
  power: number | null;
  rank: number | null;
  unit_name: string | null;
  unit_grade: number | null;
  board_size: number | null;
}

const METRICS = {
  heroTotal: 'hero_power_total',
  heroBest: 'hero_power_best',
  petTotal: 'pet_power_total',
  petBest: 'pet_power_best',
} as const;

async function fetchComponents(playerId: string): Promise<ComponentRow[]> {
  const { data, error } = await supabase
    .from('player_component_power_history')
    .select('captured_at, metric, power, rank, unit_name, unit_grade, board_size')
    .eq('player_id', playerId)
    .order('captured_at', { ascending: true })
    .limit(2000);
  if (error) {
    throw new Error(`component power query failed: ${error.message}`);
  }
  return (data ?? []) as ComponentRow[];
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

/** The readings for one board, oldest first. */
function forMetric(rows: readonly ComponentRow[], metric: string): ComponentRow[] {
  return rows.filter((row) => row.metric === metric);
}

/** One board's power line, or null when that board has never listed this player.
 *
 * Null rather than an empty series: a legend entry for a board somebody is not on
 * reads as a query that failed.
 */
function powerLine(
  rows: readonly ComponentRow[],
  metric: string,
  name: string,
  slot: number,
  axis: 'left' | 'right',
): Series | null {
  const mine = forMetric(rows, metric).filter((row) => row.power !== null);
  if (mine.length === 0) {
    return null;
  }
  return {
    name,
    slot,
    axis,
    points: mine.map((row) => ({ t: Date.parse(row.captured_at), v: row.power })),
  };
}

/** One board's rank line.
 *
 * The board SIZE is deliberately not in the name here, unlike the single-rank
 * charts elsewhere. Four lines each carrying "(of 150)" is a 130-character axis
 * label in a 720-unit viewBox — it overflows the plot, and it repeats one fact
 * four times. `boardSizeNote` says it once instead.
 */
function rankLine(
  rows: readonly ComponentRow[],
  metric: string,
  name: string,
  slot: number,
): Series | null {
  const mine = forMetric(rows, metric).filter((row) => row.rank !== null);
  if (mine.length === 0) {
    return null;
  }
  return {
    name,
    slot,
    invert: true,
    points: mine.map((row) => ({ t: Date.parse(row.captured_at), v: row.rank })),
  };
}

/** How big the four boards are, said once.
 *
 * They are the same size today, so one sentence covers all four. If they ever
 * diverge this says so rather than picking one and being wrong about the others —
 * a rank without its denominator is the thing 0084 and 0081 both exist to fix.
 */
function boardSizeNote(rows: readonly ComponentRow[]): string {
  const sizes = [
    ...new Set(
      rows
        .filter((row) => row.rank !== null && row.board_size !== null)
        .map((row) => row.board_size as number),
    ),
  ].sort((a, b) => a - b);
  if (sizes.length === 0) {
    return '';
  }
  if (sizes.length === 1) {
    return ` Each board held ${sizes[0]} players when it was last read.`;
  }
  return ` The boards differ in size — ${sizes.join(', ')} entries — so a rank on one is not comparable with a rank on another.`;
}

/** Which hero or pet their best is, from the newest reading that named one. */
function bestUnit(rows: readonly ComponentRow[], metric: string): ComponentRow | null {
  return [...forMetric(rows, metric)].reverse().find((row) => row.unit_name !== null) ?? null;
}

export function ComponentTrend({ playerId }: { playerId: string }) {
  const { data, error, isPending } = useQuery({
    queryKey: ['component-trend', playerId],
    queryFn: () => fetchComponents(playerId),
  });

  if (isPending) {
    return <p className="empty">Loading…</p>;
  }
  if (error) {
    return <p className="error">Could not load the hero and pet history: {error.message}</p>;
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    return (
      <p className="empty">
        No hero or pet board has listed this player. Those four boards are captured together, so
        either all of them have them or none does.
      </p>
    );
  }

  const powers = [
    powerLine(rows, METRICS.heroTotal, 'Hero power', 0, 'left'),
    powerLine(rows, METRICS.petTotal, 'Pet power', 1, 'left'),
    powerLine(rows, METRICS.heroBest, 'Best hero', 2, 'right'),
    powerLine(rows, METRICS.petBest, 'Best pet', 3, 'right'),
  ].filter((line): line is Series => line !== null);

  const ranks = [
    rankLine(rows, METRICS.heroTotal, 'Hero', 0),
    rankLine(rows, METRICS.petTotal, 'Pet', 1),
    rankLine(rows, METRICS.heroBest, 'Best hero', 2),
    rankLine(rows, METRICS.petBest, 'Best pet', 3),
  ].filter((line): line is Series => line !== null);

  const hero = bestUnit(rows, METRICS.heroBest);
  const pet = bestUnit(rows, METRICS.petBest);

  return (
    <>
      {/* Who their best actually is. The board carries the unit id and the
          catalogue carries the name and grade, so this costs nothing extra — and
          "Best hero 7.5M" without a name is a figure nobody can act on. */}
      {(hero !== null || pet !== null) && (
        <p className="subtle">
          {hero !== null && (
            <>
              Best hero: <strong>{hero.unit_name}</strong>
              {hero.unit_grade !== null && ` (grade ${hero.unit_grade})`}
            </>
          )}
          {hero !== null && pet !== null && ' · '}
          {pet !== null && (
            <>
              Best pet: <strong>{pet.unit_name}</strong>
              {/* No grade for a pet: the catalogue has no such column yet. Saying
                  nothing beats printing a number nobody assigned. */}
            </>
          )}
        </p>
      )}

      {powers.length === 0 ? (
        <p className="empty">These boards listed the player but carried no power figure.</p>
      ) : (
        <LineChart
          formatRight={bigValue}
          formatTime={moment}
          formatValue={bigValue}
          label="Hero and pet power over time: totals on the left, their single strongest on the right"
          note="Totals share the left axis and the two 'best' figures share the right, because a total is about ten times its own best — on one scale the best lines would lie along the floor. Steps rather than slopes are normal here: hero power moves when a threshold is crossed."
          series={powers}
        />
      )}

      {ranks.length > 0 && (
        <LineChart
          formatTime={moment}
          formatValue={wholeValue}
          height={180}
          label="Rank on each of the four hero and pet boards, inverted so climbing is up"
          note={`The axis is inverted — a line going UP is them climbing.${boardSizeNote(rows)} All four boards cover every server the game puts on them, not server 580 alone.`}
          series={ranks}
        />
      )}
    </>
  );
}
