// What the sidebar and the top bar show, as plain data (the shell, 2026-10-08).
//
// The old header was two rows of tabs: a top row of sections and a second row of
// the screens in them. The sidebar lists every screen at once, grouped by what
// you came to do, so the grouping lives here rather than in the markup. Pure
// functions only: which screen is current, which entries a role may see, and
// what the status line says are decisions worth testing without a DOM.
//
// THE ADDRESSES DID NOT MOVE. Every link anybody has sent still lands on the
// same screen; only where its entry sits changed.
//
// ONE MENU SINCE 2026-11-19 (see buildNav): the note below is how officers and
// admins were grouped until then, kept because the addresses it names are
// still the addresses.
//
// REGROUPED 2026-11-08. Our alliance's entry (named after the alliance, "CBFW")
// used to hold the alliance page's views, with Members, Hive and Events beside
// it. Now the entry holds four screens: Overview (the alliance page itself, with
// its views as the page's own strip), Members, Hive and Events. It opens the
// first of them. Again, no address moved: `#/members`, `#/hive`, `#/events` and
// `#/alliance/<uuid>/<view>` are what they were.

import {
  ADMIN_GROUPS,
  ALLIANCE_TABS,
  ALLIANCE_VIEWS,
  type AdminGroup,
  type AllianceView,
  CALCULATOR,
  type CalculatorTab,
  EVENTS_HUB_TABS,
  EVENT_GUIDE_TABS,
  EVENT_TABS,
  type EventGuideTab,
  HIVE,
  type HiveTab,
  MEMBERS,
  MERCHANT_TESTER,
  type MembersTab,
  OVERVIEW_TABS,
  RANKING_TABS,
  type Route,
  adminHash,
  allianceHash,
  eventGuideHash,
  eventsTabOffered,
  isEventGuideTabOpen,
  isRankingRoute,
  merchantTesterOffered,
} from './route';
import type { Season } from './seasons';
import { NO_OVERRIDES, type Overrides, arrange, isHidden, labelOf } from './uiOverrides';

export type IconName =
  | 'overview'
  | 'rankings'
  | 'migration'
  | 'map'
  | 'alliance'
  | 'members'
  | 'hive'
  | 'season'
  | 'blackGold'
  | 'participation'
  | 'planner'
  | 'calculator'
  | 'calendar'
  | 'guide'
  | 'shop'
  | 'notices'
  | 'guides'
  | 'settings'
  | 'account';

/** A screen's own tabs, listed under it in the sidebar while it is open. Each
 * has an address of its own, so a click lands on the tab and not on the screen's
 * first one. */
export interface NavChild {
  key: string;
  href: string;
  label: string;
  current: boolean;
  /** A screen of its own filed under the entry, not one of the entry's tabs:
   * the top bar names it after the entry (`Menu › CBFW › Black Gold`). */
  screen?: boolean;
  /** A caption the sidebar draws above this child, opening a run of children
   * that belong together ("Events", "Seasons" under the alliance). Drawn only:
   * it is not a link and Ctrl+K does not list it. */
  heading?: string;
  /** The screen's own tabs, for a child that is a screen. The sidebar has two
   * levels and does not draw them — the page carries its own strip — but
   * Ctrl+K still finds each (`Guides › Event guide › Alliance Duel`). */
  tabs?: NavChild[];
}

export interface NavItem {
  key: string;
  href: string;
  label: string;
  icon: IconName;
  current: boolean;
  /** Present only on a screen that has tabs. The sidebar draws them while the
   * screen is current: clicking the screen opens its main page, and the tabs
   * unfold beneath it. */
  children?: NavChild[];
}

export interface NavGroup {
  id: 'watch' | 'alliance' | 'events' | 'boards' | 'admin' | 'officer';
  label: string;
  items: NavItem[];
}

export interface NavContext {
  route: Route;
  /** The alliance in the address, for the `alliance` route. */
  allianceId: string | null;
  /** The alliance whose entry is shown, or null while it is not known. */
  own: { alliance_id: string; label: string } | null;
  /** Undefined while the permission grid has not answered: treated as "not yet",
   * because drawing an entry and taking it away is worse than one that arrives
   * a beat late. Hiding withholds nothing; RLS does that. */
  mayViewMembers: boolean | undefined;
  isAdmin: boolean;
  isOfficer: boolean;
  /** A `community` account (0282): outside the alliance, offered the game-wide
   * screens only. Everything that is about our alliance is left out. */
  isCommunity?: boolean;
  /** Whether the reader's role sees a tab, as an admin set it in Settings (0295).
   * Hides only: absent means every tab, and it never shows what a gate withholds. */
  tabShown?: (tab: string) => boolean;
  /** Names, order and visibility an admin set on the page (0279). */
  overrides?: Overrides;
  /** Season names by address (`#/season`), from the seasons table. */
  seasonNames: Readonly<Record<string, string | undefined>>;
  /** The event guide tab in the address; the first when it names none. */
  eventGuideTab?: EventGuideTab;
  /** The tab each screen has open, read from the address. A screen's own first
   * tab when the address names none. */
  tabs?: {
    members?: MembersTab;
    hive?: HiveTab;
    calculator?: CalculatorTab;
    alliance?: AllianceView;
  };
  /** Whether the reader may plan the hive. Its tabs are for planners only:
   * everybody else sees the plan and nothing else. Undefined while unknown. */
  mayPlanHive?: boolean | undefined;
  /** Whether the Arena board is open to this reader. Undefined while unknown. */
  mayViewArena?: boolean | undefined;
  /** Whether this reader holds `giftcodes.manage` (0251). Undefined while unknown. */
  mayManageGiftCodes?: boolean | undefined;
}

const ICONS: Partial<Record<Route, IconName>> = {
  overview: 'overview',
  rankings: 'rankings',
  migration: 'migration',
  map: 'map',
  members: 'members',
  hive: 'hive',
  season: 'season',
  season2: 'season',
  blackMoney: 'blackGold',
  events: 'blackGold',
  participation: 'participation',
  alarms: 'calendar',
  frankie: 'participation',
  capitalClash: 'participation',
  serverClash: 'participation',
  planner: 'planner',
  calculator: 'calculator',
  giftCodes: 'blackGold',
  calendar: 'calendar',
  eventGuide: 'guide',
  shopValue: 'shop',
  notices: 'notices',
  guides: 'guides',
};

const iconFor = (route: Route): IconName => ICONS[route] ?? 'overview';

/** The three ranking boards, each its own address. Arena only where the reader
 * may see it, and not before that is known: an entry that arrives and is taken
 * away is worse than one that arrives a beat late. */
function rankingBoards(ctx: NavContext): NavChild[] {
  return RANKING_TABS.filter((board) => board.route !== 'arena' || ctx.mayViewArena === true).map(
    (board) => ({
      key: board.hash,
      href: board.hash,
      label: board.label,
      current: board.route === ctx.route,
    }),
  );
}

/** What sits under Calculator (owner, 2026-11-20): its pages, then the
 * planner, which is a screen of its own filed here. The planner had been
 * archived since 2026-11-12; the wait-time page came off the season board. */
function calculatorChildren(ctx: NavContext): NavChild[] {
  return [
    ...CALCULATOR.tabs.map((entry) => ({
      key: CALCULATOR.hash(entry.id),
      href: CALCULATOR.hash(entry.id),
      label: entry.label,
      current: ctx.route === 'calculator' && (ctx.tabs?.calculator ?? 'cost') === entry.id,
    })),
    {
      key: '#/planner',
      href: '#/planner',
      label: 'Planner',
      current: ctx.route === 'planner',
      screen: true,
    },
  ];
}

/** The groups, in the order the sidebar draws them.
 *
 * ONE MENU FOR EVERYBODY IN THE ALLIANCE (owner, 2026-11-19). Members, officers
 * and admins get the same six entries (`buildMemberNav`); an admin gets one more
 * group under them, "Admin menu", holding every screen the six leave out, and
 * an officer a short "Officer menu" with Members and Gift codes. Until
 * that day officers and admins had the full four-group menu and only a plain
 * member the short one. A community account keeps its own (`buildCommunityNav`).
 *
 * No address moved: a screen with no entry still opens from its address or a
 * link, and what a role may READ is RLS's decision, never the menu's. */
export function buildNav(ctx: NavContext): NavGroup[] {
  if (ctx.isCommunity === true) {
    return buildCommunityNav(ctx);
  }
  const menu = buildMemberNav(ctx);
  if (!ctx.isAdmin) {
    const officer = ctx.isOfficer ? buildOfficerMenu(ctx) : [];
    return officer.length === 0
      ? menu
      : [...menu, { id: 'officer' as const, label: 'Officer menu', items: officer }];
  }
  const admin = buildAdminMenu(ctx);
  return admin.length === 0
    ? menu
    : [...menu, { id: 'admin' as const, label: 'Admin menu', items: admin }];
}

/** The officer's extra group (owner, 2026-11-19): the two screens an officer
 * works in that the six entries leave out, each its own entry. Members needs
 * `members.view` and Gift codes `giftcodes.manage`, as they always did, and not
 * before the grid has answered; Tab visibility still hides either. An admin has
 * both under Roster in the Admin menu instead. */
function buildOfficerMenu(ctx: NavContext): NavItem[] {
  const shown = ctx.tabShown ?? (() => true);
  return [
    ...(ctx.mayViewMembers === true && shown('members')
      ? [
          {
            key: '#/members',
            href: '#/members',
            label: 'Members',
            icon: 'members' as const,
            current: ctx.route === 'members',
            children: MEMBERS.tabs.map((entry) => ({
              key: MEMBERS.hash(entry.id),
              href: MEMBERS.hash(entry.id),
              label: entry.label,
              current: ctx.route === 'members' && (ctx.tabs?.members ?? 'settled') === entry.id,
            })),
          },
        ]
      : []),
    ...(ctx.mayManageGiftCodes === true && shown('giftCodes')
      ? [
          {
            key: '#/gift-codes',
            href: '#/gift-codes',
            label: 'Gift codes',
            icon: iconFor('giftCodes'),
            current: ctx.route === 'giftCodes',
          },
        ]
      : []),
  ];
}

/** What a `community` account (0282) is offered: the game-wide screens only.
 * Everything that is about our alliance is left out. */
function buildCommunityNav(ctx: NavContext): NavGroup[] {
  const shown = ctx.tabShown ?? (() => true);
  const watch: NavItem[] = [
    ...OVERVIEW_TABS.filter((tab) => shown(tab.route)).map((tab) => ({
      key: tab.hash,
      href: tab.hash,
      // "Cross-Server Ranking" stands for the three boards behind it, so it
      // stays current on all of them.
      label: tab.route === 'rankings' ? 'Rankings' : tab.label,
      icon: iconFor(tab.route),
      current: tab.route === 'rankings' ? isRankingRoute(ctx.route) : tab.route === ctx.route,
      ...(tab.route === 'rankings' ? { children: rankingBoards(ctx) } : {}),
    })),
    ...(shown('map')
      ? [
          {
            key: '#/map',
            href: '#/map',
            label: 'Map',
            icon: 'map' as const,
            current: ctx.route === 'map',
          },
        ]
      : []),
  ];
  // The calculator, with the planner under it, is what it is given of the
  // alliance's tools.
  const tools: NavItem[] = ALLIANCE_TABS.filter(
    (tab) => tab.route === 'calculator' && shown(tab.route),
  ).map((tab) => ({
    key: tab.hash,
    href: tab.hash,
    label: tab.label,
    icon: iconFor(tab.route),
    // The planner is filed under it, so it stays current there too.
    current: tab.route === ctx.route || ctx.route === 'planner',
    children: calculatorChildren(ctx),
  }));
  const guideTab = ctx.eventGuideTab ?? 'today';
  const events: NavItem[] = EVENT_TABS.filter((tab) => shown(tab.route)).map((tab) => ({
    key: tab.hash,
    href: tab.hash,
    label: tab.label,
    icon: iconFor(tab.route),
    current: tab.route === ctx.route,
    ...(tab.route === 'eventGuide'
      ? {
          children: EVENT_GUIDE_TABS.filter((entry) => isEventGuideTabOpen(entry.id, true)).map(
            (entry) => ({
              key: eventGuideHash(entry.id),
              href: eventGuideHash(entry.id),
              label: entry.label,
              current: ctx.route === 'eventGuide' && guideTab === entry.id,
            }),
          ),
        }
      : {}),
  }));
  return [
    { id: 'watch' as const, label: 'Watch', items: watch },
    { id: 'alliance' as const, label: 'Tools', items: tools },
    { id: 'events' as const, label: 'Events', items: events },
  ].filter((group) => group.items.length > 0);
}

/** The screens behind Events, as the strip above them draws them: the admin's
 * arrangement (0279) — renamed, reordered, hidden ones left out — and only the
 * ones this reader is offered (`eventsTabOffered`). */
function eventScreens(ctx: NavContext): NavChild[] {
  const o = ctx.overrides ?? NO_OVERRIDES;
  const offered = arrange(
    EVENTS_HUB_TABS.filter((entry) => eventsTabOffered(entry.route, ctx)),
    (entry) => entry.route,
    o,
    'events-hub',
  ).filter((entry) => !isHidden(o, 'events-hub', entry.route));
  const screens = offered.map((entry, index) => ({
    route: entry.route,
    key: entry.hash,
    href: entry.hash,
    label: labelOf(o, 'events-hub', entry.route, ctx.seasonNames[entry.hash] ?? entry.label),
    // The bare `#/events` address opens the first of them.
    current: entry.route === ctx.route || (ctx.route === 'events' && index === 0),
    screen: true,
  }));
  // Two runs, each under its own caption (owner, 2026-11-24): the events that
  // come round whatever the season, then the season boards. The admin's order
  // holds inside each run; the strip above the pages still lists them as one.
  const captioned = (run: typeof screens, heading: string): NavChild[] =>
    run.map(({ route: _route, ...child }, index) => (index === 0 ? { ...child, heading } : child));
  return [
    ...captioned(
      screens.filter((entry) => !isSeasonRoute(entry.route)),
      'Events',
    ),
    ...captioned(
      screens.filter((entry) => isSeasonRoute(entry.route)),
      'Seasons',
    ),
  ];
}

/** The season boards among the Events screens: this season's and the last. */
function isSeasonRoute(route: Route): boolean {
  return route === 'season' || route === 'season2';
}

/** The five entries everybody in the alliance sees (owner, 2026-11-24): Home,
 * the alliance's own, Tools, Guides and Map. Until that day there were six:
 * Hive was an entry of its own and Tools was called Calculator. Every other screen keeps its address and
 * opens as before; it is only not offered here (an admin finds them in the
 * Admin menu). An admin's Tab visibility (0295) still hides any of these, and
 * the alliance's page waits for the alliance to be known.
 *
 * UNDER THE ALLIANCE: its page ("Overview"), then EVERY event screen the reader
 * is offered (owner, 2026-11-19). It used to list Participation and Black Gold
 * and no other event, which read as the other events not existing. */
export function buildMemberNav(ctx: NavContext): NavGroup[] {
  const shown = ctx.tabShown ?? (() => true);
  const route = ctx.route;
  const own = ctx.own;
  const onOwn = own !== null && route === 'alliance' && ctx.allianceId === own.alliance_id;

  const guideChildren: NavChild[] = [
    ...(shown('notices')
      ? [
          {
            key: '#/notices',
            href: '#/notices',
            label: 'Notices',
            current: route === 'notices' || route === 'notice',
            screen: true,
          },
        ]
      : []),
    ...(shown('guides')
      ? [
          {
            key: '#/guides',
            href: '#/guides',
            label: 'Alliance guides',
            current: route === 'guides' || route === 'guide',
            screen: true,
          },
        ]
      : []),
    ...(shown('eventGuide')
      ? [
          {
            key: '#/event-guide',
            href: '#/event-guide',
            label: 'Game guide',
            current: route === 'eventGuide',
            screen: true,
            // Its own strip, kept for Ctrl+K so typing "duel" finds the tab.
            tabs: EVENT_GUIDE_TABS.filter((entry) => isEventGuideTabOpen(entry.id, false)).map(
              (entry) => ({
                key: eventGuideHash(entry.id),
                href: eventGuideHash(entry.id),
                label: entry.label,
                current: route === 'eventGuide' && (ctx.eventGuideTab ?? 'today') === entry.id,
              }),
            ),
          },
        ]
      : []),
  ];

  // The planning steps, for planners only: everybody else sees the plan and
  // nothing else. The page carries them as its own strip; here they are kept
  // for Ctrl+K.
  const hiveTabs: NavChild[] =
    ctx.mayPlanHive === true
      ? HIVE.tabs.map((entry) => ({
          key: HIVE.hash(entry.id),
          href: HIVE.hash(entry.id),
          label: entry.label,
          current: route === 'hive' && (ctx.tabs?.hive ?? 'plan') === entry.id,
        }))
      : [];

  const allianceChildren: NavChild[] = [
    ...(own !== null && shown('alliance')
      ? [
          {
            key: 'own-page',
            href: allianceHash(own.alliance_id),
            label: 'Overview',
            current: onOwn,
            screen: true,
            // The page's own strip, kept here for Ctrl+K. Past names are left
            // out (whether there are any is a fact about the data, which the
            // page knows and the sidebar does not); Moves is the admins'.
            tabs: ALLIANCE_VIEWS.filter(
              (view) => view.id !== 'names' && (view.id !== 'moves' || ctx.isAdmin),
            ).map((view) => ({
              key: allianceHash(own.alliance_id, view.id),
              href: allianceHash(own.alliance_id, view.id),
              label: view.label,
              current: onOwn && (ctx.tabs?.alliance ?? 'overview') === view.id,
            })),
          },
        ]
      : []),
    // The hive plan is the alliance's (owner, 2026-11-24): filed here, after
    // the alliance's own page, instead of as an entry of its own.
    ...(shown('hive')
      ? [
          {
            key: '#/hive',
            href: '#/hive',
            label: 'Hive',
            current: route === 'hive',
            screen: true,
            ...(hiveTabs.length > 0 ? { tabs: hiveTabs } : {}),
          },
        ]
      : []),
    // The Merchant tester, for officers and admins (owner, 2026-11-20).
    ...(shown('hive') && merchantTesterOffered(ctx) && ctx.isCommunity !== true
      ? [
          {
            key: MERCHANT_TESTER,
            href: MERCHANT_TESTER,
            label: 'Merchant tester',
            current: route === 'basePlacement',
            screen: true,
          },
        ]
      : []),
    ...(shown('events') ? eventScreens(ctx) : []),
  ];

  const single = (key: string, label: string, icon: IconName, current: boolean): NavItem => ({
    key,
    href: key,
    label,
    icon,
    current,
  });
  const firstGuide = guideChildren[0];
  const firstAlliance = allianceChildren[0];

  const items: NavItem[] = [
    single('#/home', 'Home', 'overview', route === 'home'),
    ...(firstAlliance === undefined
      ? []
      : [
          {
            key: 'own-alliance',
            href: firstAlliance.href,
            label: own?.label ?? 'Alliance',
            icon: 'alliance' as const,
            current: allianceChildren.some((child) => child.current),
            children: allianceChildren,
          },
        ]),
    // The calculator's three pages and the planner. Still keyed and gated as
    // `calculator`: what Tab visibility hides is unchanged.
    ...(shown('calculator')
      ? [
          {
            ...single(
              '#/calculator',
              'Tools',
              'calculator',
              route === 'calculator' || route === 'planner',
            ),
            children: calculatorChildren(ctx),
          },
        ]
      : []),
    ...(firstGuide === undefined
      ? []
      : [
          {
            key: 'guides-entry',
            href: firstGuide.href,
            label: 'Guides',
            icon: 'guides' as const,
            current: guideChildren.some((child) => child.current),
            children: guideChildren,
          },
        ]),
    ...(shown('map') ? [single('#/map', 'Map', 'map', route === 'map')] : []),
  ];
  return [{ id: 'watch' as const, label: 'Menu', items }];
}

/** The admin's extra group: every screen the six entries leave out, filed by
 * what it is about. Three entries, each opening its first screen and listing
 * the rest beneath it while open.
 *
 *   Servers   the group-wide picture: server overview, the rankings, migration
 *   Roster    the alliance's own books: the member rankings and gift codes
 *   Game data what the game itself announces: its calendar and shop values
 *
 * Settings stays in the footer, where it was. The gates each screen carried are
 * unchanged (`members.view`, `giftcodes.manage`, Tab visibility). */
function buildAdminMenu(ctx: NavContext): NavItem[] {
  const shown = ctx.tabShown ?? (() => true);
  const route = ctx.route;
  const screen = (
    hash: string,
    label: string,
    current: boolean,
    tabs: NavChild[] = [],
  ): NavChild => ({
    key: hash,
    href: hash,
    label,
    current,
    screen: true,
    ...(tabs.length > 0 ? { tabs } : {}),
  });

  const servers: NavChild[] = [
    ...(shown('overview') ? [screen('#/', 'Server overview', route === 'overview')] : []),
    ...(shown('rankings')
      ? [screen('#/rankings', 'Rankings', isRankingRoute(route), rankingBoards(ctx))]
      : []),
    ...(shown('migration') ? [screen('#/migration', 'Migration', route === 'migration')] : []),
  ];
  const roster: NavChild[] = [
    ...(ctx.mayViewMembers === true && shown('members')
      ? [
          screen(
            '#/members',
            'Members',
            route === 'members',
            MEMBERS.tabs.map((entry) => ({
              key: MEMBERS.hash(entry.id),
              href: MEMBERS.hash(entry.id),
              label: entry.label,
              current: route === 'members' && (ctx.tabs?.members ?? 'settled') === entry.id,
            })),
          ),
        ]
      : []),
    ...(ctx.mayManageGiftCodes === true && shown('giftCodes')
      ? [screen('#/gift-codes', 'Gift codes', route === 'giftCodes')]
      : []),
  ];
  const gameData: NavChild[] = [
    ...(shown('calendar') ? [screen('#/calendar', 'Game calendar', route === 'calendar')] : []),
    ...(shown('shopValue') ? [screen('#/shop-value', 'Shop value', route === 'shopValue')] : []),
  ];

  const entry = (key: string, label: string, icon: IconName, children: NavChild[]): NavItem[] => {
    const first = children[0];
    return first === undefined
      ? []
      : [
          {
            key,
            href: first.href,
            label,
            icon,
            current: children.some((child) => child.current),
            children,
          },
        ];
  };
  return [
    ...entry('admin-servers', 'Servers', 'rankings', servers),
    ...entry('admin-roster', 'Roster', 'members', roster),
    ...entry('admin-game', 'Game data', 'calendar', gameData),
  ];
}

/** Entries below the groups: not screens about the game, but about the account. */
export function buildFooter(
  route: Route,
  isAdmin: boolean,
  adminGroup: AdminGroup | null = null,
): NavItem[] {
  return [
    ...(isAdmin
      ? [
          {
            key: '#/admin',
            href: '#/admin',
            label: 'Settings',
            icon: 'settings' as const,
            current: route === 'admin',
            // The five groups. Sections inside a group stay a tab bar on the
            // page: which of them a reader may use depends on their permissions.
            children: ADMIN_GROUPS.map((entry) => ({
              key: adminHash(entry.group),
              href: adminHash(entry.group),
              label: entry.label,
              current: route === 'admin' && (adminGroup ?? 'access') === entry.group,
            })),
          },
        ]
      : []),
    {
      key: '#/account',
      href: '#/account',
      label: 'My account',
      icon: 'account' as const,
      current: route === 'account',
    },
  ];
}

/** Screens that belong to no group but still have a name to show in the top bar. */
const OTHER_LABELS: Partial<Record<Route, string>> = {
  player: 'Player',
  server: 'Server',
  alliance: 'Alliance',
  guide: 'Guide',
  notice: 'Notice',
  alarms: 'Alarms',
  // In the Admin menu only since 2026-11-19; anybody else who opens one by
  // its address still gets its name in the top bar.
  overview: 'Server overview',
  rankings: 'Rankings',
  crossRankings: 'Rankings',
  arena: 'Rankings',
  migration: 'Migration',
  members: 'Members',
  giftCodes: 'Gift codes',
  calendar: 'Game calendar',
  shopValue: 'Shop value',
  // Filed under Calculator; named here for a reader whose Calculator is hidden.
  planner: 'Planner',
  admin: 'Settings',
  account: 'My account',
  monthCards: 'Month cards',
  terms: 'Terms',
  privacy: 'Privacy',
  login: 'Sign in',
};

/** `["Menu", "Calculator"]`: the group and the screen, for the top bar. A screen
 * that is in no group (a player, a server) shows just its own name. A screen
 * filed under an entry (`["Menu", "CBFW", "Black Gold"]`) is named after it; an
 * entry's own tabs are not, since the page shows them. */
export function breadcrumb(
  groups: readonly NavGroup[],
  footer: readonly NavItem[],
  route: Route,
): string[] {
  for (const group of groups) {
    const item = group.items.find((entry) => entry.current);
    if (item !== undefined) {
      const screen = item.children?.find((child) => child.current && child.screen === true);
      return screen === undefined
        ? [group.label, item.label]
        : [group.label, item.label, screen.label];
    }
  }
  const foot = footer.find((entry) => entry.current);
  if (foot !== undefined) return [foot.label];
  return [OTHER_LABELS[route] ?? 'Dark War'];
}

// ----------------------------------------------------------------- status line

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** `28 min`, `2 h 10 min`, `3 d`: how long until something, coarse on purpose. */
export function humanUntil(ms: number): string {
  if (ms < MINUTE) return 'under a minute';
  if (ms < HOUR) return `${Math.round(ms / MINUTE)} min`;
  if (ms < DAY) {
    const hours = Math.floor(ms / HOUR);
    const minutes = Math.round((ms - hours * HOUR) / MINUTE);
    return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
  }
  return `${Math.floor(ms / DAY)} d`;
}

/** What the top bar says about the season: which one is running, and when it
 * ends, or — in the rest between two — when the next begins.
 *
 * A season is current from its start. `endsAt` is the game's settle time, after
 * which nothing counts but the season has not yet been replaced: that gap is
 * the rest period, and the line says so instead of "ends Oct 5" for a month. */
export function seasonLine(seasons: readonly Season[], now: Date): string | null {
  const at = now.getTime();
  const started = seasons
    .filter((season) => season.startsAt !== null && Date.parse(season.startsAt) <= at)
    .sort((a, b) => Date.parse(b.startsAt ?? '') - Date.parse(a.startsAt ?? ''))[0];
  const upcoming = seasons
    .filter((season) => season.startsAt !== null && Date.parse(season.startsAt) > at)
    .sort((a, b) => Date.parse(a.startsAt ?? '') - Date.parse(b.startsAt ?? ''))[0];
  if (started === undefined) return null;
  const ended = started.endsAt !== null && Date.parse(started.endsAt) <= at;
  if (ended && upcoming?.startsAt) {
    return `${started.name} is over. ${upcoming.name} starts in ${humanUntil(Date.parse(upcoming.startsAt) - at)}`;
  }
  if (ended) return `${started.name} is over`;
  if (started.endsAt !== null) {
    return `${started.name} ends in ${humanUntil(Date.parse(started.endsAt) - at)}`;
  }
  return started.name;
}

/** The next thing the alliance has on, from the entries the game told us about. */
export function nextUp(
  entries: ReadonlyArray<{ title: string; startsAt: string }>,
  now: Date,
): { title: string; inMs: number } | null {
  const at = now.getTime();
  const next = entries
    .map((entry) => ({ title: entry.title, start: Date.parse(entry.startsAt) }))
    .filter((entry) => !Number.isNaN(entry.start) && entry.start > at)
    .sort((a, b) => a.start - b.start)[0];
  return next === undefined ? null : { title: next.title, inMs: next.start - at };
}

/** What Ctrl+K searches: every screen, then each of its tabs as
 * `Event guide › Alliance Duel`, so typing "duel" finds the tab itself, and a
 * filed screen's own tabs as `CBFW › Overview › Activity`. A tab takes its
 * screen's icon and its own address; the open one is marked. */
export function paletteEntries(items: readonly NavItem[]): NavItem[] {
  return items.flatMap((item) => [
    item,
    ...(item.children ?? []).flatMap((child) => [
      {
        // Not the child's own key: its first tab shares the screen's address, and
        // two rows with one key make React show the wrong one.
        key: `${item.key} > ${child.key}`,
        href: child.href,
        label: `${item.label} › ${child.label}`,
        icon: item.icon,
        current: child.current,
      },
      ...(child.tabs ?? []).map((tab) => ({
        key: `${item.key} > ${child.key} > ${tab.key}`,
        href: tab.href,
        label: `${item.label} › ${child.label} › ${tab.label}`,
        icon: item.icon,
        current: tab.current,
      })),
    ]),
  ]);
}
