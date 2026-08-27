// The alliance's weekly floor, read by the screens rather than by the scorer.
//
// `build_rank_period` (0155) reads the same numbers out of the same setting to
// decide a tier. This is the copy the tables read so they can mark a weekly
// reading that is under the floor while the fortnight is still running —
// before the scorer ever sees it, and before anybody's rank moves.
//
// The two must stay in step; the setting is the single place they meet.

import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

export const TIERS_SETTING_KEY = 'rank_tiers';

export interface RankMinimums {
  enabled: boolean;
  /** 0 means no floor on that board, which is not the same as a floor of zero. */
  donationWeekly: number;
  duelWeekly: number;
}

export const NO_MINIMUMS: RankMinimums = {
  enabled: false,
  donationWeekly: 0,
  duelWeekly: 0,
};

function positive(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** A setting edited by hand is not the same as a setting that parses. Anything
 * unreadable falls back to "no floor" rather than throwing: a broken number
 * must not put red marks against people's names. */
export function parseMinimums(value: unknown): RankMinimums {
  if (typeof value !== 'object' || value === null) {
    return NO_MINIMUMS;
  }
  const mins = (value as { minimums?: unknown }).minimums;
  if (typeof mins !== 'object' || mins === null) {
    return NO_MINIMUMS;
  }
  const raw = mins as { enabled?: unknown; donation_weekly?: unknown; duel_weekly?: unknown };
  return {
    enabled: raw.enabled === true,
    donationWeekly: positive(raw.donation_weekly),
    duelWeekly: positive(raw.duel_weekly),
  };
}

export async function fetchMinimums(): Promise<RankMinimums> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', TIERS_SETTING_KEY)
    .maybeSingle();
  if (error) {
    if (error.code === '42501') {
      return NO_MINIMUMS;
    }
    throw new Error(`rank minimum setting query failed: ${error.message}`);
  }
  return parseMinimums(data?.value);
}

export function useRankMinimums() {
  return useQuery({ queryKey: ['rank-minimums'], queryFn: fetchMinimums });
}

/** Whether a weekly reading is under the floor.
 *
 * A MISSING READING IS NOT UNDER IT. Week two of a running fortnight has not
 * happened, and a week the collector missed is not evidence of anything — the
 * scorer applies the same rule (0155), and a screen that disagreed with it
 * would accuse people the rank never touched.
 */
export function underFloor(reading: number | null, floor: number): boolean {
  return reading !== null && floor > 0 && reading < floor;
}
