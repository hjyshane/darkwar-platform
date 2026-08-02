/** The catalogue of figures the overview can show, and how a saved choice
 *  resolves against it.
 *
 * The catalogue is CODE, not configuration. Each entry is a value with its
 * own source, its own visibility boundary and its own idea of what "unknown"
 * means; an admin picks from this list rather than describing a new one.
 * Describing new ones is the formula feature, and it is a different problem —
 * this one has no way to fail at runtime.
 *
 * Which is exactly why the saved choice is validated against the catalogue on
 * every read rather than trusted. A setting written by an older or newer
 * build can name a metric this one has never heard of, and the answer is to
 * drop it, not to render an empty tile or throw on the landing screen.
 */

export type MetricId =
  | 'total_power'
  | 'members'
  | 'kills'
  | 'online'
  | 'daily_donation'
  | 'weekly_donation'
  | 'duel_daily'
  | 'duel_weekly'
  | 'duel_round'
  | 'alliance_power'
  | 'alliance_members';

export interface MetricSpec {
  id: MetricId;
  label: string;
  /** What the figure is OF, when the label alone would overclaim. */
  note?: string;
  /** Member-only, so a viewer sees "—" and needs telling why. */
  restricted: boolean;
  /** Big totals read better compacted; counts and levels do not. */
  compact: boolean;
}

/** Order here is the order of the picker, not of the screen. */
export const METRIC_CATALOGUE: readonly MetricSpec[] = [
  {
    id: 'total_power',
    label: 'Power',
    note: 'summed over observed members',
    restricted: false,
    compact: true,
  },
  { id: 'members', label: 'Members', restricted: false, compact: false },
  {
    id: 'kills',
    label: 'Kills',
    note: 'summed over observed members',
    restricted: false,
    compact: true,
  },
  { id: 'online', label: 'Online now', restricted: true, compact: false },
  {
    id: 'daily_donation',
    label: 'Daily Donation',
    note: 'alliance total today',
    restricted: true,
    compact: true,
  },
  {
    id: 'weekly_donation',
    label: 'Weekly Donation',
    note: 'alliance total this week',
    restricted: true,
    compact: true,
  },
  {
    id: 'duel_daily',
    label: 'Duel (Daily)',
    note: 'alliance total',
    restricted: true,
    compact: true,
  },
  {
    id: 'duel_weekly',
    label: 'Duel (Weekly)',
    note: 'alliance total',
    restricted: true,
    compact: true,
  },
  {
    id: 'duel_round',
    label: 'Duel (Rounds)',
    note: 'alliance total, four rounds',
    restricted: true,
    compact: true,
  },
  {
    id: 'alliance_power',
    label: 'Alliance power',
    // Deliberately distinct from total_power. One is the game's figure for
    // the whole roster, the other is the sum of the members a capture has
    // seen, and they disagree by design — offering both without saying which
    // is which would be the trap.
    note: 'as the game reports it',
    restricted: false,
    compact: true,
  },
  {
    id: 'alliance_members',
    label: 'Alliance members',
    note: 'as the game reports it',
    restricted: false,
    compact: false,
  },
];

const KNOWN = new Set<string>(METRIC_CATALOGUE.map((metric) => metric.id));

/** What the overview shows when nobody has chosen. The five it shipped with,
 *  so an install that never opens the settings page sees no change. */
export const DEFAULT_METRICS: readonly MetricId[] = [
  'total_power',
  'members',
  'online',
  'weekly_donation',
  'duel_round',
];

export function specFor(id: MetricId): MetricSpec {
  // Callers only ever pass ids that survived resolveMetrics, so this cannot
  // miss — the non-null assertion is the type system catching up with that.
  return METRIC_CATALOGUE.find((metric) => metric.id === id) as MetricSpec;
}

/** Turn whatever is stored into a list this build can actually render.
 *
 * Unknown ids are dropped rather than rendered blank: a tile with no source
 * is worse than a missing tile, and the reader cannot tell the difference
 * between "we do not compute that any more" and "the number is zero".
 *
 * Duplicates are collapsed — the picker cannot produce them, but a
 * hand-edited setting can, and two identical tiles look like a bug.
 *
 * An empty or unusable setting falls back to the default rather than showing
 * nothing. Someone who genuinely wants no tiles is not a case worth serving
 * at the cost of a blank landing screen after a bad save.
 */
export function resolveMetrics(stored: unknown): MetricId[] {
  const list = Array.isArray(stored) ? stored : [];
  const seen = new Set<string>();
  const resolved = list.filter(
    (id): id is MetricId =>
      typeof id === 'string' && KNOWN.has(id) && !seen.has(id) && seen.add(id) !== undefined,
  );
  return resolved.length > 0 ? resolved : [...DEFAULT_METRICS];
}
