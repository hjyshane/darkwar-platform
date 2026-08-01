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
  | 'dashboard'
  | 'rankings'
  | 'crossRankings'
  | 'arena'
  | 'server'
  | 'monthCards'
  | 'login';

const ROUTES: Record<string, Route> = {
  '#/rankings': 'rankings',
  '#/cross-server': 'crossRankings',
  '#/arena': 'arena',
  '#/month-cards': 'monthCards',
  '#/login': 'login',
};

// The one address that carries a value. Digits only: a server id is a
// number, and anything else falls through to the dashboard rather than
// reaching a query.
const SERVER_HASH = /^#\/server\/(\d+)$/;

export function routeFromHash(hash: string): Route {
  if (SERVER_HASH.test(hash)) {
    return 'server';
  }
  return ROUTES[hash] ?? 'dashboard';
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
  { route: 'dashboard', hash: '#/', label: 'Members' },
  { route: 'rankings', hash: '#/rankings', label: 'Alliance Ranking' },
  { route: 'crossRankings', hash: '#/cross-server', label: 'Cross-Server' },
  { route: 'arena', hash: '#/arena', label: 'Arena' },
];
