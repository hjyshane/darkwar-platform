// Where a player's city was the last time the collector looked at it.
//
// The map is not a service anybody can query. A tile is only in
// `world_city_snapshots` because somebody physically panned the collector
// over it, so a location is a SIGHTING with a timestamp, never a live
// position. Everything here exists to keep that distinction on the screen.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

/** How old a sighting may be before it stops being an answer.
 *
 * A day, because that is the rhythm the alliance works to: the server it
 * duels this week gets swept, and a position from before that sweep predates
 * whatever moved. Bases genuinely relocate — 580 of 1,643 tracked cities
 * changed coordinates over two and a half weeks — so a stale reading is not
 * a slightly worse answer, it is a wrong one.
 */
export const LOCATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface PlayerLocation {
  x: number;
  y: number;
  serverId: number;
  capturedAt: string;
  /** When the shield ends, as of this sighting (0262). Null when never shielded
   * or not read; in the past once it is down. */
  shieldEndAt: string | null;
}

export type LocationState =
  | { kind: 'known'; at: PlayerLocation }
  /** Seen once, but too long ago to trust. The sighting is carried anyway:
   * "last seen at 491,444 three days ago" is worth more than silence, as
   * long as the screen does not present it as current. */
  | { kind: 'stale'; at: PlayerLocation }
  /** No tile for this player has ever been swept. */
  | { kind: 'unknown' };

export function stateOf(
  location: PlayerLocation | null,
  now: Date,
  maxAgeMs: number = LOCATION_MAX_AGE_MS,
): LocationState {
  if (location === null) {
    return { kind: 'unknown' };
  }
  const age = now.getTime() - new Date(location.capturedAt).getTime();
  return age <= maxAgeMs ? { kind: 'known', at: location } : { kind: 'stale', at: location };
}

/** The newest city sighting for one player.
 *
 * Ordered and limited rather than reduced client-side: this is one player,
 * and `world_city_snapshots` carries a row per sighting per pan — hundreds
 * for a member the collector passes often.
 */
export async function fetchPlayerLocation(playerId: string): Promise<PlayerLocation | null> {
  const { data, error } = await supabase
    .from('world_city_snapshots')
    .select('x, y, server_id, captured_at, shield_end_at')
    .eq('player_id', playerId)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    // A reader the gate turns away gets "unknown", not an error page — the
    // location is one tile on a page full of other facts.
    if (error.code === '42501') {
      return null;
    }
    throw new Error(`player location query failed: ${error.message}`);
  }
  if (data === null || data.x === null || data.y === null || data.captured_at === null) {
    return null;
  }
  return {
    x: data.x,
    y: data.y,
    serverId: data.server_id,
    capturedAt: data.captured_at,
    shieldEndAt: data.shield_end_at,
  };
}

export function usePlayerLocation(playerId: string) {
  return useQuery({
    queryKey: ['player-location', playerId],
    queryFn: () => fetchPlayerLocation(playerId),
    // A sighting only changes when somebody sweeps, which is not often.
    staleTime: 10 * 60_000,
  });
}

/** `491, 444` — the coordinate as the game writes it. */
export function formatCoordinate(at: PlayerLocation): string {
  return `${at.x}, ${at.y}`;
}

/** How old a sighting may be before "no shield" stops being an answer.
 *
 * Far shorter than the location's day: a shield is eight hours at the least and
 * a base can raise one the minute after the sweep. A reading older than this
 * that shows the shield down is "may be up now", never "down". */
export const SHIELD_MAX_AGE_MS = 3 * 60 * 60 * 1000;

export type ShieldState =
  /** Nobody has swept this player's ground. */
  | { kind: 'unknown' }
  /** The sighting has the shield running and it has not ended yet. It can be
   * extended, so this is "until at least", as of the sighting. */
  | { kind: 'up'; endsAt: Date }
  /** Down at a sighting recent enough to trust. `since` is when it ended, or
   * null when it was never shielded. */
  | { kind: 'down'; since: Date | null }
  /** The shield had ended or was never seen, but the reading is old: it may
   * have been raised again since. */
  | { kind: 'maybe'; since: Date | null };

export function shieldStateOf(location: PlayerLocation | null, now: Date): ShieldState {
  if (location === null) {
    return { kind: 'unknown' };
  }
  const end = location.shieldEndAt === null ? null : new Date(location.shieldEndAt);
  if (end !== null && end.getTime() > now.getTime()) {
    return { kind: 'up', endsAt: end };
  }
  const age = now.getTime() - new Date(location.capturedAt).getTime();
  return age <= SHIELD_MAX_AGE_MS ? { kind: 'down', since: end } : { kind: 'maybe', since: end };
}
