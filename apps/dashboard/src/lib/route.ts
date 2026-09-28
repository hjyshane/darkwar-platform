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
  | 'migration'
  | 'season'
  | 'season2'
  | 'map'
  | 'hive'
  | 'blackMoney'
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
  | 'schedule'
  | 'account'
  | 'terms'
  | 'privacy'
  | 'login';

const ROUTES: Record<string, Route> = {
  '#/members': 'members',
  '#/rankings': 'rankings',
  '#/cross-server': 'crossRankings',
  '#/migration': 'migration',
  '#/season': 'season',
  '#/season2': 'season2',
  '#/map': 'map',
  '#/hive': 'hive',
  '#/black-gold': 'blackMoney',
  // The address it shipped under on 2026-09-27, before the name was
  // corrected. Kept so the links sent that day still land.
  '#/black-money': 'blackMoney',
  '#/arena': 'arena',
  '#/month-cards': 'monthCards',
  '#/account': 'account',
  '#/guides': 'guides',
  '#/notices': 'notices',
  '#/schedule': 'schedule',
  // The only two addresses here that a signed-out stranger is MEANT to reach.
  // Everything else on this list is walled; these are marked standalone in
  // `App.tsx` so they are not, because Google and Discord fetch them with no
  // session when approving the sign-in buttons, and because somebody deciding
  // whether to hand over their email has to be able to read them first.
  '#/terms': 'terms',
  '#/privacy': 'privacy',
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
// Two levels now: the group, and optionally which of its sections is open.
// Each settings group held five stacked panels and every one of them queried
// on mount; a section at a time means one address per screen, which is also
// what makes a link to a particular setting possible.
const ADMIN_HASH = new RegExp(
  `^#/admin(?:/(${ADMIN_GROUPS.map((g) => g.group).join('|')})(?:/([a-z0-9-]+))?)?$`,
);

/** The group an `#/admin/...` address names, or null for any other address.
 *
 * Bare `#/admin` is Access: that address predates the groups and is in
 * people's history and in the nav. */
export function adminGroupFromHash(hash: string): AdminGroup | null {
  const match = ADMIN_HASH.exec(hash);
  return match === null ? null : ((match[1] as AdminGroup | undefined) ?? 'access');
}

/** Which section of the group the address names, or null for "the first one".
 *
 * Null rather than a default here on purpose: this file knows the shape of an
 * address, and which section a group starts with is a fact about the settings
 * list. `AdminPage` fills it in from there. */
export function adminSectionFromHash(hash: string): string | null {
  const match = ADMIN_HASH.exec(hash);
  return match?.[2] ?? null;
}

export function adminHash(group: AdminGroup, section?: string): string {
  return section === undefined ? `#/admin/${group}` : `#/admin/${group}/${section}`;
}

// The one address that carries a value. Digits only: a server id is a
// number, and anything else falls through to the landing screen rather than
// reaching a query.
const SERVER_HASH = /^#\/server\/(\d+)$/;

// `#/map` opens on the most recently swept server; `#/map/581` opens on one,
// so a link can point somebody at the ground being fought over this week.
const MAP_HASH = /^#\/map(?:\/(\d+))?$/;

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
  if (MAP_HASH.test(hash)) {
    return 'map';
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

/** The server a `#/map/581` address names, or null for bare `#/map`. */
export function mapServerIdFromHash(hash: string): number | null {
  const match = MAP_HASH.exec(hash);
  return match?.[1] === undefined ? null : Number(match[1]);
}

export function mapHash(serverId?: number): string {
  return serverId === undefined ? '#/map' : `#/map/${serverId}`;
}

/** A tab in any of the navigation rows. Month-cards is in none of them
 * (unlinked above), and login is an account action rather than a screen. */
export interface NavTab {
  route: Route;
  hash: string;
  label: string;
}

/** Which top-level tab a screen sits under.
 *
 * FIVE TOP TABS, each a group with its own second row, because fourteen
 * top-level tabs wrapped to three lines on a phone and put a board nobody opens
 * weekly beside the ones read every day. The addresses did not move — every
 * link anybody has already sent still lands on the same screen — only where
 * the tab for it sits.
 *
 *   overview   the landing screen, and the cross-server boards read against it
 *   alliance   our own alliance: its page, its roster, and the hive plan
 *   map        on its own: one player at a time, and nothing else is like it
 *   events     the scheduled things — season, Black Gold, the calendar
 *   boards     what the alliance writes to itself: notices and guides
 */
export type NavSection = 'overview' | 'alliance' | 'map' | 'events' | 'boards';

/** The top row. Our own alliance's tab is not here — its address carries a
 * uuid only a query knows — and `App.tsx` injects it straight after Overview. */
export const NAV_TABS: ReadonlyArray<NavTab & { section: NavSection }> = [
  { route: 'overview', hash: '#/', label: 'Overview', section: 'overview' },
  { route: 'map', hash: '#/map', label: 'Map', section: 'map' },
  // Points at Season 3 because that is the live one; Season 2 is admin-only
  // and Schedule needs a capability, so neither is safe as the default.
  { route: 'season', hash: '#/season', label: 'Events', section: 'events' },
  { route: 'notices', hash: '#/notices', label: 'Boards', section: 'boards' },
];

/** Overview's second row. The landing screen stays the landing screen; the
 * cross-server boards moved under it because they answer its question — how
 * are we doing — across the whole group rather than for us alone. */
export const OVERVIEW_TABS: ReadonlyArray<NavTab> = [
  { route: 'overview', hash: '#/', label: 'Overview' },
  { route: 'rankings', hash: '#/rankings', label: 'Cross-Server Ranking' },
  // Beside the rankings because it asks the same group-wide question, read
  // across one instant: who went where when the servers opened to moves.
  { route: 'migration', hash: '#/migration', label: 'Migration' },
];

/** Our alliance's second row, after the alliance page itself (whose address
 * needs the uuid, so `App.tsx` puts it first). Hive moved here: it is our
 * alliance's plan, drawn on the map, read by every member on move day. */
export const ALLIANCE_TABS: ReadonlyArray<NavTab> = [
  { route: 'members', hash: '#/members', label: 'Members' },
  { route: 'hive', hash: '#/hive', label: 'Hive' },
];

/** Events' second row. Season 2 is filtered to admins and Schedule to the
 * `schedule.view` capability in `App.tsx`, where the session is known. Each
 * screen keeps its own in-page tabs — Season 3's four boards among them. */
export const EVENT_TABS: ReadonlyArray<NavTab> = [
  { route: 'season', hash: '#/season', label: 'Season 3' },
  { route: 'season2', hash: '#/season2', label: 'Season 2' },
  { route: 'blackMoney', hash: '#/black-gold', label: 'Black Gold' },
  { route: 'schedule', hash: '#/schedule', label: 'Schedule' },
];

/** Boards' second row: what the alliance writes for itself. */
export const BOARD_TABS: ReadonlyArray<NavTab> = [
  { route: 'notices', hash: '#/notices', label: 'Notices' },
  { route: 'guides', hash: '#/guides', label: 'Guides' },
];

/** The top tab a route belongs to, or null for screens that belong to none
 * (a player, another alliance, a server, settings, the account page).
 *
 * Our own alliance's page is decided by the caller, which knows the uuid; a
 * plain `alliance` route here is somebody else's. */
export function navSection(route: Route): NavSection | null {
  switch (route) {
    case 'overview':
    case 'rankings':
    case 'crossRankings':
    case 'arena':
    case 'migration':
      return 'overview';
    case 'members':
    case 'hive':
      return 'alliance';
    case 'map':
      return 'map';
    case 'season':
    case 'season2':
    case 'blackMoney':
    case 'schedule':
      return 'events';
    case 'notices':
    case 'notice':
    case 'guides':
    case 'guide':
      return 'boards';
    default:
      return null;
  }
}

/** The three boards behind Cross-Server Ranking — a third row, under Overview's.
 *
 * Their addresses do not change. Grouping them is a navigation decision, and
 * rewriting `#/cross-server` to `#/rankings/players` would break every link
 * anybody has already sent and buy nothing — the capability gate on Arena
 * (0064) keys on the route, not on where the tab sits.
 */
export const RANKING_TABS: ReadonlyArray<{ route: Route; hash: string; label: string }> = [
  { route: 'rankings', hash: '#/rankings', label: 'Alliance Ranking' },
  // Renamed from "Cross-Server": beside "Alliance Ranking" the old name said
  // which servers rather than which subject, and both boards are cross-server.
  { route: 'crossRankings', hash: '#/cross-server', label: 'Player Ranking' },
  { route: 'arena', hash: '#/arena', label: 'Arena' },
];

/** Whether a route sits behind the Cross-Server Ranking tab. */
export function isRankingRoute(route: Route): boolean {
  return RANKING_TABS.some((tab) => tab.route === route);
}

/** Screens that render without the tab bar — and without the members-only wall.
 *
 * TWO EFFECTS, ONE FLAG, and the second is the one that matters. `App.tsx`
 * computes `walled` as `!standalone && not a member`, so adding a route here
 * makes it PUBLIC. That is deliberate for all four:
 *
 *   login          the way in; walling it would wall the wall's own link
 *   monthCards     unlinked rather than hidden; RLS withholds the rows
 *   terms/privacy  must be readable signed out — Google and Discord fetch
 *                  them with no session when approving the sign-in buttons,
 *                  and a person deciding whether to hand over their email
 *                  address cannot be asked to sign in first to find out what
 *                  happens to it
 *
 * It lives here rather than inline in `App.tsx` so the list can be asserted:
 * a fifth route added by habit is a screen quietly published.
 */
export function isStandaloneRoute(route: Route): boolean {
  return route === 'login' || route === 'monthCards' || route === 'terms' || route === 'privacy';
}
