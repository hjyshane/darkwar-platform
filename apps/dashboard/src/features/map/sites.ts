// Season sites worth a march: the floating lanterns hiding a Large Treasure
// Spot, and the spots already open (0315).
//
// Pure functions first (which site counts, what to call it), the query at the
// bottom, as hunt.ts does for trucks and missions. The content rule is the
// view's `cat_group`: the hundreds of the client's lucky_cats key, fixed from
// the moment a lantern spawns, so an unlit lantern already says what it hides.

import type { Coordinate } from '@dw/ui';
import { useQuery } from '@tanstack/react-query';
import { shareCoordinate } from '../../lib/shareCoordinate';
import { supabase } from '../../lib/supabase';

/** `cat_id / 100` for a Large Treasure Spot. The other groups this season are
 * 11 scrap, 12 Jizo, 13 Kitsune and 14 Daruma statues, none of them pinned. */
export const LARGE_TREASURE_GROUP = 15;

/** The game's `status` for a lantern nobody has lit yet. 0 lit, 1 revealing
 * and 2 open follow; anything but 3 means somebody is already on it. */
export const SITE_UNLIT = 3;

export interface TreasureSite {
  siteUuid: string;
  serverId: number;
  /** The tile the viewport put it on: where our map draws it. */
  at: Coordinate;
  /** The coordinate the game shows for it, one less on both axes: what a
   * player types to jump there. From the view, which owns that rule. */
  gameAt: Coordinate;
  status: number;
  expiresAt: Date;
  revealedAt: Date | null;
  limitSeconds: number | null;
  participants: number;
}

export function isUnlit(site: Pick<TreasureSite, 'status'>): boolean {
  return site.status === SITE_UNLIT;
}

/** When an open site closes: its hour from the reveal, or the expiry when it
 * has not been revealed. */
export function closesAt(
  site: Pick<TreasureSite, 'expiresAt' | 'revealedAt' | 'limitSeconds'>,
): Date {
  if (site.revealedAt !== null && site.limitSeconds !== null) {
    const end = new Date(site.revealedAt.getTime() + site.limitSeconds * 1000);
    return end < site.expiresAt ? end : site.expiresAt;
  }
  return site.expiresAt;
}

export function siteIsStanding(site: TreasureSite, now: Date): boolean {
  return closesAt(site).getTime() > now.getTime();
}

/** `#580[X:456 Y:261]`, the game's own share form, so it can be pasted back in. */
export function shareLabel(site: Pick<TreasureSite, 'serverId' | 'gameAt'>): string {
  return shareCoordinate(site.serverId, site.gameAt);
}

/** One line for a pin's tooltip. */
export function siteTitle(site: TreasureSite): string {
  const state = isUnlit(site)
    ? 'unlit lantern'
    : site.status === 2
      ? `open · ${site.participants} exploring`
      : 'being lit';
  return `Large Treasure Spot · ${shareLabel(site)} · ${state}`;
}

type SiteRow = {
  site_uuid: string | null;
  server_id: number | null;
  x: number | null;
  y: number | null;
  game_x: number | null;
  game_y: number | null;
  status: number | null;
  expires_at: string | null;
  revealed_at: string | null;
  limit_seconds: number | null;
  participant_count: number | null;
};

/** A row is dropped, not guessed at, when it lacks what the rules need. */
export function siteFromRow(row: SiteRow): TreasureSite | null {
  if (
    row.site_uuid === null ||
    row.server_id === null ||
    row.x === null ||
    row.y === null ||
    row.game_x === null ||
    row.game_y === null ||
    row.status === null ||
    row.expires_at === null
  ) {
    return null;
  }
  return {
    siteUuid: row.site_uuid,
    serverId: row.server_id,
    at: { x: row.x, y: row.y },
    gameAt: { x: row.game_x, y: row.game_y },
    status: row.status,
    expiresAt: new Date(row.expires_at),
    revealedAt: row.revealed_at === null ? null : new Date(row.revealed_at),
    limitSeconds: row.limit_seconds,
    participants: row.participant_count ?? 0,
  };
}

const REFRESH_MS = 60_000;

export async function fetchTreasureSites(serverId: number): Promise<TreasureSite[]> {
  const { data, error } = await supabase
    .from('season_sites_live')
    .select(
      'site_uuid, server_id, x, y, game_x, game_y, status, expires_at, revealed_at, limit_seconds, participant_count',
    )
    .eq('server_id', serverId)
    .eq('cat_group', LARGE_TREASURE_GROUP)
    .order('expires_at', { ascending: true });
  if (error) {
    if (error.code === '42501') return [];
    throw new Error(`treasure sites query failed: ${error.message}`);
  }
  const sites: TreasureSite[] = [];
  for (const row of data ?? []) {
    const site = siteFromRow(row);
    if (site !== null) sites.push(site);
  }
  return sites;
}

export function useTreasureSites(serverId: number | null) {
  return useQuery({
    queryKey: ['map', 'treasure', serverId],
    queryFn: () => fetchTreasureSites(serverId as number),
    enabled: serverId !== null,
    staleTime: REFRESH_MS / 2,
    refetchInterval: REFRESH_MS,
  });
}
