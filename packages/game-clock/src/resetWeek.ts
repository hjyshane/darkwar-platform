// Game week boundary: Monday 02:00 UTC. Implemented three times (SQL
// `reset_week_start` in migrations, Python `dw_collector.resetweek`, and
// this file); all three consume
// protocol-fixtures/reset-week/vectors.json — change them together.
//
// Lives here, in its own package, rather than in `@dw/ui`: this is a
// protocol/calendar rule with no rendering concern, and both
// `apps/dashboard` and `apps/desktop` need it. `@dw/ui` holds map
// projection/layout code — folding a calendar rule into a package named
// "ui" would be the kind of misnomer that makes the next reader look in
// the wrong place, and CLAUDE.md's "create directories on first use"
// applies just as well to a new package as to a new top-level folder: this
// is the first thing that actually needs a shared, non-UI home, so it gets
// one, sized to exactly what it holds.

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
