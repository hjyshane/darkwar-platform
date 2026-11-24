// Every screen, declared once (2026-11-24, review stage 2-C).
//
// A screen used to be spelled out in seven places: the Route union and the
// address map (route.ts), the top-tab switch (navSection), the standalone
// list, the community list (communityAccess.tsx), the character-picker list
// (characterGate.ts), the tab-visibility keys (tabVisibility.ts), and the icon
// and title tables (shellNav.ts). Adding one meant finding all seven, and
// missing one failed silently: a screen with no icon, a screen community could
// not open, a screen an admin could not hide.
//
// Now the row below is the whole declaration, and `satisfies` makes every
// field's spelling a compile error rather than a quiet default. The page each
// route draws is in `pages.tsx`, whose table is `Record<Route, …>`: a route
// declared here with no page there does not build.
//
// What stays elsewhere, on purpose: the sidebar's ORDER and grouping
// (route.ts's tab lists and shellNav.ts), which is a layout decision about
// several screens at once rather than a fact about one; and the parsers for
// addresses that carry an id or a sub-tab (route.ts), which this table cannot
// express as a string.

import type { IconName } from './shellNav';

/** Which top-level group of the sidebar a screen sits under. */
export type NavSection = 'overview' | 'alliance' | 'map' | 'events' | 'boards';

export interface RouteDef {
  /** The screen's own address, or null when it carries an id (a player, a
   * post) or a group (settings) and is matched by a pattern in route.ts. */
  readonly hash: string | null;
  /** Older addresses that still land here, so no link anybody sent breaks. */
  readonly aliases?: readonly string[];
  /** The top bar's name for it when no sidebar entry is current. Omitted:
   * "Dark War". English; the breadcrumb translates it. */
  readonly title?: string;
  /** The sidebar icon. Omitted: the overview's. */
  readonly icon?: IconName;
  /** The sidebar group, or null for a screen in none (a player, settings). */
  readonly section: NavSection | null;
  /** No sidebar and NO WALL: a signed-out stranger can open it. Each one is a
   * decision; `route.test.ts` pins the list. */
  readonly standalone?: true;
  /** Open to an account that still owes a character pick. */
  readonly whilePicking?: true;
  /** Offered to a community account (0282). */
  readonly community?: true;
  /** The Settings › Tab visibility choice that hides it (0295), or null for
   * a screen no choice covers. */
  readonly tabKey: string | null;
}

export const ROUTE_DEFS = {
  // ------------------------------------------------------------ overview
  // Where a signed-in member lands (2026-11-18). The bare address stays the
  // overview, so every link to `#/` still lands where it did.
  home: { hash: '#/home', section: 'overview', tabKey: null },
  overview: {
    hash: '#/',
    // In the Admin menu only since 2026-11-19; anybody else who opens one by
    // its address still gets its name in the top bar.
    title: 'Server overview',
    icon: 'overview',
    section: 'overview',
    community: true,
    tabKey: 'overview',
  },
  rankings: {
    hash: '#/rankings',
    title: 'Rankings',
    icon: 'rankings',
    section: 'overview',
    community: true,
    tabKey: 'rankings',
  },
  crossRankings: {
    hash: '#/cross-server',
    title: 'Rankings',
    section: 'overview',
    community: true,
    tabKey: 'rankings',
  },
  arena: {
    hash: '#/arena',
    title: 'Rankings',
    section: 'overview',
    community: true,
    tabKey: 'rankings',
  },
  // Who went where when the servers opened to moves. Officers and admins.
  migration: {
    hash: '#/migration',
    title: 'Migration',
    icon: 'migration',
    section: 'overview',
    community: true,
    tabKey: 'migration',
  },

  // ------------------------------------------------------------ alliance
  members: {
    hash: '#/members',
    title: 'Members',
    icon: 'members',
    section: 'alliance',
    tabKey: 'members',
  },
  hive: { hash: '#/hive', icon: 'hive', section: 'alliance', tabKey: 'hive' },
  // The Events entry: opens the first screen of the arranged strip.
  events: { hash: '#/events', icon: 'blackGold', section: 'alliance', tabKey: 'events' },
  // Black Gold. The id keeps the event's first name because it is STORED:
  // ui_overrides rows (the events hub's order) are keyed by it.
  blackMoney: {
    hash: '#/black-gold',
    // The address it shipped under on 2026-09-27, before the name was fixed.
    aliases: ['#/black-money'],
    icon: 'blackGold',
    section: 'alliance',
    tabKey: 'events',
  },
  frankie: { hash: '#/frankie', icon: 'participation', section: 'alliance', tabKey: 'events' },
  capitalClash: {
    hash: '#/capital-clash',
    icon: 'participation',
    section: 'alliance',
    tabKey: 'events',
  },
  serverClash: {
    hash: '#/server-clash',
    icon: 'participation',
    section: 'alliance',
    tabKey: 'events',
  },
  participation: {
    hash: '#/participation',
    icon: 'participation',
    section: 'alliance',
    tabKey: 'events',
  },
  alarms: {
    hash: '#/alarms',
    // The Schedule screen, archived on 2026-10-03 and replaced by this tab.
    aliases: ['#/schedule'],
    title: 'Alarms',
    icon: 'calendar',
    section: 'alliance',
    tabKey: 'events',
  },
  season: { hash: '#/season', icon: 'season', section: 'alliance', tabKey: 'events' },
  season2: { hash: '#/season2', icon: 'season', section: 'alliance', tabKey: 'events' },
  // Filed under Calculator; named for a reader whose Calculator is hidden.
  planner: {
    hash: '#/planner',
    title: 'Planner',
    icon: 'planner',
    section: 'alliance',
    community: true,
    tabKey: null,
  },
  // Game-wide reference costs, nothing of ours.
  calculator: {
    hash: '#/calculator',
    icon: 'calculator',
    section: 'alliance',
    community: true,
    tabKey: 'calculator',
  },
  // The Merchant tester, a sub-entry under Hive for officers and admins.
  basePlacement: { hash: '#/base-placement', section: 'alliance', tabKey: null },
  giftCodes: {
    hash: '#/gift-codes',
    title: 'Gift codes',
    icon: 'blackGold',
    section: 'alliance',
    tabKey: 'giftCodes',
  },

  // ------------------------------------------------------------ map
  map: { hash: '#/map', icon: 'map', section: 'map', community: true, tabKey: 'map' },

  // ------------------------------------------------------------ the game's events
  calendar: {
    hash: '#/calendar',
    title: 'Game calendar',
    icon: 'calendar',
    section: 'events',
    community: true,
    tabKey: 'calendar',
  },
  eventGuide: {
    hash: '#/event-guide',
    icon: 'guide',
    section: 'events',
    community: true,
    tabKey: 'eventGuide',
  },
  shopValue: {
    hash: '#/shop-value',
    title: 'Shop value',
    icon: 'shop',
    section: 'events',
    community: true,
    tabKey: 'shopValue',
  },

  // ------------------------------------------------------------ boards
  notices: { hash: '#/notices', icon: 'notices', section: 'boards', tabKey: 'notices' },
  notice: { hash: null, title: 'Notice', section: 'boards', tabKey: 'notices' },
  guides: { hash: '#/guides', icon: 'guides', section: 'boards', tabKey: 'guides' },
  guide: { hash: null, title: 'Guide', section: 'boards', tabKey: 'guides' },

  // ------------------------------------------------------------ in no group
  // The pages ranking rows link to. Ours are refused inside, by `useIsOurs`
  // and the policies (0283, 0285).
  player: { hash: null, title: 'Player', section: null, community: true, tabKey: null },
  alliance: {
    hash: null,
    title: 'Alliance',
    section: null,
    community: true,
    tabKey: 'alliance',
  },
  server: { hash: null, title: 'Server', section: null, tabKey: null },
  admin: { hash: null, title: 'Settings', section: null, tabKey: null },
  // Where an account says which character it is, which the planner reads.
  account: {
    hash: '#/account',
    aliases: ['#/account/plans'],
    title: 'My account',
    section: null,
    community: true,
    tabKey: null,
  },

  // ------------------------------------------------------------ outside the wall
  // Unlinked rather than hidden: RLS withholds the rows (see route.ts's head).
  monthCards: {
    hash: '#/month-cards',
    title: 'Month cards',
    section: null,
    standalone: true,
    tabKey: null,
  },
  // Must be readable signed out: Google and Discord fetch them with no session
  // when approving the sign-in buttons, and a person deciding whether to hand
  // over their email has to be able to read them first.
  terms: {
    hash: '#/terms',
    title: 'Terms',
    section: null,
    standalone: true,
    whilePicking: true,
    community: true,
    tabKey: null,
  },
  privacy: {
    hash: '#/privacy',
    title: 'Privacy',
    section: null,
    standalone: true,
    whilePicking: true,
    community: true,
    tabKey: null,
  },
  // The way in; walling it would wall the wall's own link.
  login: {
    hash: '#/login',
    title: 'Sign in',
    section: null,
    standalone: true,
    whilePicking: true,
    community: true,
    tabKey: null,
  },
} as const satisfies Record<string, RouteDef>;

export type Route = keyof typeof ROUTE_DEFS;

export const ALL_ROUTES = Object.keys(ROUTE_DEFS) as Route[];

export function routeDef(route: Route): RouteDef {
  return ROUTE_DEFS[route];
}

/** Every plain address, aliases included, to the route it opens. */
export const ADDRESS_TO_ROUTE: ReadonlyMap<string, Route> = new Map(
  ALL_ROUTES.flatMap((route) => {
    const def = routeDef(route);
    return [def.hash, ...(def.aliases ?? [])]
      .filter((hash): hash is string => hash !== null)
      .map((hash) => [hash, route] as const);
  }),
);
