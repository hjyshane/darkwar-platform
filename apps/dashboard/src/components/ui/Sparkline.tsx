/** A tiny trend line with no axes. Pure SVG, scales to its container.
 *
 * `values` may contain nulls (not observed): the line breaks there instead of
 * bridging, same rule as the full chart — never invent a point. Fewer than two
 * observed points draws nothing. Decorative: the figure beside it carries the
 * information. */
export function sparklinePaths(
  values: readonly (number | null)[],
  width: number,
  height: number,
  pad = 2,
): string[] {
  const seen = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (seen.length < 2) {
    return [];
  }
  const lo = Math.min(...seen);
  const hi = Math.max(...seen);
  const span = hi - lo || 1;
  const step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  const paths: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length >= 2) {
      paths.push(`M${run.join('L')}`);
    }
    run = [];
  };
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      flush();
      return;
    }
    const x = pad + i * step;
    const y = height - pad - ((v - lo) / span) * (height - pad * 2);
    run.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  flush();
  return paths;
}

export function Sparkline({
  values,
  width = 100,
  height = 24,
}: {
  values: readonly (number | null)[];
  width?: number;
  height?: number;
}) {
  const paths = sparklinePaths(values, width, height);
  if (paths.length === 0) {
    return null;
  }
  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
