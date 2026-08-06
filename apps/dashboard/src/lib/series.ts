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
  }
  if (xMin === xMax) {
    xMin -= 1;
    xMax += 1;
  }

  return { x: { min: xMin, max: xMax }, y: { min: yMin, max: yMax } };
}

/** Where a value sits across the plot, in SVG user units. */
export function scaleX(t: number, x: Extent, box: Box): number {
  const span = box.width - box.padLeft - box.padRight;
  return box.padLeft + ((t - x.min) / (x.max - x.min)) * span;
}

/** Same, downwards: SVG y grows towards the bottom and a value axis does not. */
export function scaleY(v: number, y: Extent, box: Box): number {
  const span = box.height - box.padTop - box.padBottom;
  return box.padTop + (1 - (v - y.min) / (y.max - y.min)) * span;
}

/** An SVG path for one series, broken wherever a reading is missing.
 *
 * Several `M` commands rather than one long `L` chain: a gap must LOOK like a
 * gap. Joining across a capture we do not have draws a straight line through
 * days nobody observed and reads as steady growth.
 */
export function linePath(points: readonly Point[], x: Extent, y: Extent, box: Box): string {
  const parts: string[] = [];
  let open = false;
  for (const point of points) {
    if (point.v === null) {
      open = false;
      continue;
    }
    const px = scaleX(point.t, x, box).toFixed(2);
    const py = scaleY(point.v, y, box).toFixed(2);
    parts.push(`${open ? 'L' : 'M'}${px} ${py}`);
    open = true;
  }
  return parts.join(' ');
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
  const step = (normalised > 5 ? 10 : normalised > 2 ? 5 : normalised > 1 ? 2 : 1) * magnitude;

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
