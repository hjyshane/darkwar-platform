/** Horizontal bars as plain SVG, one row per label: stacked segments, or segments that
 * grow to either side of a centre line for a figure that comes and goes (arrivals against
 * departures). Colour never carries a figure alone: every bar has a title and the same
 * numbers sit in the table beside the chart, which is why the chart itself is one image
 * for a screen reader. */
export interface BarSegment {
  key: string;
  label: string;
  value: number;
  /** A CSS class that sets `fill`. */
  className: string;
  /** Only with `diverging`: which side of the centre line the segment grows to. */
  side?: 'left' | 'right';
}

export interface BarRow {
  label: string;
  segments: BarSegment[];
}

const WIDTH = 640;
const LABEL = 56;
const ROW = 22;
const GAP = 4;

/** The longest a bar can be, so every row shares one scale: the biggest stacked total, or
 * for a diverging chart the biggest side. Never zero, so a chart of zeros still draws. */
export function barScale(rows: readonly BarRow[], diverging: boolean): number {
  let max = 0;
  for (const row of rows) {
    if (diverging) {
      const left = sum(row.segments.filter((s) => s.side === 'left'));
      const right = sum(row.segments.filter((s) => s.side !== 'left'));
      max = Math.max(max, left, right);
    } else {
      max = Math.max(max, sum(row.segments));
    }
  }
  return max > 0 ? max : 1;
}

const sum = (segments: readonly BarSegment[]) =>
  segments.reduce((total, s) => total + Math.max(s.value, 0), 0);

export function BarChart({
  rows,
  ariaLabel,
  diverging = false,
}: {
  rows: readonly BarRow[];
  ariaLabel: string;
  diverging?: boolean;
}) {
  const scale = barScale(rows, diverging);
  const plot = WIDTH - LABEL - 8;
  const centre = LABEL + (diverging ? plot / 2 : 0);
  const unit = (diverging ? plot / 2 : plot) / scale;
  const height = rows.length * (ROW + GAP) + GAP;

  return (
    <svg
      className="bar-chart"
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${WIDTH} ${height}`}
      width="100%"
    >
      {diverging && <line className="bar-axis" x1={centre} x2={centre} y1={0} y2={height} />}
      {rows.map((row, index) => {
        const y = GAP + index * (ROW + GAP);
        let left = centre;
        let right = centre;
        return (
          <g key={row.label}>
            <text
              className="bar-label"
              x={LABEL - 6}
              y={y + ROW / 2}
              textAnchor="end"
              dominantBaseline="central"
            >
              {row.label}
            </text>
            {row.segments.map((segment) => {
              const value = Math.max(segment.value, 0);
              const w = value * unit;
              const toLeft = diverging && segment.side === 'left';
              const x = toLeft ? left - w : right;
              if (toLeft) left -= w;
              else right += w;
              if (w <= 0) return null;
              return (
                <rect
                  key={segment.key}
                  className={segment.className}
                  x={x}
                  y={y}
                  width={w}
                  height={ROW}
                >
                  <title>{`${row.label}: ${segment.label} ${segment.value}`}</title>
                </rect>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

/** The legend under a chart: a swatch and a word for every series. */
export function BarLegend({
  items,
}: { items: ReadonlyArray<{ key: string; label: string; className: string }> }) {
  return (
    <ul className="bar-legend">
      {items.map((item) => (
        <li key={item.key}>
          <svg width="12" height="12" aria-hidden="true">
            <rect className={item.className} width="12" height="12" />
          </svg>{' '}
          {item.label}
        </li>
      ))}
    </ul>
  );
}
