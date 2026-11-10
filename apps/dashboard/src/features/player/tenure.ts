// "In alliance 45d" — or, for a reader who may not see the roster history,
// the HQ level instead.
//
// `alliance_member_snapshots` is own-or-officer read (0066, 0193). A regular
// member therefore sees tenure only on their own profile; for a teammate the
// policy filters the rows away silently, and the cell falls back to HQ level.
// That is accepted for this project (spec §3) and no gate is widened here.
//
// Bounded by retention: our own rows are kept three months (0070, 0299), so
// "first appearance" is the first one still held, not the day they joined.
// Phase B decides how to say so when the figure sits at the bound.

import { supabase } from '../../lib/supabase';

const DAY_MS = 24 * 60 * 60 * 1000;

export type TenureCell =
  | { kind: 'tenure'; days: number; since: string }
  | { kind: 'hq'; level: number }
  | null;

export function tenureCell(
  firstSeenAt: string | null,
  hqLevel: number | null,
  now: Date,
): TenureCell {
  if (firstSeenAt !== null) {
    const days = Math.max(
      0,
      Math.floor((now.getTime() - new Date(firstSeenAt).getTime()) / DAY_MS),
    );
    return { kind: 'tenure', days, since: firstSeenAt };
  }
  return hqLevel === null ? null : { kind: 'hq', level: hqLevel };
}

/** The oldest roster row still held for this player in this alliance, or null
 * when there is none — whether because they were never on the roster or
 * because the reader may not see it. A 42501 is the same null: this is one
 * cell on a page of other facts. */
export async function fetchFirstSeenInAlliance(
  playerId: string,
  allianceId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('alliance_member_snapshots')
    .select('captured_at')
    .eq('player_id', playerId)
    .eq('alliance_id', allianceId)
    .order('captured_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (error.code === '42501') return null;
    throw new Error(`alliance tenure query failed: ${error.message}`);
  }
  return data?.captured_at ?? null;
}
