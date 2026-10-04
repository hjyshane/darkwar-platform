// Big numbers the way the game writes them: 7.16B, 240M, 12.5K. The exact
// figure goes in a title for whoever needs it.

const UNITS: ReadonlyArray<[number, string]> = [
  [1e12, 'T'],
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'K'],
];

/** 3 significant figures past a thousand; plain below it. */
export function short(value: number): string {
  const sign = value < 0 ? '-' : '';
  const n = Math.abs(value);
  for (const [size, unit] of UNITS) {
    if (n >= size) {
      const scaled = n / size;
      const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
      return `${sign}${Number(scaled.toFixed(digits))}${unit}`;
    }
  }
  return `${sign}${Math.round(n)}`;
}

/** The exact figure, for a title. */
export function exact(value: number): string {
  return Math.round(value).toLocaleString('en');
}
