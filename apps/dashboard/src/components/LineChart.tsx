import { useId, useState } from 'react';
import {
  type Extent,
  type Point,
  type Series,
  axisInverted,
  extents,
  linePath,
  mergedTimes,
  nearestIndex,
  onAxis,
  scaleX,
  scaleY,
  ticks,
  wholeNumbers,
} from '../lib/series';

/** A line chart, in SVG, with no charting library.
 *
 * Not austerity — the CSP on the deployed page forbids external hosts, the
 * landing budget is 150kb of JS, and every runtime this needs (`extents`,
 * `linePath`, `ticks`) is a dozen lines in `lib/series.ts` with tests on it.
 * A library would add a bundle, a theme adapter and a second styling language
 * to solve arithmetic that is already solved.
 *
 * Two ways to move the crosshair, both setting ONE index into the merged
 * timeline, so the crosshair, the dots and the readout can never disagree:
 * hovering the plot, and a range slider under it.
 *
 * The slider is not a fallback. A `tabIndex` on the SVG is what this had first,
 * and it is the wrong shape twice over — the element has `role="img"`, which is
 * not focusable in any accessibility tree, and a phone has no hover at all, so
 * the exact figures would have been mouse-only. A range input is a real control
 * that arrow keys, screen readers and thumbs all already understand.
 *
 * The series carry a palette SLOT rather than a colour, so the hues stay in CSS
 * and follow the theme. Below the plot there is a real table of the same
 * numbers, visually hidden — a chart is an image, and an image is not a fact
 * anybody can read with a screen reader.
 */
export interface LineChartProps {
  series: Series[];
  /** What the whole chart is of. Becomes the accessible name. */
  label: string;
  /** Formats a value on the LEFT axis. The chart never guesses: 4,350,390 as
   * "4.35M" is right for power and wrong for a tower level. */
  formatValue: (value: number) => string;
  /** Formats a value on the right axis. Required in practice whenever a series
   * sets `axis: 'right'` — that axis exists because the two quantities are
   * different, so one formatter for both would defeat the purpose. Falls back to
   * `formatValue` rather than throwing. */
  formatRight?: (value: number) => string;
  /** Formats a moment for the axis and the readout. */
  formatTime: (t: number) => string;
  height?: number;
  /** Drawn under the plot as a note. For "captured when somebody opened the
   * board, so the gaps are ours and not theirs". */
  note?: string;
}

const WIDTH = 720;

export function LineChart({
  series,
  label,
  formatValue,
  formatRight,
  formatTime,
  height = 220,
  note,
}: LineChartProps) {
  const clipId = useId();
  const [active, setActive] = useState<number | null>(null);

  const left = onAxis(series, 'left');
  const right = onAxis(series, 'right');
  const rightFormat = formatRight ?? formatValue;

  const box = {
    width: WIDTH,
    height,
    // Left room enough for a formatted power figure; bottom for one row of
    // dates. Hard-coded rather than measured: measuring text means a layout
    // pass per render, and the two formatters here produce short strings.
    //
    // The right gutter opens up only when something is measured against it, so a
    // single-axis chart does not carry an empty margin.
    padLeft: 64,
    padRight: right.length > 0 ? 60 : 12,
    padTop: 12,
    padBottom: 28,
  };

  // One extent per axis. Sharing one would put a 17-billion total and a
  // 180-million mean on the same scale, which is the whole thing two axes fix.
  const range = extents(left.length > 0 ? left : series);
  const rightRange = right.length > 0 ? extents(right) : null;
  const leftInverted = axisInverted(left);
  const rightInverted = axisInverted(right);
  // Ranks, member counts and "how many reached level 35" are whole numbers, and a
  // fractional gridline on them is both meaningless and — once the formatter
  // rounds it — a duplicate label. Read off the DATA rather than declared by each
  // caller: every series that is whole is whole, and a chart cannot forget to say
  // so. A single axis of 1 to 2 is where it showed: gridlines 1, 1.5, 2 printed
  // "1", "2", "2".
  const leftStep = wholeNumbers(left.length > 0 ? left : series) ? 1 : 0;
  const rightStep = wholeNumbers(right) ? 1 : 0;
  const times = mergedTimes(series);
  const activeTime = active === null ? null : (times[active] ?? null);

  // Which axis a line belongs to, resolved once so the path, the dots and the
  // readout cannot disagree about it.
  //
  // Takes the left extent as an argument for the same reason `pick` does: the
  // null check below is what makes it non-null, and a closure reading it from
  // above has forgotten that narrowing by the time it runs.
  function axisOf(line: Series, y: Extent): { y: Extent; invert: boolean } {
    return (line.axis ?? 'left') === 'right' && rightRange !== null
      ? { y: rightRange.y, invert: rightInverted }
      : { y, invert: leftInverted };
  }

  // The cursor arrives as a fraction of the rendered width; the plot lives in
  // viewBox units and is inset by the axis gutter, so it has to go back through
  // both before it means a time.
  //
  // Takes the extent as an argument rather than closing over it: the null check
  // below is what makes it non-null, and a closure reads it after that narrowing
  // has been forgotten.
  function pick(widthFraction: number, x: { min: number; max: number }): void {
    const plotWidth = box.width - box.padLeft - box.padRight;
    const offset = widthFraction * box.width - box.padLeft;
    const t = x.min + (offset / plotWidth) * (x.max - x.min);
    const stops: Point[] = times.map((time) => ({ t: time, v: 0 }));
    setActive(nearestIndex(stops, t));
  }

  if (range === null) {
    return (
      <p className="empty">
        Nothing to plot yet — every reading in this range is missing its value.
      </p>
    );
  }

  return (
    <figure className="chart">
      {/* No tabIndex and no key handler: the slider below is the control. The
          crosshair is deliberately NOT cleared when the pointer leaves — with
          two inputs driving one index, clearing on mouseleave would wipe a
          position the reader had just set with the slider. */}
      <svg
        aria-label={label}
        className="chart-svg"
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          pick((event.clientX - rect.left) / rect.width, range.x);
        }}
        role="img"
        viewBox={`0 0 ${box.width} ${box.height}`}
      >
        <defs>
          {/* Values outside the extent cannot happen, but a rounding error at
              the edge drawing half a pixel into the axis label looks like a
              bug in the data. */}
          <clipPath id={clipId}>
            <rect
              height={box.height - box.padTop - box.padBottom}
              width={box.width - box.padLeft - box.padRight}
              x={box.padLeft}
              y={box.padTop}
            />
          </clipPath>
        </defs>

        {/* Gridlines come from the LEFT axis only. Drawing both sets would put
            two unrelated grids over each other and neither would be readable —
            the right axis gets labels against the same lines it does not own,
            which is the ordinary convention for a twin-axis chart. */}
        {ticks(range.y, 4, leftStep).map((value) => {
          const y = scaleY(value, range.y, box, leftInverted);
          return (
            <g key={`y${value}`}>
              <line
                className="chart-grid"
                x1={box.padLeft}
                x2={box.width - box.padRight}
                y1={y}
                y2={y}
              />
              <text className="chart-axis" dy="0.32em" textAnchor="end" x={box.padLeft - 8} y={y}>
                {formatValue(value)}
              </text>
            </g>
          );
        })}

        {rightRange !== null &&
          ticks(rightRange.y, 4, rightStep).map((value) => (
            <text
              key={`r${value}`}
              className="chart-axis"
              dy="0.32em"
              x={box.width - box.padRight + 8}
              y={scaleY(value, rightRange.y, box, rightInverted)}
            >
              {rightFormat(value)}
            </text>
          ))}

        {/* Which axis is which, in words. Two unlabelled scales are worse than
            one: the reader cannot tell which number belongs to which line, and
            the colours only help once you already know. */}
        {right.length > 0 && (
          <>
            <text className="chart-axis" x={4} y={box.padTop - 2}>
              {left.map((line) => line.name).join(' · ')}
              {leftInverted ? ' (up is better)' : ''}
            </text>
            <text className="chart-axis" textAnchor="end" x={box.width - 4} y={box.padTop - 2}>
              {right.map((line) => line.name).join(' · ')}
              {rightInverted ? ' (up is better)' : ''}
            </text>
          </>
        )}

        {/* Two labels, not a tick per capture. The x axis exists to say what
            range you are looking at; the exact moment of a reading comes from
            the readout, where there is room for it. */}
        <text className="chart-axis" x={box.padLeft} y={box.height - 8}>
          {formatTime(range.x.min)}
        </text>
        <text
          className="chart-axis"
          textAnchor="end"
          x={box.width - box.padRight}
          y={box.height - 8}
        >
          {formatTime(range.x.max)}
        </text>

        <g clipPath={`url(#${clipId})`}>
          {activeTime !== null && (
            <line
              className="chart-crosshair"
              x1={scaleX(activeTime, range.x, box)}
              x2={scaleX(activeTime, range.x, box)}
              y1={box.padTop}
              y2={box.height - box.padBottom}
            />
          )}
          {series.map((line) => {
            const { y, invert } = axisOf(line, range.y);
            return (
              <path
                key={line.name}
                className={`chart-line chart-slot-${line.slot % 6}${line.emphasis ? ' chart-emphasis' : ''}${(line.axis ?? 'left') === 'right' ? ' chart-right-axis' : ''}`}
                d={linePath(line.points, range.x, y, box, invert)}
              />
            );
          })}
          {/* A dot per reading only when the series is sparse. On a dense one
              they merge into a band and stop meaning "here is a capture". */}
          {series.map((line) => {
            const { y, invert } = axisOf(line, range.y);
            return line.points.length > 40
              ? null
              : line.points.map((point) =>
                  point.v === null ? null : (
                    <circle
                      key={`${line.name}:${point.t}`}
                      className={`chart-dot chart-slot-${line.slot % 6}`}
                      cx={scaleX(point.t, range.x, box)}
                      cy={scaleY(point.v, y, box, invert)}
                      r={activeTime === point.t ? 4.5 : 2.5}
                    />
                  ),
                );
          })}
        </g>
      </svg>

      {/* One reading per step, not a time scale: the captures are irregular, so
          a slider over milliseconds would spend most of its travel in the gaps
          between them. `aria-valuetext` is what makes it speak the moment rather
          than "7 of 12". */}
      {times.length > 1 && (
        <label className="chart-scrub">
          <span className="visually-hidden">Reading to read off {label}</span>
          <input
            aria-valuetext={activeTime === null ? 'none selected' : formatTime(activeTime)}
            max={times.length - 1}
            min={0}
            onChange={(event) => setActive(Number(event.target.value))}
            step={1}
            type="range"
            value={active ?? 0}
          />
        </label>
      )}

      <figcaption>
        {activeTime === null ? (
          <span className="subtle">
            {note ?? 'Hover the chart, or drag the slider, to read a value.'}
          </span>
        ) : (
          <span className="chart-readout">
            <strong>{formatTime(activeTime)}</strong>
            {series.map((line) => {
              const at = line.points.find((point) => point.t === activeTime);
              // Silent for a series with no reading at this moment, rather than
              // "—": the alliances here are captured at different times, and a
              // dash would read as "we looked and they had nothing".
              if (at === undefined || at.v === null) {
                return null;
              }
              const format = (line.axis ?? 'left') === 'right' ? rightFormat : formatValue;
              return (
                <span key={line.name} className={`chart-legend chart-slot-${line.slot % 6}`}>
                  {line.name} {format(at.v)}
                </span>
              );
            })}
          </span>
        )}
      </figcaption>

      {/* The same numbers as a table, for anything that cannot read an SVG.
          One column per series; rows in time order. */}
      <table className="visually-hidden">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">When</th>
            {series.map((line) => (
              <th key={line.name} scope="col">
                {line.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {times.map((time) => (
            <tr key={time}>
              <th scope="row">{formatTime(time)}</th>
              {series.map((line) => {
                const at = line.points.find((point) => point.t === time);
                const format = (line.axis ?? 'left') === 'right' ? rightFormat : formatValue;
                return (
                  <td key={line.name}>
                    {at === undefined || at.v === null ? 'not observed' : format(at.v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
