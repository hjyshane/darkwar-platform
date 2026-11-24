// The page each route draws (2026-11-24, review stage 2-C).
//
// `PAGES` is `Record<Route, …>`, so a route declared in lib/routeTable.ts
// with no page here does not build, and the switch and the ternary chain that
// used to do this in App.tsx cannot drift from the table. App.tsx keeps what
// comes BEFORE a page: the wall, the character picker and the community
// filter.
//
// Two kinds of entry:
//   screen  drawn inside the shell's <main>, under the Events strip when it is
//           one of those, and behind Settings › Tab visibility (0295);
//   page    draws its own <main> (sign-in, settings, a post, a player...).
//
// Each entry is a component, so it can ask for what it needs (a capability, the
// id in the address) with hooks. A gate inside one HIDES a screen; it does not
// withhold anything: RLS does that, and each comment says which policy.

import type { ComponentType, ReactElement } from 'react';
import { LoginPage } from './features/auth/LoginPage';
import { EventsTabs, useFirstEventsRoute } from './features/events/EventsTabs';
import { HomePage } from './features/home/HomePage';
import { mayOpenSettings } from './lib/adminAccess';
import { CommunityGate, useIsCommunity } from './lib/communityAccess';
import { Loading, lazyPage } from './lib/lazyPage';
import {
  type Route,
  adminGroupFromHash,
  adminSectionFromHash,
  allianceIdFromHash,
  calculatorTabFromHash,
  eventGuideTabFromHash,
  guideIdFromHash,
  inEventsHub,
  mapServerIdFromHash,
  noticeIdFromHash,
  playerIdFromHash,
  serverIdFromHash,
} from './lib/route';
import { isTabShown, tabKeyOf, useTabVisibility } from './lib/tabVisibility';
import { useHash } from './lib/useHash';
import { useMayView } from './lib/useMayView';
import { useSession } from './lib/useSession';

// Every screen but the sign-in page and Home is fetched when it is first
// opened (2026-11-24); `lib/lazyPage.tsx` says why and what a stale tab does.
const AccountPage = lazyPage(() =>
  import('./features/account/AccountPage').then((m) => m.AccountPage),
);
const AdminPage = lazyPage(() => import('./features/admin/AdminPage').then((m) => m.AdminPage));
const AlarmsPage = lazyPage(() => import('./features/alarms/AlarmsPage').then((m) => m.AlarmsPage));
const AlliancePage = lazyPage(() =>
  import('./features/alliance/AlliancePage').then((m) => m.AlliancePage),
);
const ArenaPanel = lazyPage(() => import('./features/arena/ArenaPanel').then((m) => m.ArenaPanel));
const BasePlacementPage = lazyPage(() =>
  import('./features/basePlacement/BasePlacementPage').then((m) => m.BasePlacementPage),
);
const BlackGoldPage = lazyPage(() =>
  import('./features/blackGold/BlackGoldPage').then((m) => m.BlackGoldPage),
);
const CalculatorPage = lazyPage(() =>
  import('./features/calculator/CalculatorPage').then((m) => m.CalculatorPage),
);
const ResistanceCalculatorPage = lazyPage(() =>
  import('./features/calculator/ResistanceCalculator').then((m) => m.ResistanceCalculatorPage),
);
const WaitCalculatorPage = lazyPage(() =>
  import('./features/calculator/WaitCalculator').then((m) => m.WaitCalculatorPage),
);
const CalendarPage = lazyPage(() =>
  import('./features/calendar/CalendarPage').then((m) => m.CalendarPage),
);
const CrossRankingsPanel = lazyPage(() =>
  import('./features/crossRankings/CrossRankingsPanel').then((m) => m.CrossRankingsPanel),
);
const EventGuidePage = lazyPage(() =>
  import('./features/eventGuide/EventGuidePage').then((m) => m.EventGuidePage),
);
const FrankiePage = lazyPage(() =>
  import('./features/frankie/FrankiePage').then((m) => m.FrankiePage),
);
const GiftCodesPage = lazyPage(() =>
  import('./features/giftCodes/GiftCodesPage').then((m) => m.GiftCodesPage),
);
const GuidePostPage = lazyPage(() =>
  import('./features/guides/GuidePostPage').then((m) => m.GuidePostPage),
);
const GuidesPanel = lazyPage(() =>
  import('./features/guides/GuidesPanel').then((m) => m.GuidesPanel),
);
const HivePage = lazyPage(() => import('./features/hive/HivePage').then((m) => m.HivePage));
const PrivacyPage = lazyPage(() =>
  import('./features/legal/PrivacyPage').then((m) => m.PrivacyPage),
);
const TermsPage = lazyPage(() => import('./features/legal/TermsPage').then((m) => m.TermsPage));
const MapPage = lazyPage(() => import('./features/map/MapPage').then((m) => m.MapPage));
const MigrationPage = lazyPage(() =>
  import('./features/migration/MigrationPage').then((m) => m.MigrationPage),
);
const MonthCardsPage = lazyPage(() =>
  import('./features/monthCards/MonthCardsPage').then((m) => m.MonthCardsPage),
);
const NoticePostPage = lazyPage(() =>
  import('./features/notices/NoticePostPage').then((m) => m.NoticePostPage),
);
const NoticesPanel = lazyPage(() =>
  import('./features/notices/NoticesPanel').then((m) => m.NoticesPanel),
);
const Overview = lazyPage(() =>
  import('./features/overview/OverviewPanel').then((m) => m.Overview),
);
const ParticipationPage = lazyPage(() =>
  import('./features/participation/ParticipationPage').then((m) => m.ParticipationPage),
);
const PlannerPage = lazyPage(() =>
  import('./features/planner/PlannerPage').then((m) => m.PlannerPage),
);
const PlayerPage = lazyPage(() => import('./features/player/PlayerPage').then((m) => m.PlayerPage));
const RankingsPanel = lazyPage(() =>
  import('./features/rankings/RankingsPanel').then((m) => m.RankingsPanel),
);
const RosterPanel = lazyPage(() =>
  import('./features/roster/RosterPanel').then((m) => m.RosterPanel),
);
const Season2Panel = lazyPage(() =>
  import('./features/season/Season2Panel').then((m) => m.Season2Panel),
);
const SeasonPanel = lazyPage(() =>
  import('./features/season/SeasonPanel').then((m) => m.SeasonPanel),
);
const ServerPage = lazyPage(() => import('./features/server/ServerPage').then((m) => m.ServerPage));
const ShopValuePage = lazyPage(() =>
  import('./features/shopValue/ShopValuePage').then((m) => m.ShopValuePage),
);
const CapitalClashPage = lazyPage(() =>
  import('./features/eventBoard/EventBoardPage').then(
    (m) =>
      function CapitalClashPage() {
        return <m.EventBoardPage config={m.CAPITAL_CLASH} />;
      },
  ),
);
const ServerClashPage = lazyPage(() =>
  import('./features/eventBoard/EventBoardPage').then(
    (m) =>
      function ServerClashPage() {
        return <m.EventBoardPage config={m.SERVER_CLASH} />;
      },
  ),
);

/** The calculator's three pages, by address: `#/calculator` (with its query)
 * is the cost page, `#/calculator/wait` the wait-time one and
 * `#/calculator/resistance` the virus-resistance one. */
function CalculatorScreen() {
  const hash = useHash();
  switch (calculatorTabFromHash(hash)) {
    case 'wait':
      return <WaitCalculatorPage />;
    case 'resistance':
      return <ResistanceCalculatorPage />;
    default:
      return <CalculatorPage />;
  }
}

interface PageProps {
  /** The full address, for the entries that read an id or a tab out of it. */
  hash: string;
}

interface PageEntry {
  Page: ComponentType<PageProps>;
  /** Drawn inside the shell's <main> and behind tab visibility. */
  screen?: true;
}

const screen = (Page: ComponentType<PageProps>): PageEntry => ({ Page, screen: true });
const page = (Page: ComponentType<PageProps>): PageEntry => ({ Page });

/** An address whose id did not parse lands where an unknown address does. */
function Fallback() {
  return (
    <main>
      <Overview />
    </main>
  );
}

function MembersScreen() {
  // Typing the address gets the same answer as the missing tab. Not a
  // security boundary — RLS is, and every figure on that screen that is
  // actually alliance-internal is member-only on its own table (0063's
  // comment says which). This is about not putting a screen in front of
  // someone it is not for.
  const mayViewMembers = useMayView('members.view');
  if (mayViewMembers === undefined) return <Loading />;
  if (!mayViewMembers) {
    return (
      <p className="empty">
        The roster is for alliance members. <a href="#/login">Sign in</a> to see it.
      </p>
    );
  }
  return <RosterPanel />;
}

function MigrationScreen() {
  // Officers and admins only (0195), as a role, like the roster history the
  // board folds (0066): who moved is read off the alliance rosters, and those
  // are own-or-officer. RLS returns a member nothing; this says why rather
  // than drawing an empty board. Community reads it too (0283).
  const { data: session } = useSession();
  const role = session?.role;
  if (role !== 'officer' && role !== 'admin' && role !== 'community') {
    return (
      <p className="empty">
        The migration board is kept for officers: it is read off the alliance rosters.
      </p>
    );
  }
  return <MigrationPage />;
}

function BasePlacementScreen() {
  // Officers and admins (owner, 2026-11-20), not community. Client-side only,
  // so this hides the page; there is no policy underneath to match.
  const { data: session } = useSession();
  if (session?.role !== 'officer' && session?.role !== 'admin') {
    return <p className="empty">The Merchant tester is for officers.</p>;
  }
  return <BasePlacementPage />;
}

function GiftCodesScreen() {
  // The tab is hidden from anyone without `giftcodes.manage`, and the tables
  // and functions under it refuse them too (0251) - hiding a tab hides it from
  // the eye, not from the address bar. This says why.
  const mayManage = useMayView('giftcodes.manage');
  if (mayManage === undefined) return <Loading />;
  if (!mayManage) return <p className="empty">Gift codes are kept for officers.</p>;
  return <GiftCodesPage />;
}

function ArenaScreen() {
  // Here the tab and the data agree: 0064 made all four arena tables
  // member-only, so an ungated reader would get an empty board rather than a
  // board. Saying why beats rendering nothing.
  const mayViewArena = useMayView('arena.view');
  if (mayViewArena === undefined) return <Loading />;
  if (!mayViewArena) {
    return (
      <p className="empty">
        Arena boards are for alliance members. <a href="#/login">Sign in</a> to see them.
      </p>
    );
  }
  return <ArenaPanel />;
}

/** The bare Events address opens the first tab of the arranged strip, not a
 * fixed page. */
function EventsScreen({ hash }: PageProps) {
  const first = useFirstEventsRoute();
  if (first === 'events') return <BlackGoldPage />;
  const { Page } = PAGES[first];
  return <Page hash={hash} />;
}

function AdminScreen({ hash }: PageProps) {
  const { data: session } = useSession();
  const group = adminGroupFromHash(hash);
  if (group === null) return <Fallback />;
  // A floor on the whole area, not a boundary: RLS refuses every write
  // whatever renders here. What it stops is a signed-in account with no role
  // being shown five groups of alliance settings and reading that as "I am
  // nearly in". The one thing they can do is redeem a code, and that is on the
  // sign-in page.
  if (mayOpenSettings(session?.role)) {
    return <AdminPage group={group} section={adminSectionFromHash(hash)} />;
  }
  return (
    <main>
      <section aria-labelledby="admin-closed-heading">
        <h2 id="admin-closed-heading">Nothing here is yours</h2>
        <p className="empty">
          Settings are for alliance members. You are signed in as{' '}
          <strong>{session?.role ?? 'viewer'}</strong>. <a href="#/login">Redeem a join code</a> to
          be admitted.
        </p>
      </section>
    </main>
  );
}

function PlayerScreen({ hash }: PageProps) {
  const isCommunity = useIsCommunity();
  const id = playerIdFromHash(hash);
  if (id === null) return <Fallback />;
  return isCommunity ? (
    <CommunityGate id={id} kind="player">
      <PlayerPage playerId={id} />
    </CommunityGate>
  ) : (
    <PlayerPage playerId={id} />
  );
}

function AllianceScreen({ hash }: PageProps) {
  const isCommunity = useIsCommunity();
  const id = allianceIdFromHash(hash);
  if (id === null) return <Fallback />;
  return isCommunity ? (
    <CommunityGate id={id} kind="alliance">
      <AlliancePage allianceId={id} />
    </CommunityGate>
  ) : (
    <AlliancePage allianceId={id} />
  );
}

function withId(read: (hash: string) => string | null, draw: (id: string) => ReactElement) {
  return function WithId({ hash }: PageProps) {
    const id = read(hash);
    return id === null ? <Fallback /> : draw(id);
  };
}

function ServerScreen({ hash }: PageProps) {
  const id = serverIdFromHash(hash);
  return id === null ? <Fallback /> : <ServerPage serverId={id} />;
}

/** No capability gate on these: each says why in a word, and the fuller
 * reasons are on the policies named. */
export const PAGES = {
  // Unknown addresses land on the overview too, which is why it has to stand on
  // its own with no data rather than assume it was navigated to.
  overview: screen(() => <Overview />),
  home: screen(() => <HomePage />),
  members: screen(MembersScreen),
  rankings: screen(() => <RankingsPanel />),
  crossRankings: screen(() => <CrossRankingsPanel />),
  arena: screen(ArenaScreen),
  migration: screen(MigrationScreen),
  // Member-only at the policy level (0136); Season 2 is offered to admins only
  // and the panel checks the role again.
  season: screen(() => <SeasonPanel />),
  season2: screen(() => <Season2Panel />),
  // world_city_snapshots is member-only (no gate, like the season boards).
  map: screen(({ hash }) => <MapPage serverId={mapServerIdFromHash(hash)} />),
  // Every member has to read the tile they are sent to; planning is gated
  // inside on `hive.plan`.
  hive: screen(() => <HivePage />),
  events: screen(EventsScreen),
  // Member-only tables (0178).
  blackMoney: screen(() => <BlackGoldPage />),
  // Owner-or-admin at the policy level (0205).
  planner: screen(() => <PlannerPage />),
  // The game's own tables, readable by every signed-in role (0283).
  calculator: screen(CalculatorScreen),
  basePlacement: screen(BasePlacementScreen),
  giftCodes: screen(GiftCodesScreen),
  // Member-only (0204); recording is gated inside on `data.enter`.
  participation: screen(() => <ParticipationPage />),
  // `schedule.view` at the policy level (0124, 0194); controls on `schedule.manage`.
  alarms: screen(() => <AlarmsPage />),
  // Member-only (0277, 0290).
  frankie: screen(() => <FrankiePage />),
  capitalClash: screen(() => <CapitalClashPage />),
  serverClash: screen(() => <ServerClashPage />),
  // Member-only (0215); editing values is gated by RLS to officers and admins.
  shopValue: screen(() => <ShopValuePage />),
  // Member-only (0248).
  eventGuide: screen(({ hash }) => <EventGuidePage tab={eventGuideTabFromHash(hash)} />),
  // Member-only (0208); naming events is gated by RLS to officers and admins.
  calendar: screen(() => <CalendarPage />),

  login: page(() => <LoginPage />),
  terms: page(() => <TermsPage />),
  privacy: page(() => <PrivacyPage />),
  admin: page(AdminScreen),
  monthCards: page(() => <MonthCardsPage />),
  account: page(() => <AccountPage />),
  guides: page(() => <GuidesPanel />),
  guide: page(withId(guideIdFromHash, (id) => <GuidePostPage guideId={id} />)),
  notices: page(() => <NoticesPanel />),
  notice: page(withId(noticeIdFromHash, (id) => <NoticePostPage noticeId={id} />)),
  server: page(ServerScreen),
  player: page(PlayerScreen),
  alliance: page(AllianceScreen),
} satisfies Record<Route, PageEntry>;

/** An admin can hide a tab from a role (0295). Typing the address gets the same
 * answer as the missing entry; the policies underneath are the boundary. */
function TabVisibilityGate({ route, children }: { route: Route; children: ReactElement }) {
  const { data: session } = useSession();
  const rules = useTabVisibility();
  const key = tabKeyOf(route);
  if (key !== null && !isTabShown(rules, key, session?.role)) {
    return <p className="empty">An admin has hidden this page for your role.</p>;
  }
  return children;
}

/** The page for a route, with a screen's <main>, Events strip and tab gate. */
export function RoutePage({ route, hash }: { route: Route; hash: string }) {
  const entry: PageEntry = PAGES[route];
  const { Page } = entry;
  if (entry.screen !== true) return <Page hash={hash} />;
  return (
    <main>
      {inEventsHub(route) && <EventsTabs route={route} />}
      <TabVisibilityGate route={route}>
        <Page hash={hash} />
      </TabVisibilityGate>
    </main>
  );
}
