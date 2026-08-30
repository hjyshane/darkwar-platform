// The season building rule, read by the screens rather than by the scorer.
//
// `build_rank_period` (0159) reads the same numbers out of the same setting to
// adjust a score. This is the copy the admin page reads so it can show what
// the rule will do BEFORE a period is rebuilt — and so the wording on the page
// cannot drift from the arithmetic in the function.
//
// The two must stay in step; the setting is the single place they meet. Same
// arrangement, and the same reason, as `rankMinimums.ts` beside 0155.

import { useQuery } from '@tanstack/react-query';
import { TIERS_SETTING_KEY } from './rankMinimums';
import { supabase } from './supabase';

export interface SeasonLab {
  enabled: boolean;
  /** ISO instants. Null means the window has no such edge yet, which makes it
   * closed rather than open — an absent start date must not read as "since the
   * beginning of time". The function defaults the same way. */
  startsAt: string | null;
  endsAt: string | null;
  /** Not fixed to the thermal lab. Next season is a different building, and
   * the id is part of the setting for exactly that reason. */
  buildingId: number | null;
  /** 0 means no threshold on that side, which is not the same as a threshold
   * of zero: `level >= 0` would be true for everybody. */
  low: number;
  high: number;
  /** Points on the 0–100 score, not tiers. */
  penalty: number;
  bonus: number;
}

export const NO_SEASON_LAB: SeasonLab = {
  enabled: false,
  startsAt: null,
  endsAt: null,
  buildingId: null,
  low: 0,
  high: 0,
  penalty: 0,
  bonus: 0,
};

function positive(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function instant(value: unknown): string | null {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
}

/** A setting edited by hand is not the same as a setting that parses. Anything
 * unreadable falls back to "no rule" rather than throwing: a broken number
 * must not put a penalty against people's names, and it must not make the
 * admin page unopenable — the page is where it would be fixed. */
export function parseSeasonLab(value: unknown): SeasonLab {
  if (typeof value !== 'object' || value === null) {
    return NO_SEASON_LAB;
  }
  const block = (value as { season_lab?: unknown }).season_lab;
  if (typeof block !== 'object' || block === null) {
    return NO_SEASON_LAB;
  }
  const raw = block as Record<string, unknown>;
  return {
    enabled: raw.enabled === true,
    startsAt: instant(raw.starts_at),
    endsAt: instant(raw.ends_at),
    buildingId: typeof raw.building_id === 'number' ? raw.building_id : null,
    low: positive(raw.low),
    high: positive(raw.high),
    penalty: positive(raw.penalty),
    bonus: positive(raw.bonus),
  };
}

/** Whether a fortnight is scored by the season rule.
 *
 * THE PERIOD'S START DECIDES, not today and not the period's end, so a
 * fortnight is never half one rule and half the other. Half-open: a period
 * opening exactly at `endsAt` is the first one after the season.
 *
 * A missing date closes the window rather than opening it, which is why both
 * comparisons are written against the date being present.
 */
export function seasonLabApplies(config: SeasonLab, periodStart: Date): boolean {
  if (!config.enabled || config.startsAt === null || config.endsAt === null) {
    return false;
  }
  const at = periodStart.getTime();
  return at >= Date.parse(config.startsAt) && at < Date.parse(config.endsAt);
}

/** Points this level adds to or takes off the score.
 *
 * A LEVEL NOBODY HAS SEEN IS NOT A LOW LEVEL — null costs nothing. An empty
 * cell on the building board is a gap in our sweep, not a member who built
 * nothing, and the scorer applies the same rule. A screen that disagreed with
 * it would accuse people the rank never touched.
 */
export function labAdjustment(level: number | null, config: SeasonLab): number {
  if (level === null) return 0;
  if (config.low > 0 && level < config.low) return -config.penalty;
  if (config.high > 0 && level >= config.high) return config.bonus;
  return 0;
}

export async function fetchSeasonLab(): Promise<SeasonLab> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', TIERS_SETTING_KEY)
    .maybeSingle();
  if (error) {
    if (error.code === '42501') {
      return NO_SEASON_LAB;
    }
    throw new Error(`season building setting query failed: ${error.message}`);
  }
  return parseSeasonLab(data?.value);
}

export function useSeasonLab() {
  return useQuery({ queryKey: ['season-lab'], queryFn: fetchSeasonLab });
}
