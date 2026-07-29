// Game week boundary: Monday 02:00 UTC. Implemented three times (SQL,
// Python, this file); all three consume
// protocol-fixtures/reset-week/vectors.json — change them together.

const RESET_HOUR_UTC = 2;
const HOUR_MS = 3_600_000;

/** Most recent Monday 02:00 UTC at or before ts (boundary inclusive). */
export function resetWeekStart(ts: Date): Date {
  const shifted = new Date(ts.getTime() - RESET_HOUR_UTC * HOUR_MS);
  const mondayOffset = (shifted.getUTCDay() + 6) % 7;
  return new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate() - mondayOffset,
      RESET_HOUR_UTC,
    ),
  );
}
