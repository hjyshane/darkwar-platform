// Not a router — a gate plus a tab bar.
//
// The month-card page is deliberately unlinked from the dashboard: you get
// there by typing the address. The address is NOT the security boundary
// (RLS on player_month_cards is; a non-admin who finds the URL sees an
// empty page) — keeping it out of the navigation just keeps finance out of
// the room where gameplay is discussed.
//
// The gameplay screens ARE linked, one route each. They were a single
// stacked page, which meant every visit fetched four panels to read one and
// scrolled past three to reach the fourth. Splitting them also gives the
// spec's eventual ten tabs (FR-UI-004) somewhere to land.
//
// Hash-based so it works on any static host with zero rewrite config.

export type Route =
  | 'overview'
  | 'members'
  | 'rankings'
  | 'crossRankings'
  | 'arena'
  | 'server'
  | 'player'
  | 'alliance'
  | 'admin'
  | 'monthCards'
  | 'guides'
  | 'guide'
  | 'notices'
  | 'notice'
  | 'mine'
  | 'login';

const ROUTES: Record<string, Route> = {
  '#/members': 'members',
  '#/rankings': 'rankings',
  '#/cross-server': 'crossRankings',
  '#/arena': 'arena',
  '#/month-cards': 'monthCards',
  '#/mine': 'mine',
  '#/guides': 'guides',
  '#/notices': 'notices',
  '#/login': 'login',
};

/** Settings is one route with several screens under it.
 *
 * Twelve settings on one page meant twelve queries on every visit and no way
 * to link somebody to one of them. The groups are named after what an admin
 * came to do, not after the tables underneath — Heroes and Pets are a
 * catalogue somebody types into, which is why they are not "settings".
 */
export type AdminGroup = 'access' | 'alliance' | 'display' | 'catalogue' | 'operations';

export const ADMIN_GROUPS: ReadonlyArray<{ group: AdminGroup; label: string }> = [
  { group: 'access', label: 'Access' },
  { group: 'alliance', label: 'Alliance' },
  { group: 'display', label: 'Display' },
  { group: 'catalogue', label: 'Catalogue' },
  { group: 'operations', label: 'Operations' },
];

// Built from the list above so a new group is one edit, not two that can
// disagree. A group this does not name falls through to the landing screen,
// the same as `#/arena/extra` — an invented address should not silently
// render Access and look like it worked.
const ADMIN_HASH = new RegExp(`^#/admin(?:/(${ADMIN_GROUPS.map((g) => g.group).join('|')}))?$`);

/** The group an `#/admin/...` address names, or null for any other address.
 *
 * Bare `#/admin` is Access: that address predates the groups and is in
 * people's history and in the nav. */
export function adminGroupFromHash(hash: string): AdminGroup | null {
  const match = ADMIN_HASH.exec(hash);
  return match === null ? null : ((match[1] as AdminGroup | undefined) ?? 'access');
}

export function adminHash(group: AdminGroup): string {
  return `#/admin/${group}`;
}

// The one address that carries a value. Digits only: a server id is a
// number, and anything else falls through to the landing screen rather than
// reaching a query.
const SERVER_HASH = /^#\/server\/(\d+)$/;

// A player and an alliance are addressed by their uuid rather than a name:
// names change (player_names exists for that reason) and are not unique
// across servers. Matched strictly, so a malformed id falls through to the
// landing screen instead of reaching a query as a string.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PLAYER_HASH = new RegExp(`^#/player/(${UUID})$`, 'i');
const ALLIANCE_HASH = new RegExp(`^#/alliance/(${UUID})$`, 'i');
// One post, on either board. Both are `#/<board>/<uuid>` so a member can send
// somebody a link to the thing itself rather than to the list it is on.
const GUIDE_HASH = new RegExp(`^#/guides/(${UUID})$`, 'i');
const NOTICE_HASH = new RegExp(`^#/notices/(${UUID})$`, 'i');

export function routeFromHash(hash: string): Route {
  if (ADMIN_HASH.test(hash)) {
    return 'admin';
  }
  if (SERVER_HASH.test(hash)) {
    return 'server';
  }
  if (PLAYER_HASH.test(hash)) {
    return 'player';
  }
  if (ALLIANCE_HASH.test(hash)) {
    return 'alliance';
  }
  if (GUIDE_HASH.test(hash)) {
    return 'guide';
  }
  if (NOTICE_HASH.test(hash)) {
    return 'notice';
  }
  return ROUTES[hash] ?? 'overview';
}

/** The player a `#/player/<uuid>` address names, or null for any other. */
export function playerIdFromHash(hash: string): string | null {
  return PLAYER_HASH.exec(hash)?.[1] ?? null;
}

/** The alliance an `#/alliance/<uuid>` address names, or null. */
export function allianceIdFromHash(hash: string): string | null {
  return ALLIANCE_HASH.exec(hash)?.[1] ?? null;
}

export function playerHash(playerId: string): string {
  return `#/player/${playerId}`;
}

export function guideIdFromHash(hash: string): string | null {
  return GUIDE_HASH.exec(hash)?.[1] ?? null;
}

export function noticeIdFromHash(hash: string): string | null {
  return NOTICE_HASH.exec(hash)?.[1] ?? null;
}

export function guideHash(guideId: string): string {
  return `#/guides/${guideId}`;
}

export function noticeHash(noticeId: string): string {
  return `#/notices/${noticeId}`;
}

export function allianceHash(allianceId: string): string {
  return `#/alliance/${allianceId}`;
}

/** The server a `#/server/580` address names, or null for any other. */
export function serverIdFromHash(hash: string): number | null {
  const match = SERVER_HASH.exec(hash);
  return match === null ? null : Number(match[1]);
}

export function serverHash(serverId: number): string {
  return `#/server/${serverId}`;
}

/** Tabs shown in the nav, in order. Excludes month-cards (unlinked above)
 *  and login, which is an account action rather than a screen. */
export const NAV_TABS: ReadonlyArray<{ route: Route; hash: string; label: string }> = [
  // `#/` is the overview, and Members moved to its own address. The roster
  // was the landing screen because it was the first screen that existed,
  // not because a hundred rows of figures is what you want to be handed
  // first — the overview answers "how are we doing" before the table
  // answers "who did what".
  { route: 'overview', hash: '#/', label: 'Overview' },
  { route: 'members', hash: '#/members', label: 'Members' },
  { route: 'rankings', hash: '#/rankings', label: 'Alliance Ranking' },
  { route: 'crossRankings', hash: '#/cross-server', label: 'Cross-Server' },
  { route: 'arena', hash: '#/arena', label: 'Arena' },
  // Last, because it is the one tab that is not a board the game produced —
  // everything left of it is observation, and this is what the alliance wrote
  // about it.
  { route: 'notices', hash: '#/notices', label: 'Notices' },
  { route: 'guides', hash: '#/guides', label: 'Guides' },
];
