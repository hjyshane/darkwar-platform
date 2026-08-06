/** The arithmetic behind the charts, kept out of the component.
 *
 * All of it is pure and all of it is tested, because a scale that is subtly
 * wrong does not throw — it draws a plausible line for the wrong numbers, and a
 * screenshot cannot tell you. The component below it does layout and events
 * only.
 */

/** One reading: a moment and a value. `null` is a gap, not a zero — a capture
 * that carried no power and a power of nothing are different facts (FR-UI-008),
 * and a chart that joins across them invents a slope. */
export interface Point {
  t: number;
  v: number | null;
}

export interface Series {
  name: string;
  points: Point[];
  /** Which of the palette's slots this line takes. Index, not a colour, so the
   * hues live in CSS and follow the theme. */
  slot: number;
  /** Drawn thicker and above the rest. For "ours" among a field of strangers. */
  emphasis?: boolean;
  /** Which value axis this line is measured against. Defaults to the left.
   *
   * Two axes exist because of a real problem, not for decoration: total alliance
   * power is 17 billion and the mean per member is 180 million, so on one axis
   * the mean lies flat along the floor and the only readable line is the one you
   * already knew. Splitting them is what makes the second line say anything. */
  axis?: 'left' | 'right';
  /** Draw the axis upside down, so a FALLING number rises on the chart.
   *
   * For rank. Rank 6 is better than rank 9, and a chart where improvement points
   * downwards gets misread by everybody exactly once. */
  invert?: boolean;
}

export interface Box {
  width: number;
  height: number;
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
}

export interface Extent {
  min: number;
  max: number;
}

/** The span two axes must cover to show every point of every series.
 *
 * Null-valued points count for the time axis and not the value axis: the
 * reading happened, we just do not know what it said, so the x range includes
 * it while the y range is not stretched by it.
 */
/** How much of the plot's height is left clear above and below the data.
 *
 * The value axis used to start exactly at the smallest reading, which drew the
 * lowest line along the very bottom of the frame where it reads as a floor
 * rather than as a value. A tenth of the range at each end lifts it clear
 * without the axis pretending to a span it does not have. */
const FLOOR_HEADROOM = 0.1;

export function extents(series: readonly Series[]): { x: Extent; y: Extent } | null {
  let xMin = Number.POSITIVE_INFINITY;
  let xMax = Number.NEGATIVE_INFINITY;
  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  let values = 0;

  for (const line of series) {
    for (const point of line.points) {
      xMin = Math.min(xMin, point.t);
      xMax = Math.max(xMax, point.t);
      if (point.v !== null) {
        yMin = Math.min(yMin, point.v);
        yMax = Math.max(yMax, point.v);
        values += 1;
      }
    }
  }

  if (values === 0) {
    return null;
  }

  // A single reading, or several that agree exactly, has no extent. Widening it
  // by a tenth puts the line across the middle instead of dividing by zero, and
  // the reader sees one flat line — which is the truth.
  if (yMin === yMax) {
    const pad = Math.abs(yMin) < 1 ? 1 : Math.abs(yMin) * 0.1;
    yMin -= pad;
    yMax += pad;
  } else {
    const pad = (yMax - yMin) * FLOOR_HEADROOM;
    yMin -= pad;
    yMax += pad;
  }
  if (xMin === xMax) {
    xMin -= 1;
    xMax += 1;
  }

  return { x: { min: xMin, max: xMax }, y: { min: yMin, max: yMax } };
}

/** The series belonging to one value axis. */
export function onAxis(series: readonly Series[], axis: 'left' | 'right'): Series[] {
  return series.filter((line) => (line.axis ?? 'left') === axis);
}

/** True when any line on this axis wants it drawn upside down.
 *
 * Read off the axis rather than the line, because an axis has one direction: two
 * lines sharing it and disagreeing about which way is up cannot both be drawn,
 * and silently honouring the first would be a chart that lies about the second.
 * Callers put a rank on its own axis for exactly this reason.
 */
export function axisInverted(series: readonly Series[]): boolean {
  return series.some((line) => line.invert === true);
}

/** Where a value sits across the plot, in SVG user units. */
export function scaleX(t: number, x: Extent, box: Box): number {
  const span = box.width - box.padLeft - box.padRight;
  return box.padLeft + ((t - x.min) / (x.max - x.min)) * span;
}

/** Same, downwards: SVG y grows towards the bottom and a value axis does not.
 *
 * `invert` flips it again, which puts the SMALLEST value at the top. That is
 * what a rank axis needs — rank 1 is the best — and doing it here rather than by
 * negating the data keeps the tooltip showing 6 instead of −6.
 */
export function scaleY(v: number, y: Extent, box: Box, invert = false): number {
  const span = box.height - box.padTop - box.padBottom;
  const fraction = (v - y.min) / (y.max - y.min);
  return box.padTop + (invert ? fraction : 1 - fraction) * span;
}

/** An SVG path for one series, broken wherever a reading is missing.
 *
 * Several `M` commands rather than one long `L` chain: a gap must LOOK like a
 * gap. Joining across a capture we do not have draws a straight line through
 * days nobody observed and reads as steady growth.
 */
export function linePath(
  points: readonly Point[],
  x: Extent,
  y: Extent,
  box: Box,
  invert = false,
): string {
  const parts: string[] = [];
  let open = false;
  for (const point of points) {
    if (point.v === null) {
      open = false;
      continue;
    }
    const px = scaleX(point.t, x, box).toFixed(2);
    const py = scaleY(point.v, y, box, invert).toFixed(2);
    parts.push(`${open ? 'L' : 'M'}${px} ${py}`);
    open = true;
  }
  return parts.join(' ');
}

/** Carry the last known value forward across gaps.
 *
 * ONLY for a quantity that cannot go down. A tower level is one: a capture that
 * did not carry it is a capture that did not carry it, not a demolished tower, so
 * holding the last reading is closer to the truth than a break in the line.
 *
 * Wrong for anything that can fall — power, rank, a daily total that resets —
 * where a flat run would assert a measurement nobody took. Which is why this is
 * a separate call the caller makes per series rather than something `linePath`
 * does for everyone.
 *
 * Leading nulls stay null: there is nothing yet to carry, and inventing the
 * first value from the future is the one thing forward-fill must never do.
 */
export function forwardFill(points: readonly Point[]): Point[] {
  let last: number | null = null;
  return points.map((point) => {
    if (point.v !== null) {
      last = point.v;
      return point;
    }
    return { t: point.t, v: last };
  });
}

/** Round tick values that cover the extent, at most `count` of them.
 *
 * The 1/2/5 progression, so labels read 200k / 400k / 600k rather than
 * 183,402 / 366,804. A chart whose gridlines are arbitrary is one nobody can
 * read a value off without the tooltip.
 */
export function ticks(extent: Extent, count = 4): number[] {
  const span = extent.max - extent.min;
  if (span <= 0 || !Number.isFinite(span)) {
    return [extent.min];
  }
  const rough = span / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalised = rough / magnitude;
  // The 1/2/5/10 ladder, taking the smallest rung at or above what was asked
  // for — so `count` is an upper bound on the intervals. Stopping the ladder at
  // 5 was a bug: an extent of 0..3 wants a step of 1 and got 0.5, which is a
  // legal round number and twice as many gridlines as were asked for.
  let step = (normalised > 5 ? 10 : normalised > 2 ? 5 : normalised > 1 ? 2 : 1) * magnitude;

  let out = ladder(extent, step);
  // Stepping DOWN when the rung chosen leaves fewer than two gridlines.
  //
  // `count` is an upper bound, so a rung slightly too coarse is normally fine —
  // except when it is coarse enough that only one tick lands inside the extent,
  // and then the axis has a single number on it and can no longer be read. The
  // rank chart hit exactly that: ranks 1 to 9 padded to 0.2–9.8 asked for a rough
  // step of 2.4, took the 5 rung, and drew one gridline labelled 5.
  //
  // One rung down, not a recomputation: 5 → 2 → 1 → 0.5 keeps the labels on the
  // same round progression, which is the whole point of the ladder.
  while (out.length < 2 && step > 0) {
    step = nextRungDown(step);
    if (step <= 0 || !Number.isFinite(step)) {
      break;
    }
    out = ladder(extent, step);
  }
  return out;
}

/** The rung below this one on the 1/2/5 ladder. */
function nextRungDown(step: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(step));
  const normalised = Math.round(step / magnitude);
  if (normalised >= 10) {
    return 5 * magnitude;
  }
  if (normalised >= 5) {
    return 2 * magnitude;
  }
  if (normalised >= 2) {
    return magnitude;
  }
  return 5 * (magnitude / 10);
}

/** Every multiple of `step` inside the extent. */
function ladder(extent: Extent, step: number): number[] {
  // How many decimals the step itself has. Snapping by `round(v / step) * step`
  // does not work — 3 * 0.2 is 0.6000000000000001 in binary floating point, so
  // the multiplication puts the drift back. Rounding to the step's own precision
  // is what actually keeps a label from reading 0.6000000000000001.
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const out: number[] = [];
  const first = Math.ceil(extent.min / step) * step;
  for (let index = 0; ; index += 1) {
    // Multiplied out from the first tick rather than accumulated, so the drift
    // cannot compound across a long axis.
    const value = Number((first + index * step).toFixed(decimals));
    if (value > extent.max + step * 1e-9) {
      break;
    }
    out.push(value);
    // A guard, not a policy: a step small enough to round to nothing would loop
    // forever, and that is reachable from a degenerate extent.
    if (out.length > 100) {
      break;
    }
  }
  return out;
}

/** The reading nearest a cursor, by time.
 *
 * Nearest rather than "the one to the left": with captures minutes apart in a
 * cluster and days apart elsewhere, snapping one direction makes the tooltip
 * disagree with the dot the cursor is sitting on.
 */
export function nearestIndex(points: readonly Point[], t: number): number | null {
  let best: number | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const [index, point] of points.entries()) {
    const gap = Math.abs(point.t - t);
    if (gap < bestGap) {
      bestGap = gap;
      best = index;
    }
  }
  return best;
}

/** Every distinct moment across the series, ascending.
 *
 * The chart's hover is indexed on this rather than on one series, because the
 * series do not share timestamps: two alliances are captured seconds apart and
 * a crosshair pinned to the first would sit beside the second's dot.
 */
export function mergedTimes(series: readonly Series[]): number[] {
  const seen = new Set<number>();
  for (const line of series) {
    for (const point of line.points) {
      seen.add(point.t);
    }
  }
  return [...seen].sort((left, right) => left - right);
}

/** Thin a series to at most `limit` points, keeping the ends.
 *
 * For the dense one: our own roster is captured every few minutes, and 180
 * points across 700 pixels is four points per pixel — the extra ones cost DOM
 * nodes and buy nothing. Every-nth rather than an average, so each drawn point
 * is still a reading that happened and the tooltip is not showing a number the
 * game never reported.
 */
export function thin(points: readonly Point[], limit: number): Point[] {
  if (points.length <= limit || limit < 2) {
    return [...points];
  }
  const stride = Math.ceil(points.length / limit);
  const out: Point[] = [];
  for (let index = 0; index < points.length; index += stride) {
    const point = points[index];
    if (point !== undefined) {
      out.push(point);
    }
  }
  const last = points[points.length - 1];
  if (last !== undefined && out[out.length - 1] !== last) {
    out.push(last);
  }
  return out;
}
