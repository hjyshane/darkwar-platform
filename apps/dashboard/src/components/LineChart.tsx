import { useId, useState } from 'react';
import {
  type Point,
  type Series,
  extents,
  linePath,
  mergedTimes,
  nearestIndex,
  scaleX,
  scaleY,
  ticks,
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
  /** Formats a value for the axis and the readout. The chart never guesses:
   * 4,350,390 as "4.35M" is right for power and wrong for a tower level. */
  formatValue: (value: number) => string;
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
  formatTime,
  height = 220,
  note,
}: LineChartProps) {
  const clipId = useId();
  const [active, setActive] = useState<number | null>(null);

  const box = {
    width: WIDTH,
    height,
    // Left room enough for a formatted power figure; bottom for one row of
    // dates. Hard-coded rather than measured: measuring text means a layout
    // pass per render, and the two formatters here produce short strings.
    padLeft: 64,
    padRight: 12,
    padTop: 12,
    padBottom: 28,
  };

  const range = extents(series);
  const times = mergedTimes(series);
  const activeTime = active === null ? null : (times[active] ?? null);

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

        {ticks(range.y, 4).map((value) => {
          const y = scaleY(value, range.y, box);
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
          {series.map((line) => (
            <path
              key={line.name}
              className={`chart-line chart-slot-${line.slot % 6}${line.emphasis ? ' chart-emphasis' : ''}`}
              d={linePath(line.points, range.x, range.y, box)}
            />
          ))}
          {/* A dot per reading only when the series is sparse. On a dense one
              they merge into a band and stop meaning "here is a capture". */}
          {series.map((line) =>
            line.points.length > 40
              ? null
              : line.points.map((point) =>
                  point.v === null ? null : (
                    <circle
                      key={`${line.name}:${point.t}`}
                      className={`chart-dot chart-slot-${line.slot % 6}`}
                      cx={scaleX(point.t, range.x, box)}
                      cy={scaleY(point.v, range.y, box)}
                      r={activeTime === point.t ? 4.5 : 2.5}
                    />
                  ),
                ),
          )}
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
              return (
                <span key={line.name} className={`chart-legend chart-slot-${line.slot % 6}`}>
                  {line.name} {formatValue(at.v)}
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
                return (
                  <td key={line.name}>
                    {at === undefined || at.v === null ? 'not observed' : formatValue(at.v)}
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
