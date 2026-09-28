const whole = new Intl.NumberFormat('ko-KR');
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 });

/** FR-UI-008: unknown is unknown, never zero. */
export function num(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : whole.format(value);
}

/** Power reads in billions on these boards; the full figure is in the title. */
export function power(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : compact.format(value);
}

/** +12 / −3 / 0, or — when either side is unknown. */
export function signed(value: number | null, format: (v: number) => string = num): string {
  if (value === null) return '—';
  if (value === 0) return '0';
  return value > 0 ? `+${format(value)}` : `−${format(-value)}`;
}

/** Positive, negative or neither, for colouring a change — always beside the
 * sign, never instead of it. */
export function trend(value: number | null): string {
  if (value === null || value === 0) return '';
  return value > 0 ? 'growth-up' : 'growth-down';
}
