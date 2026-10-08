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

import {
  ADMIN_GROUPS,
  ALLIANCE_TABS,
  ALLIANCE_VIEWS,
  type AdminGroup,
  type AllianceView,
  BOARD_TABS,
  EVENT_GUIDE_TABS,
  EVENT_TABS,
  type EventGuideTab,
  HIVE,
  type HiveTab,
  MEMBERS,
  type MembersTab,
  OVERVIEW_TABS,
  PLANNER,
  type PlannerTab,
  RANKING_TABS,
  type Route,
  adminHash,
  allianceHash,
  eventGuideHash,
  isRankingRoute,
} from './route';
import type { Season } from './seasons';

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
  id: 'watch' | 'alliance' | 'events' | 'boards';
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
  /** Season names by address (`#/season`), from the seasons table. */
  seasonNames: Readonly<Record<string, string | undefined>>;
  /** The event guide tab in the address; the first when it names none. */
  eventGuideTab?: EventGuideTab;
  /** The tab each screen has open, read from the address. A screen's own first
   * tab when the address names none. */
  tabs?: {
    members?: MembersTab;
    hive?: HiveTab;
    planner?: PlannerTab;
    alliance?: AllianceView;
  };
  /** Whether the reader may plan the hive. Its tabs are for planners only:
   * everybody else sees the plan and nothing else. Undefined while unknown. */
  mayPlanHive?: boolean | undefined;
  /** Whether the Arena board is open to this reader. Undefined while unknown. */
  mayViewArena?: boolean | undefined;
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
  participation: 'participation',
  planner: 'planner',
  calendar: 'calendar',
  eventGuide: 'guide',
  shopValue: 'shop',
  notices: 'notices',
  guides: 'guides',
};

const iconFor = (route: Route): IconName => ICONS[route] ?? 'overview';

/** The groups, in the order the sidebar draws them. */
export function buildNav(ctx: NavContext): NavGroup[] {
  const onOwn =
    ctx.own !== null && ctx.route === 'alliance' && ctx.allianceId === ctx.own.alliance_id;
  const name = (hash: string, fallback: string) => ctx.seasonNames[hash] ?? fallback;

  const watch: NavItem[] = [
    ...OVERVIEW_TABS.filter((tab) => tab.route !== 'migration' || ctx.isOfficer).map((tab) => ({
      key: tab.hash,
      href: tab.hash,
      // The overview entry is the landing screen; "Cross-Server Ranking" stands
      // for the three boards behind it, so it stays current on all of them.
      label: tab.route === 'rankings' ? 'Rankings' : tab.label,
      icon: iconFor(tab.route),
      current: tab.route === 'rankings' ? isRankingRoute(ctx.route) : tab.route === ctx.route,
      // The three boards, each its own address. Arena only where the reader
      // may see it, and not before that is known: an entry that arrives and is
      // taken away is worse than one that arrives a beat late.
      ...(tab.route === 'rankings'
        ? {
            children: RANKING_TABS.filter(
              (board) => board.route !== 'arena' || ctx.mayViewArena === true,
            ).map((board) => ({
              key: board.hash,
              href: board.hash,
              label: board.label,
              current: board.route === ctx.route,
            })),
          }
        : {}),
    })),
    { key: '#/map', href: '#/map', label: 'Map', icon: 'map', current: ctx.route === 'map' },
  ];

  const alliance: NavItem[] = [
    ...(ctx.own === null
      ? []
      : [
          {
            key: 'own-alliance',
            href: allianceHash(ctx.own.alliance_id),
            label: ctx.own.label,
            icon: 'alliance' as const,
            current: onOwn,
            // The views every alliance of ours has. Past names are left out:
            // whether there are any is a fact about the data, which the page
            // knows and the sidebar does not.
            children: ALLIANCE_VIEWS.filter((view) => view.id !== 'names').map((view) => ({
              key: allianceHash(ctx.own?.alliance_id ?? '', view.id),
              href: allianceHash(ctx.own?.alliance_id ?? '', view.id),
              label: view.label,
              current: onOwn && (ctx.tabs?.alliance ?? 'members') === view.id,
            })),
          },
        ]),
    ...ALLIANCE_TABS.filter(
      (tab) =>
        (tab.route !== 'members' || ctx.mayViewMembers === true) &&
        (tab.route !== 'season2' || ctx.isAdmin),
    ).map((tab) => ({
      key: tab.hash,
      href: tab.hash,
      label: name(tab.hash, tab.label),
      icon: iconFor(tab.route),
      current: tab.route === ctx.route,
      ...(tab.route === 'members'
        ? {
            children: MEMBERS.tabs.map((entry) => ({
              key: MEMBERS.hash(entry.id),
              href: MEMBERS.hash(entry.id),
              label: entry.label,
              current: ctx.route === 'members' && (ctx.tabs?.members ?? 'settled') === entry.id,
            })),
          }
        : {}),
      ...(tab.route === 'hive' && ctx.mayPlanHive === true
        ? {
            children: HIVE.tabs.map((entry) => ({
              key: HIVE.hash(entry.id),
              href: HIVE.hash(entry.id),
              label: entry.label,
              current: ctx.route === 'hive' && (ctx.tabs?.hive ?? 'plan') === entry.id,
            })),
          }
        : {}),
      ...(tab.route === 'planner'
        ? {
            children: PLANNER.tabs.map((entry) => ({
              key: PLANNER.hash(entry.id),
              href: PLANNER.hash(entry.id),
              label: entry.label,
              current: ctx.route === 'planner' && (ctx.tabs?.planner ?? 'building') === entry.id,
            })),
          }
        : {}),
    })),
  ];

  const guideTab = ctx.eventGuideTab ?? 'events';
  const events: NavItem[] = EVENT_TABS.map((tab) => ({
    key: tab.hash,
    href: tab.hash,
    label: tab.label,
    icon: iconFor(tab.route),
    current: tab.route === ctx.route,
    ...(tab.route === 'eventGuide'
      ? {
          children: EVENT_GUIDE_TABS.map((entry) => ({
            key: eventGuideHash(entry.id),
            href: eventGuideHash(entry.id),
            label: entry.label,
            current: ctx.route === 'eventGuide' && guideTab === entry.id,
          })),
        }
      : {}),
  }));

  const boards: NavItem[] = BOARD_TABS.map((tab) => ({
    key: tab.hash,
    href: tab.hash,
    label: tab.label,
    icon: iconFor(tab.route),
    // A single notice or guide is still that board.
    current:
      tab.route === 'notices'
        ? ctx.route === 'notices' || ctx.route === 'notice'
        : ctx.route === 'guides' || ctx.route === 'guide',
  }));

  return [
    { id: 'watch' as const, label: 'Watch', items: watch },
    { id: 'alliance' as const, label: 'Alliance', items: alliance },
    { id: 'events' as const, label: 'Events', items: events },
    { id: 'boards' as const, label: 'Boards', items: boards },
  ].filter((group) => group.items.length > 0);
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
  schedule: 'Schedule',
  admin: 'Settings',
  account: 'My account',
  monthCards: 'Month cards',
  terms: 'Terms',
  privacy: 'Privacy',
  login: 'Sign in',
};

/** `["Alliance", "Hive"]`: the group and the screen, for the top bar. A screen
 * that is in no group (a player, a server) shows just its own name. */
export function breadcrumb(
  groups: readonly NavGroup[],
  footer: readonly NavItem[],
  route: Route,
): string[] {
  for (const group of groups) {
    const item = group.items.find((entry) => entry.current);
    if (item !== undefined) return [group.label, item.label];
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
 * `Event guide › Alliance Duel`, so typing "duel" finds the tab itself. A tab
 * takes its screen's icon and its own address; the open one is marked. */
export function paletteEntries(items: readonly NavItem[]): NavItem[] {
  return items.flatMap((item) => [
    item,
    ...(item.children ?? []).map((child) => ({
      // Not the child's own key: its first tab shares the screen's address, and
      // two rows with one key make React show the wrong one.
      key: `${item.key} > ${child.key}`,
      href: child.href,
      label: `${item.label} › ${child.label}`,
      icon: item.icon,
      current: child.current,
    })),
  ]);
}
