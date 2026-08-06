import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { LineChart } from '../../components/LineChart';
import { SortableTh } from '../../components/SortableTh';
import { allianceHash } from '../../lib/route';
import type { Series } from '../../lib/series';
import { supabase } from '../../lib/supabase';
import { type SortState, nextSortKeys, sortRows } from '../../lib/tableControls';

/** Who on this server is growing, and how we compare.
 *
 * The ranking table already says who is BIG. This says who is moving, which is
 * the question that decides preparation: an alliance two places below us and
 * climbing 8% a week is a problem next month, and one above us that has not
 * moved in twelve days is not.
 *
 * `alliance_growth` (0073) does the two-readings-and-a-span arithmetic in SQL,
 * so this is one row per alliance rather than 2,675 rows thinned in the browser.
 * Every figure carries its span because the boards are captured when somebody
 * opens them: one alliance's 8% is over nine days and another's over two, and a
 * table that hid that would rank the second one first for no reason.
 *
 * Alliances seen once are listed with a blank change rather than dropped. The
 * list is "who is on this server", and silently narrowing it to "who we have
 * looked at twice" is a different answer to a question nobody asked.
 */
interface GrowthRow {
  alliance_id: string;
  name: string | null;
  code: string | null;
  is_own: boolean;
  member_count: number | null;
  readings: number;
  power_first: number | null;
  power_last: number | null;
  power_growth: number | null;
  power_growth_pct: number | null;
  rank_climb: number | null;
  rank_first: number | null;
  rank_last: number | null;
  span_days: number;
}

interface HistoryRow {
  alliance_id: string;
  captured_at: string;
  power: number | null;
  name: string | null;
  is_own: boolean;
}

/** How many lines the comparison chart draws. Six because that is how many
 * hues the palette has, and a seventh line would repeat one — two alliances the
 * same colour in a chart whose whole job is telling them apart. */
const CHART_LINES = 6;

async function fetchCompare(serverId: number) {
  const [growth, history] = await Promise.all([
    supabase
      .from('alliance_growth')
      .select(
        'alliance_id, name, code, is_own, member_count, readings, power_first, power_last, power_growth, power_growth_pct, rank_climb, rank_first, rank_last, span_days',
      )
      .eq('server_id', serverId)
      .order('power_last', { ascending: false, nullsFirst: false })
      .limit(300),
    supabase
      .from('alliance_power_history')
      .select('alliance_id, captured_at, power, name, is_own')
      .eq('server_id', serverId)
      .order('captured_at', { ascending: true })
      .limit(4000),
  ]);
  if (growth.error) {
    throw new Error(`growth query failed: ${growth.error.message}`);
  }
  if (history.error) {
    throw new Error(`history query failed: ${history.error.message}`);
  }
  return {
    growth: (growth.data ?? []) as GrowthRow[],
    history: (history.data ?? []) as HistoryRow[],
  };
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 });
const plain = new Intl.NumberFormat('ko-KR');

function bigValue(value: number): string {
  return compact.format(value);
}

function moment(t: number): string {
  return `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')}Z`;
}

/** A legend label short enough for six of them on one line.
 *
 * The tag first, because that is what the game puts on the board. An alliance
 * with no tag captured falls back to a clipped name, and one with neither to the
 * id — never to an empty label, which would leave a coloured line with nothing
 * to identify it. */
function shortName(row: GrowthRow): string {
  if (row.code) {
    return row.code;
  }
  if (row.name) {
    return row.name.length > 10 ? `${row.name.slice(0, 9)}…` : row.name;
  }
  return row.alliance_id.slice(0, 6);
}

export function AllianceCompare({ serverId }: { serverId: number }) {
  // Growth first, because "who is pulling away" is the question this tab exists
  // for. The ranking table already answers "who is big".
  // A list, like every other table since the roster got a tiebreaker — this one
  // does not use useTableView (it has no search box), so it carries the same
  // state shape by hand rather than behaving differently from its neighbours.
  const [sort, setSort] = useState<SortState[]>([{ key: 'power_growth_pct', direction: 'desc' }]);
  const { data, error, isPending } = useQuery({
    queryKey: ['alliance-compare', serverId],
    queryFn: () => fetchCompare(serverId),
  });

  if (isPending) {
    return <p className="empty">Loading…</p>;
  }
  if (error) {
    return <p className="error">Could not load the comparison: {error.message}</p>;
  }

  const rows = data?.growth ?? [];
  if (rows.length === 0) {
    return (
      <p className="empty">
        No alliance on server {serverId} has been seen in a captured ranking board yet.
      </p>
    );
  }

  // `sortRows` rather than a comparator per column: it already puts unknowns last
  // in BOTH directions, which is the rule that matters here. An alliance seen
  // once has not held still, and sorting its null growth as zero would file it
  // among the alliances that genuinely did not move.
  const ranked = sortRows(rows, sort);

  // The chart takes the top of whatever the table is sorted by, plus us — so
  // sorting by growth draws the fastest movers and sorting by power draws the
  // biggest, which is the comparison the reader just asked for. Ours is always
  // in it, emphasised, because "how do we compare" is the point.
  const chosen = ranked.filter((row) => row.readings > 1).slice(0, CHART_LINES);
  // `is_own` comes down with the row (0073 joins it), so which one is ours needs
  // no second query and no id threaded through the page. Ours displaces the last
  // of the six rather than becoming a seventh line, because a seventh would
  // repeat a hue in a chart whose whole job is telling the lines apart.
  const ours = ranked.find((row) => row.is_own && row.readings > 1);
  if (ours !== undefined && !chosen.some((row) => row.alliance_id === ours.alliance_id)) {
    chosen.pop();
    chosen.unshift(ours);
  }

  function onSort(key: string, additive: boolean): void {
    setSort((current) => nextSortKeys(current, key, additive));
  }

  const byAlliance = new Map<string, HistoryRow[]>();
  for (const row of data?.history ?? []) {
    const bucket = byAlliance.get(row.alliance_id) ?? [];
    bucket.push(row);
    byAlliance.set(row.alliance_id, bucket);
  }

  const series: Series[] = chosen.map((row, index) => ({
    // The tag, not the name. Six full names in one readout wraps to three lines
    // and pushes the chart around as the cursor moves; `[GRDK]` is what the game
    // shows on the board anyway. The table below carries both.
    name: shortName(row),
    slot: index,
    emphasis: row.is_own,
    points: (byAlliance.get(row.alliance_id) ?? []).map((point) => ({
      t: Date.parse(point.captured_at),
      v: point.power,
    })),
  }));

  return (
    <>
      {/* No sort control of its own: the table headers are the control, and the
          chart follows them. Two ways to set one order would be two places to
          look when they disagree. */}
      <p className="subtle">
        {rows.length} alliance{rows.length === 1 ? '' : 's'} on server {serverId} ·{' '}
        {rows.filter((row) => row.readings > 1).length} seen more than once · sort a column below to
        change which alliances the chart draws
      </p>

      {series.length === 0 ? (
        <p className="empty">
          No alliance here has been captured twice yet, so there is nothing to compare. The ranking
          boards are read when somebody opens them, not on a schedule.
        </p>
      ) : (
        <LineChart
          formatTime={moment}
          formatValue={bigValue}
          label={`Power over time for the top ${series.length} alliances on server ${serverId}`}
          note="Ours is the thick line. Gaps are captures we do not have, not weeks nobody played."
          series={series}
        />
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {/* Sorted on `name`, not on the tag shown in the chart: sorting a
                  list of alliances by their tag is not an order anybody is
                  looking for. */}
              <SortableTh className="label" onSort={onSort} sort={sort} sortKey="name">
                Alliance
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="power_last">
                Power
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="power_growth_pct">
                Change
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="rank_last">
                Rank
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="rank_climb">
                Climb
              </SortableTh>
              <SortableTh numeric onSort={onSort} sort={sort} sortKey="member_count">
                Members
              </SortableTh>
              {/* On `span_days`, so descending is the longest measurement rather
                  than alphabetical order over "9.1 days · 35 readings". */}
              <SortableTh className="label" onSort={onSort} sort={sort} sortKey="span_days">
                Measured over
              </SortableTh>
            </tr>
          </thead>
          <tbody>
            {ranked.map((row) => (
              <tr key={row.alliance_id}>
                <td className="label">
                  <a href={allianceHash(row.alliance_id)}>
                    {row.code ? `[${row.code}] ` : ''}
                    {row.name ?? row.alliance_id.slice(0, 8)}
                  </a>
                  {row.is_own && <span className="subtle"> · ours</span>}
                </td>
                <td className="num">{row.power_last === null ? '—' : bigValue(row.power_last)}</td>
                {/* Dash for one reading, and it means unmeasured — the column
                    beside it says how long the measurement covered, which is
                    what makes two percentages here comparable at all. */}
                <td
                  className={`num ${
                    row.power_growth_pct === null
                      ? ''
                      : row.power_growth_pct > 0
                        ? 'growth-up'
                        : row.power_growth_pct < 0
                          ? 'growth-down'
                          : ''
                  }`}
                >
                  {row.power_growth_pct === null
                    ? '—'
                    : `${row.power_growth_pct > 0 ? '+' : ''}${row.power_growth_pct.toFixed(1)}%`}
                </td>
                <td className="num">{row.rank_last ?? '—'}</td>
                {/* Positive is climbing, because rank falls as an alliance
                    improves and 0073 does that flip in SQL. */}
                <td
                  className={`num ${
                    row.rank_climb === null || row.rank_climb === 0
                      ? ''
                      : row.rank_climb > 0
                        ? 'growth-up'
                        : 'growth-down'
                  }`}
                >
                  {row.rank_climb === null
                    ? '—'
                    : row.rank_climb === 0
                      ? '0'
                      : `${row.rank_climb > 0 ? '+' : '−'}${Math.abs(row.rank_climb)}`}
                </td>
                <td className="num">{row.member_count ?? '—'}</td>
                <td className="label">
                  {row.readings < 2
                    ? 'one sighting'
                    : `${row.span_days.toFixed(1)} days · ${plain.format(row.readings)} readings`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
