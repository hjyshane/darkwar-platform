import { useQuery } from '@tanstack/react-query';
import { LineChart } from '../../components/LineChart';
import { type Series, assignAxes } from '../../lib/series';
import { supabase } from '../../lib/supabase';

/** Hero, pet and account figures over time, and where those put the player.
 *
 * DRIVEN BY THE REGISTRY (0086), NOT BY A LIST IN THIS FILE. The metrics, their
 * labels, which chart they belong on and which axis they take all arrive with the
 * rows. So a figure the game starts reporting reaches this screen with no change
 * here: insert a `component_metrics` row, promote the field in the parser, and the
 * line appears with its label.
 *
 * That was the point of the change. The four board metrics used to be hardcoded
 * twice — once as a CHECK constraint in SQL and once as a map in this component —
 * so every new figure meant editing both.
 *
 * ADMIN-ONLY METRICS ARE ABSENT RATHER THAN HIDDEN. Migration power carries
 * `visibility = 'admin'` and the view drops it for everybody else, so a member's
 * query never contains it. There is deliberately no role check in this file: if
 * there were, the figure would be arriving in the browser and being hidden, which
 * is not the same thing.
 *
 * A tile answers "how strong now"; this answers "are they still building" — and for
 * a hero roster that is the more useful question, because hero power moves in STEPS
 * when a threshold is crossed and a step is invisible in a single figure.
 */
interface ComponentRow {
  captured_at: string;
  metric: string;
  /** From the registry, not derived from the key. "hero_power_best" is a column
   * name; "Strongest hero" is a label, and one must not be produced from the other
   * by replacing underscores. */
  metric_label: string;
  /** Which chart the line belongs on, and which axis. `role` decides the axis,
   * because a total is an order of magnitude above its own best. */
  family: string;
  role: string;
  sort_order: number;
  power: number | null;
  rank: number | null;
  unit_name: string | null;
  unit_grade: number | null;
  board_size: number | null;
  /** Which route the reading came by — a board, or a profile open. The two write
   * the same metric on purpose (verified equal on 14 of 14 players present in
   * both), and this column is what tells them apart. */
  source_command: string;
}

async function fetchComponents(playerId: string): Promise<ComponentRow[]> {
  const { data, error } = await supabase
    .from('player_component_power_history')
    .select(
      'captured_at, metric, metric_label, family, role, sort_order, power, rank, unit_name, unit_grade, board_size, source_command',
    )
    .eq('player_id', playerId)
    .order('captured_at', { ascending: true })
    .limit(4000);
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

/** One metric as the registry describes it, with the readings that carry it. */
interface MetricGroup {
  metric: string;
  label: string;
  role: string;
  sortOrder: number;
  rows: ComponentRow[];
}

/** Every metric present in this player's readings, in the registry's order.
 *
 * Discovered from the data rather than declared, which is what lets a new metric
 * appear here on its own. Ordered by `sort_order`, so the legend order is an
 * admin's decision rather than whatever order PostgREST happened to return.
 */
function groups(rows: readonly ComponentRow[]): MetricGroup[] {
  const found = new Map<string, MetricGroup>();
  for (const row of rows) {
    const existing = found.get(row.metric);
    if (existing === undefined) {
      found.set(row.metric, {
        metric: row.metric,
        label: row.metric_label,
        role: row.role,
        sortOrder: row.sort_order,
        rows: [row],
      });
    } else {
      existing.rows.push(row);
    }
  }
  return [...found.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

/** A series from the readings that CARRY the field.
 *
 * Not every reading carries every figure: a board gives a rank, a profile open does
 * not. Mapping over all of them and letting the misses be null breaks the line at
 * each one, which reads as a gap in observation rather than as a field that source
 * never had.
 */
function lineFrom(
  group: MetricGroup,
  pick: (row: ComponentRow) => number | null,
  slot: number,
  axis: 'left' | 'right',
  invert = false,
): Series | null {
  const points = group.rows
    .filter((row) => pick(row) !== null)
    .map((row) => ({ t: Date.parse(row.captured_at), v: pick(row) }));
  if (points.length === 0) {
    return null;
  }
  return { name: group.label, slot, axis, invert, points };
}

/** How big the boards behind these ranks are, said once.
 *
 * Not in each line's name: four lines each carrying "(of 150)" is a 130-character
 * axis label in a 720-unit viewBox — it overflows the plot and repeats one fact four
 * times. A rank without its denominator is what 0081 and 0084 exist to fix, so it
 * has to be said somewhere.
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

/** The named hero or pet behind a "best" figure, from the newest reading that had
 * one. "Strongest hero 7.5M" with no name is a figure nobody can act on. */
function namedUnits(rows: readonly ComponentRow[]): { label: string; row: ComponentRow }[] {
  const out: { label: string; row: ComponentRow }[] = [];
  for (const group of groups(rows)) {
    const newest = [...group.rows].reverse().find((row) => row.unit_name !== null);
    if (newest !== undefined) {
      out.push({ label: group.label, row: newest });
    }
  }
  return out;
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
        Nothing has reported this player's hero or pet figures yet. The boards list only the top
        150, and a profile has to have been opened at least once.
      </p>
    );
  }

  const present = groups(rows);

  // Totals and one-off figures share the left axis; the "strongest" figures share
  // the right. Split by ROLE rather than by family: within heroes the total is ten
  // times the best, so a hero-only chart puts its own best line along the floor,
  // while totals against totals and bests against bests are the comparable pairs.
  // The axis is decided by MAGNITUDE, not by the registry's role. Role was the
  // first rule and it was the wrong one: `migrate_power` is an "other" and sits at
  // 27M, between the totals and the bests, so grouping by role put a 3.2M line on
  // the same scale as a 74M one and left it crawling along the floor. `assignAxes`
  // splits where the numbers actually separate, and leaves one axis alone when they
  // do not.
  const powers = assignAxes(
    present
      .map((group, index) => lineFrom(group, (row) => row.power, index, 'left'))
      .filter((line): line is Series => line !== null),
  );

  // Every metric that has a rank, on one inverted axis. Small integers where the
  // powers are millions, so they were never going to share a chart with them.
  const ranks = present
    .map((group, index) => lineFrom(group, (row) => row.rank, index, 'left', true))
    .filter((line): line is Series => line !== null);

  const named = namedUnits(rows);

  return (
    <>
      {named.length > 0 && (
        <p className="subtle">
          {named.map(({ label, row }, index) => (
            <span key={label}>
              {index > 0 && ' · '}
              {label}: <strong>{row.unit_name}</strong>
              {/* Grade only where the catalogue has one. Heroes carry it; pets have
                  no grade column yet, and printing a number nobody assigned would be
                  worse than printing none. */}
              {row.unit_grade !== null && ` (grade ${row.unit_grade})`}
            </span>
          ))}
        </p>
      )}

      {powers.length === 0 ? (
        <p className="empty">These readings listed the player but carried no power figure.</p>
      ) : (
        <LineChart
          formatRight={bigValue}
          formatTime={moment}
          formatValue={bigValue}
          label="Hero, pet and account figures over time, split across two scales so no line is squashed"
          note="The two axes are split where the figures separate, because a total is about ten times its own best and on one scale the smaller lines lie along the floor. Steps rather than slopes are normal: hero power moves when a threshold is crossed."
          series={powers}
        />
      )}

      {ranks.length > 0 && (
        <LineChart
          formatTime={moment}
          formatValue={wholeValue}
          height={180}
          label="Rank on each board that listed this player, inverted so climbing is up"
          note={`The axis is inverted — a line going UP is them climbing.${boardSizeNote(rows)} These boards cover every server the game puts on them, not server 580 alone. A figure read from a profile rather than a board has no rank, so it is absent here.`}
          series={ranks}
        />
      )}
    </>
  );
}
