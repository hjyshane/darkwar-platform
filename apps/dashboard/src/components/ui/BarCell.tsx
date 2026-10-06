/** Share of the column's maximum as a thin bar, for a table cell.
 *
 * Decoration beside a number that is already printed, so it is hidden from
 * assistive tech. Negative or missing values draw nothing rather than a
 * misleading stub. `lead` paints the top row gold; `low` paints it with the warning colour, for
 * a ratio that fell under its minimum (the number beside it says so in words). */
export function barRatio(value: number | null, max: number): number {
  if (value === null || !Number.isFinite(value) || max <= 0 || value <= 0) {
    return 0;
  }
  return Math.min(1, value / max);
}

export function BarCell({
  value,
  max,
  lead = false,
  low = false,
}: {
  value: number | null;
  max: number;
  lead?: boolean;
  low?: boolean;
}) {
  const pct = Math.round(barRatio(value, max) * 100);
  return (
    <span
      className={`bar-cell${lead ? ' bar-cell-lead' : ''}${low ? ' bar-cell-low' : ''}`}
      aria-hidden="true"
    >
      <i style={{ width: `${pct}%` }} />
    </span>
  );
}
