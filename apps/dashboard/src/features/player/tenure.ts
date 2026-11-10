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
 * when there is none to show.
 *
 * MEMBERSHIP FIRST. The alliance a caller passes usually comes from
 * `players.current_alliance_id`, which is a LAST KNOWN alliance: joining is
 * recorded and leaving never is. Counting days from the first roster row for
 * somebody who has left would print "In alliance 45d" about an ex-member, so
 * the player has to be on `alliance_roster_latest` — the newest roster batch,
 * the only honest answer to "who is in it now" — before any tenure is read.
 *
 * Null also when the reader may not see the history (own-or-officer, 0066):
 * the policy filters the rows away rather than refusing, and a 42501 is
 * treated the same. This is one cell on a page of other facts. */
export async function fetchFirstSeenInAlliance(
  playerId: string,
  allianceId: string,
): Promise<string | null> {
  const [member, first] = await Promise.all([
    supabase
      .from('alliance_roster_latest')
      .select('player_id')
      .eq('alliance_id', allianceId)
      .eq('player_id', playerId)
      .limit(1)
      .maybeSingle(),
    supabase
      .from('alliance_member_snapshots')
      .select('captured_at')
      .eq('player_id', playerId)
      .eq('alliance_id', allianceId)
      .order('captured_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  for (const { error } of [member, first]) {
    if (error && error.code !== '42501') {
      throw new Error(`alliance tenure query failed: ${error.message}`);
    }
  }
  if (member.error || first.error || member.data === null) return null;
  return first.data?.captured_at ?? null;
}
