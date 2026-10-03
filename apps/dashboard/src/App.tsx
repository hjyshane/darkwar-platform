import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { AllianceSwitcher } from './components/AllianceSwitcher';
import { RefreshButton } from './components/RefreshButton';
import { ReplyAlerts } from './components/ReplyAlerts';
import { SignOutButton } from './components/SignOutButton';
import { SyncStatus } from './components/SyncStatus';
import { ThemeToggle } from './components/ThemeToggle';
import { AccountPage } from './features/account/AccountPage';
import { AdminPage } from './features/admin/AdminPage';
import { AlliancePage } from './features/alliance/AlliancePage';
import { ArenaPanel } from './features/arena/ArenaPanel';
import { LoginPage } from './features/auth/LoginPage';
import { BlackMoneyPage } from './features/blackMoney/BlackMoneyPage';
import { CalendarPage } from './features/calendar/CalendarPage';
import { CrossRankingsPanel } from './features/crossRankings/CrossRankingsPanel';
import { GuidePostPage } from './features/guides/GuidePostPage';
import { GuidesPanel } from './features/guides/GuidesPanel';
import { HivePage } from './features/hive/HivePage';
import { PrivacyPage } from './features/legal/PrivacyPage';
import { TermsPage } from './features/legal/TermsPage';
import { MapPage } from './features/map/MapPage';
import { MigrationPage } from './features/migration/MigrationPage';
import { MonthCardsPage } from './features/monthCards/MonthCardsPage';
import { NoticePostPage } from './features/notices/NoticePostPage';
import { NoticesPanel } from './features/notices/NoticesPanel';
import { Overview } from './features/overview/OverviewPanel';
import { ParticipationPage } from './features/participation/ParticipationPage';
import { PlayerPage } from './features/player/PlayerPage';
import { RankingsPanel } from './features/rankings/RankingsPanel';
import { RosterPanel } from './features/roster/RosterPanel';
import { SchedulePanel } from './features/schedule/SchedulePanel';
import { Season2Panel } from './features/season/Season2Panel';
import { SeasonPanel } from './features/season/SeasonPanel';
import { ServerPage } from './features/server/ServerPage';
import { ShopValuePage } from './features/shopValue/ShopValuePage';
import { useRecordActivity } from './lib/activity';
import { mayOpenSettings } from './lib/adminAccess';
import { isAllowed, usePermissions } from './lib/permissions';
import { queryKeysForTopic, subscribeDataChanges } from './lib/realtime';
import { useReplyAlerts } from './lib/replyAlerts';
import { rememberReturnTo } from './lib/returnTo';
import {
  ALLIANCE_TABS,
  type AdminGroup,
  BOARD_TABS,
  EVENT_TABS,
  NAV_TABS,
  OVERVIEW_TABS,
  RANKING_TABS,
  type Route,
  adminGroupFromHash,
  adminSectionFromHash,
  allianceHash,
  allianceIdFromHash,
  guideIdFromHash,
  isRankingRoute,
  isStandaloneRoute,
  mapServerIdFromHash,
  navSection,
  noticeIdFromHash,
  playerIdFromHash,
  routeFromHash,
  serverIdFromHash,
} from './lib/route';
import { supabase } from './lib/supabase';
import { useActiveAlliance } from './lib/useMyAlliances';
import { useOwnAlliance } from './lib/useOwnAlliance';
import { useSession } from './lib/useSession';
import { useSidewaysMouse } from './lib/useSidewaysMouse';

function DataChangeSubscriber() {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      subscribeDataChanges(supabase, (topic) => {
        for (const queryKey of queryKeysForTopic(topic)) {
          void queryClient.invalidateQueries({ queryKey: [...queryKey] });
        }
      }),
    [queryClient],
  );
  // Signing in or out changes which JWT the queries carry, and therefore
  // what RLS lets them see — every cached answer is stale at that moment.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
        void queryClient.invalidateQueries();
      }
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);
  return null;
}

// Exported only so the local look-around build (src/dev) can seed it before
// render. Nothing in the app reads it from outside this file.
//
// The defaults matter more here than they would elsewhere, because the
// database is in us-east-2 and the readers are not. Measured against
// production: a request that does no work at all — one row out of `servers` —
// takes 101-189 ms. Distance, not work, is what a screen costs now that 0098
// and 0099 have fixed the plans, and the cheapest request is the one that
// never leaves.
//
// `new QueryClient()` bare meant staleTime 0: every navigation refetched
// everything it had just fetched. Members -> Rankings -> Members asked the
// same questions three times.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A minute of trust. Nothing here is a live figure — the collector
      // writes in bursts a minute or more apart, and a snapshot that is 60
      // seconds old is the same snapshot.
      //
      // Safe to be this long ONLY because FR-UI-005 already exists: the UI
      // subscribes to data_change_notifications and maps topics to query
      // keys (lib/realtime.ts), so a new capture invalidates the keys it
      // affects immediately. Staleness here is a floor on how often we ask
      // unprompted, not a ceiling on how fresh the screen can be.
      staleTime: 60_000,
      // Kept longer than staleTime so going back to a screen shows its last
      // answer at once and revalidates behind it, rather than blanking.
      gcTime: 10 * 60_000,
      // Off, for the same reason. Realtime already says when something
      // changed; refocusing a tab is not evidence that anything did, and on
      // this connection each refetch is another 150 ms per query. There is a
      // "Refetch this screen's data" button for when the reader disagrees.
      refetchOnWindowFocus: false,
      // Three tries with backoff turns one slow failure into four. The
      // screens here already render a refusal rather than a crash — a 42501
      // is an answer, not an error — so retrying mostly delays the message.
      retry: 1,
    },
  },
});

function subscribeHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

/** Whether this reader may be offered a gated screen (0063, 0064).
 *
 * Undefined while the grid is still loading, which callers must treat as
 * "not yet" rather than "no": rendering the tab and then taking it away is
 * worse than a tab that appears a beat late.
 *
 * This hides a tab. It does not withhold anything — RLS does that, and for
 * the arena it does it on all four tables (0064). A reader who types the
 * address gets the screen's own empty state, not the data.
 */
function useMayView(capability: string): boolean | undefined {
  const { data: session } = useSession();
  const { data: permissions, isPending } = usePermissions();
  if (isPending) {
    return undefined;
  }
  return isAllowed(permissions?.grants, session?.role, capability);
}

/** The second row: which board of the group you are looking at.
 *
 * Two groups have one, and they are grouped for different reasons. The three
 * cross-server boards answer one question about three subjects. Members sits
 * under our own alliance because it IS our own alliance, listed a row at a
 * time — it was a top-level tab only because it used to be the landing screen.
 *
 * THE CAPABILITY GATES LIVE HERE, with the tabs they hide. Members needs
 * `members.view` and Arena needs `arena.view` (0063, 0064). Undefined means the
 * grid has not answered yet and is treated as "not yet" rather than "no":
 * drawing a tab and taking it away is worse than one that arrives a beat late.
 * This hides a tab and withholds nothing — RLS does that, and somebody who
 * types the address gets the screen's own empty state.
 */
function SubNav({ route, allianceId }: { route: Route; allianceId: string | null }) {
  const { data: session } = useSession();
  const { data: ownAlliance } = useOwnAlliance();
  const mayViewMembers = useMayView('members.view');
  const mayViewArena = useMayView('arena.view');
  const isAdmin = session?.role === 'admin';
  const isOfficer = isAdmin || session?.role === 'officer';

  const onOwnAlliance =
    ownAlliance != null && route === 'alliance' && allianceId === ownAlliance.alliance_id;
  const section = onOwnAlliance ? 'alliance' : navSection(route);

  type Row = { key: string; href: string; label: string; current: boolean }[];
  const rows: { label: string; tabs: Row }[] = [];

  if (section === 'overview') {
    rows.push({
      label: 'Overview section',
      tabs: OVERVIEW_TABS.filter((tab) => tab.route !== 'migration' || isOfficer).map((tab) => ({
        key: tab.hash,
        href: tab.hash,
        label: tab.label,
        // Cross-Server Ranking stands for three boards, so it stays selected
        // on all of them.
        current: tab.route === 'rankings' ? isRankingRoute(route) : tab.route === route,
      })),
    });
    if (isRankingRoute(route)) {
      rows.push({
        label: 'Board',
        tabs: RANKING_TABS.filter((tab) => tab.route !== 'arena' || mayViewArena === true).map(
          (tab) => ({
            key: tab.hash,
            href: tab.hash,
            label: tab.label,
            current: tab.route === route,
          }),
        ),
      });
    }
  } else if (section === 'alliance') {
    rows.push({
      label: 'Alliance section',
      tabs: [
        ...(ownAlliance != null
          ? [
              {
                key: 'alliance',
                href: allianceHash(ownAlliance.alliance_id),
                label: 'Alliance',
                current: onOwnAlliance,
              },
            ]
          : []),
        ...ALLIANCE_TABS.filter(
          (tab) =>
            (tab.route !== 'members' || mayViewMembers === true) &&
            (tab.route !== 'season2' || isAdmin),
        ).map((tab) => ({
          key: tab.hash,
          href: tab.hash,
          label: tab.label,
          current: tab.route === route,
        })),
      ],
    });
  } else if (section === 'events') {
    rows.push({
      label: 'Events section',
      tabs: EVENT_TABS.map((tab) => ({
        key: tab.hash,
        href: tab.hash,
        label: tab.label,
        current: tab.route === route,
      })),
    });
  } else if (section === 'boards') {
    rows.push({
      label: 'Boards section',
      tabs: BOARD_TABS.map((tab) => ({
        key: tab.hash,
        href: tab.hash,
        label: tab.label,
        // A single notice or guide is still that board.
        current:
          tab.route === 'notices'
            ? route === 'notices' || route === 'notice'
            : route === 'guides' || route === 'guide',
      })),
    });
  }

  // One tab is not a choice. A row that offers only the screen you are
  // already on is furniture.
  const shown = rows.filter((row) => row.tabs.length >= 2);
  if (shown.length === 0) {
    return null;
  }
  return (
    <>
      {shown.map((row) => (
        <nav key={row.label} aria-label={row.label} className="tabs subtabs">
          {row.tabs.map((tab) => (
            <a
              key={tab.key}
              aria-current={tab.current ? 'page' : undefined}
              className="tab"
              href={tab.href}
            >
              {tab.label}
            </a>
          ))}
        </nav>
      ))}
    </>
  );
}

/** The account link, with a dot when somebody is waiting on you.
 *
 * A DOT RATHER THAN A COUNT. The banner below already lists them and says how
 * many; this only has to answer "is there anything", which is the question
 * somebody glancing at the header is asking. A number here would be a second
 * place to keep the same figure correct.
 *
 * It reads the same unread query the banner does, so the two cannot disagree —
 * and clearing one clears the other.
 */
function AccountLink() {
  const { data: alerts } = useReplyAlerts();
  const waiting = (alerts ?? []).length > 0;
  return (
    <a className="header-link" href="#/account">
      My account
      {waiting && (
        // Named for a screen reader, since a coloured dot says nothing to one.
        <span aria-label="You have unread replies" className="header-dot" role="status" />
      )}
    </a>
  );
}

/** The alliance toggle, for admins only (decided 2026-09-29).
 *
 * Everybody else sees the one alliance they belong to. It used to show for
 * anybody in two alliances as well; nobody but an admin is, and the rule is
 * that an account lives in its own alliance. The database is the boundary
 * either way — active_alliance() never honours an alliance the caller is not
 * in — so this is about what the header offers, not what can be read. */
function HeaderAllianceSwitcher() {
  const { data: session } = useSession();
  const { alliances, active, switchTo } = useActiveAlliance();
  if (session?.role !== 'admin') {
    return null;
  }
  return (
    <AllianceSwitcher
      alliances={alliances}
      activeId={active?.alliance_id ?? null}
      onSwitch={switchTo}
    />
  );
}

function Nav({ route, allianceId }: { route: Route; allianceId: string | null }) {
  const { data: session } = useSession();
  const { data: ownAlliance } = useOwnAlliance();
  // Built as a list rather than mapped in place, because one tab is not in
  // NAV_TABS: our own alliance's address carries a uuid that only a query knows,
  // so the static list cannot hold it. It sits immediately right of Overview, is
  // absent until the query answers, and stays absent if no alliance is pinned
  // rather than linking at `#/alliance/null`.
  //
  // One gate is back, and it is here because Schedule is a TOP-level tab with a
  // capability (0124) — unlike Members and Arena, whose checks live in `SubNav`
  // with the second-row tabs they hide. Undefined means the grid has not
  // answered yet and is treated as "not yet": drawing a tab and taking it away
  // is worse than one that arrives a beat late. Hiding it withholds nothing —
  // RLS does that, and somebody who types `#/schedule` gets an empty grid.
  const onOwnAlliance =
    ownAlliance != null &&
    (navSection(route) === 'alliance' ||
      (route === 'alliance' && allianceId === ownAlliance.alliance_id));
  const section = onOwnAlliance ? 'alliance' : navSection(route);
  const tabs = NAV_TABS.flatMap((tab) => {
    const entry = {
      key: tab.hash,
      href: tab.hash,
      label: tab.label,
      // A top tab stands for its whole section, so it stays selected on
      // every screen in it; otherwise opening Arena would deselect Overview.
      current: tab.section === section,
    };
    if (tab.route !== 'overview' || ownAlliance == null) {
      return [entry];
    }
    return [
      entry,
      {
        key: 'own-alliance',
        href: allianceHash(ownAlliance.alliance_id),
        label: ownAlliance.code ?? ownAlliance.name ?? 'Our alliance',
        current: section === 'alliance',
      },
    ];
  });

  return (
    <nav aria-label="Screens" className="tabs">
      {tabs.map((tab) => (
        <a
          key={tab.key}
          href={tab.href}
          className="tab"
          // Marks the current tab for screen readers, and is what the
          // stylesheet keys off — no active-state class to keep in sync.
          aria-current={tab.current ? 'page' : undefined}
        >
          {tab.label}
        </a>
      ))}
      {/* Sign-in used to be an unlisted address, which was fine when only an
          admin ever needed it. Members now sign in to see their own
          alliance's figures, so it has to be findable — and the role has to
          be visible, or "why is this column empty" has no answer. */}
      {/* Only an admin is shown the way in. The address is not the
          boundary — RLS is, and #/admin renders for anyone who types it —
          but there is no reason to put a settings screen in front of people
          who cannot save anything on it. */}
      {session?.role === 'admin' && (
        <a className="tab tab-end" href="#/admin">
          Settings
        </a>
      )}
      <a className={session?.role === 'admin' ? 'tab' : 'tab tab-end'} href="#/login">
        {session?.email ? `Signed in · ${session.role}` : 'Sign in'}
      </a>
    </nav>
  );
}

function Screen({ route, mapServerId }: { route: Route; mapServerId: number | null }) {
  const { data: session } = useSession();
  const isOfficer = session?.role === 'officer' || session?.role === 'admin';
  const mayViewMembers = useMayView('members.view');
  const mayViewArena = useMayView('arena.view');
  switch (route) {
    case 'members':
      // Typing the address gets the same answer as the missing tab. Not a
      // security boundary — RLS is, and every figure on that screen that is
      // actually alliance-internal is member-only on its own table (0063's
      // comment says which). This is about not putting a screen in front of
      // someone it is not for.
      if (mayViewMembers === undefined) {
        return <p className="empty">Loading…</p>;
      }
      if (!mayViewMembers) {
        return (
          <p className="empty">
            The roster is for alliance members. <a href="#/login">Sign in</a> to see it.
          </p>
        );
      }
      return <RosterPanel />;
    case 'rankings':
      return <RankingsPanel />;
    case 'crossRankings':
      return <CrossRankingsPanel />;
    case 'migration':
      // Officers and admins only (0195), as a role, like the roster history
      // the board folds (0066): who moved is read off the alliance rosters,
      // and those are own-or-officer. RLS returns a member nothing; this says
      // why rather than drawing an empty board.
      if (!isOfficer) {
        return (
          <p className="empty">
            The migration board is kept for officers: it is read off the alliance rosters.
          </p>
        );
      }
      return <MigrationPage />;
    case 'season2':
      // The nav hides this from anyone but an admin, and the panel checks the
      // role again — hiding a tab hides it from the eye, not from the address
      // bar, and the underlying view is readable by any member.
      return <Season2Panel />;
    case 'map':
      // No capability gate, matching the season boards: world_city_snapshots
      // is member-only at the policy level and the whole app is walled to
      // members, so there is no ungated reader to explain an empty map to.
      return <MapPage serverId={mapServerId} />;
    case 'hive':
      // No capability gate on the TAB, and that is the point of the screen:
      // every member has to be able to read the tile they are being sent to.
      // The writing half is gated inside the page on `hive.plan`, which is a
      // capability rather than a role for 0045's reason — who may plan a hive
      // move is exactly the kind of thing an alliance changes its mind about.
      return <HivePage />;
    case 'blackMoney':
      // No capability gate, like the season boards: the three tables under it
      // are member-only at the policy level (0178) and the app is walled to
      // members, so there is no ungated reader to explain an empty page to.
      return <BlackMoneyPage />;
    case 'participation':
      // No capability gate, for Black Gold's reason: every source under it is
      // member-only at the policy level (0204's report is security invoker),
      // and recording is gated inside the page on `data.enter`.
      return <ParticipationPage />;
    case 'shopValue':
      // No capability gate: every table behind it is member-only at the policy
      // level (0215), and editing values is gated by RLS to officers and admins.
      return <ShopValuePage />;
    case 'calendar':
      // No capability gate, for the same reason: the calendar is member-only at
      // the policy level (0208), and naming events is gated by RLS to officers
      // and admins, which the page mirrors to decide whether to offer it.
      return <CalendarPage />;
    case 'season':
      // No capability gate. Both season tables are member-only at the
      // policy level (0136) and the whole app is walled to members
      // anyway, so there is no ungated reader to explain an empty board to.
      return <SeasonPanel />;
    case 'arena':
      // Here the tab and the data agree: 0064 made all four arena tables
      // member-only, so an ungated reader would get an empty board rather
      // than a board. Saying why beats rendering nothing.
      if (mayViewArena === undefined) {
        return <p className="empty">Loading…</p>;
      }
      if (!mayViewArena) {
        return (
          <p className="empty">
            Arena boards are for alliance members. <a href="#/login">Sign in</a> to see them.
          </p>
        );
      }
      return <ArenaPanel />;
    default:
      // Unknown addresses land here too, which is why the overview has to
      // stand on its own with no data rather than assume it was navigated to.
      return <Overview />;
  }
}

const MEMBER_ROLES = new Set(['member', 'officer', 'admin']);

export function App() {
  // Once, for every table on every screen. See the hook: it is delegated off
  // `.table-wrap`, so a table added later needs nothing.
  useSidewaysMouse();
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash);
  const route = routeFromHash(hash);
  // Where to come back to after signing in is recorded in `Shell`, not here:
  // it depends on whether the reader was actually stopped by the wall, and the
  // session query that answers that only exists inside the provider below.
  const serverId = serverIdFromHash(hash);
  const mapServerId = mapServerIdFromHash(hash);
  const playerId = playerIdFromHash(hash);
  const allianceId = allianceIdFromHash(hash);
  const guideId = guideIdFromHash(hash);
  const noticeId = noticeIdFromHash(hash);
  const adminGroup = adminGroupFromHash(hash);
  const adminSection = adminSectionFromHash(hash);
  // No tab bar, and no wall — see `isStandaloneRoute` for why each of the four
  // is on that list. A server page is NOT: it is reached FROM the tabs, and
  // taking the way back away would strand the reader.
  const standalone = isStandaloneRoute(route);
  return (
    <QueryClientProvider client={queryClient}>
      <Shell
        adminGroup={adminGroup}
        adminSection={adminSection}
        allianceId={allianceId}
        guideId={guideId}
        hash={hash}
        noticeId={noticeId}
        playerId={playerId}
        route={route}
        mapServerId={mapServerId}
        serverId={serverId}
        standalone={standalone}
      />
    </QueryClientProvider>
  );
}

function Shell({
  route,
  mapServerId,
  serverId,
  playerId,
  allianceId,
  guideId,
  noticeId,
  adminGroup,
  adminSection,
  standalone,
  hash,
}: {
  route: Route;
  mapServerId: number | null;
  serverId: number | null;
  playerId: string | null;
  allianceId: string | null;
  guideId: string | null;
  noticeId: string | null;
  adminGroup: AdminGroup | null;
  adminSection: string | null;
  standalone: boolean;
  /** The raw hash, only so the wall can remember what was asked for. */
  hash: string;
}) {
  // Inside the provider, because it is a query. Undefined means "not
  // answered yet" and must not be read as "not a member" — flashing the
  // wall at a member on every load would be worse than a beat of Loading.
  const { data: session, isPending } = useSession();
  const isMember = session !== undefined && MEMBER_ROLES.has(session.role);
  const walled = !standalone && !isPending && !isMember;

  // Only what the wall actually refused. `walled` is in the dependencies as
  // well as `hash` because a session can expire without the reader touching
  // anything — at that moment the page they are sitting on becomes the page
  // they need bringing back to, and no hash change is coming to notice it.
  useEffect(() => {
    rememberReturnTo(hash, walled);
  }, [hash, walled]);

  // Signing in scores a point, once a day (0114). Here rather than in the
  // login form, because most sessions do not pass through that form at all —
  // the token is restored from storage and the member simply arrives. What is
  // being counted is "showed up today", which is exactly this moment.
  useRecordActivity('login');

  return (
    <>
      <DataChangeSubscriber />
      <header className="app-header">
        <h1>
          {/* The title is a link home, which is what every reader tries first.
              An `<a>` rather than a click handler on the h1: it is navigation,
              so it should be middle-clickable, focusable and visible in the
              status bar like any other link. */}
          <a className="app-home" href="#/">
            Dark War dashboard
          </a>
          {/* Right beside the title: which alliance the whole board is showing
              is the first thing to know about every screen under it. Renders
              only for someone with more than one alliance to choose from. */}
          <HeaderAllianceSwitcher />
          {/* In the title rather than on a panel: it is about the whole
              board, not one table's data. Only for members — it reads
              sync_status, which 0065 closed like everything else. */}
          {isMember && <SyncStatus />}
          {/* Beside the sync badge on purpose: the badge says whether data
              is arriving, and this is what you reach for next. */}
          {isMember && <RefreshButton />}
          {/* Signing out was only reachable from the login screen, which is the
              one place somebody already signed in has no reason to visit. It
              sits here for anybody with a session — including a signed-in
              non-member looking at the wall, who otherwise has no way out of it
              at all. */}
          {session?.email != null && <SignOutButton email={session.email} />}
          {/* Beside the account it belongs to, rather than out with the data
              controls: posts, comments, favourites, scraps, your character and
              leaving are all things about YOU, and they read as one cluster
              next to "signed in as". Members only — a viewer has nothing to
              put on the shelf. */}
          {isMember && <AccountLink />}
          {/* Last, pushed to the right edge (margin-left: auto). For everybody,
              signed in or not: reading the board is the thing the theme
              affects, and the signed-out wall is a screen somebody may be
              staring at for a while too. */}
          <ThemeToggle />
        </h1>
        {!standalone && isMember && <Nav allianceId={allianceId} route={route} />}
        {!standalone && isMember && <SubNav allianceId={allianceId} route={route} />}
      </header>
      {/* Above whatever screen the reader came for, because the whole problem
          it solves is that the answer is somewhere they are not (0117). */}
      {!standalone && isMember && <ReplyAlerts />}
      {/* THE WALL IS GONE. It said "Alliance members only", explained that
          nothing here is public, and offered a link to the sign-in page — one
          screen whose entire content was a signpost to another screen. Every
          visitor read it once and clicked through.
          Sending them straight to the sign-in page loses nothing: it carries
          the Terms and Privacy links the wall carried, and it handles the
          second state the wall existed for — signed in with no role yet — far
          better, by putting the join-code box in front of them instead of
          telling them where to find it. */}
      {walled ? (
        <LoginPage />
      ) : isPending && !standalone ? (
        <main>
          <p className="empty">Loading…</p>
        </main>
      ) : route === 'login' ? (
        <LoginPage />
      ) : route === 'terms' ? (
        <TermsPage />
      ) : route === 'privacy' ? (
        <PrivacyPage />
      ) : route === 'admin' && adminGroup !== null ? (
        // A floor on the whole area, not a boundary: RLS refuses every write
        // whatever renders here. What it stops is a signed-in account with no
        // role being shown five groups of alliance settings and reading that
        // as "I am nearly in". The one thing they can do is redeem a code, and
        // that is on the sign-in page.
        mayOpenSettings(session?.role) ? (
          <AdminPage group={adminGroup} section={adminSection} />
        ) : (
          <main>
            <section aria-labelledby="admin-closed-heading">
              <h2 id="admin-closed-heading">Nothing here is yours</h2>
              <p className="empty">
                Settings are for alliance members. You are signed in as{' '}
                <strong>{session?.role ?? 'viewer'}</strong>.{' '}
                <a href="#/login">Redeem a join code</a> to be admitted.
              </p>
            </section>
          </main>
        )
      ) : route === 'monthCards' ? (
        <MonthCardsPage />
      ) : route === 'account' ? (
        <AccountPage />
      ) : route === 'guides' ? (
        <GuidesPanel />
      ) : route === 'guide' && guideId !== null ? (
        <GuidePostPage guideId={guideId} />
      ) : route === 'notices' ? (
        <NoticesPanel />
      ) : route === 'schedule' ? (
        <main>
          <SchedulePanel />
        </main>
      ) : route === 'notice' && noticeId !== null ? (
        <NoticePostPage noticeId={noticeId} />
      ) : route === 'server' && serverId !== null ? (
        <ServerPage serverId={serverId} />
      ) : route === 'player' && playerId !== null ? (
        <PlayerPage playerId={playerId} />
      ) : route === 'alliance' && allianceId !== null ? (
        <AlliancePage allianceId={allianceId} />
      ) : (
        <main>
          <Screen mapServerId={mapServerId} route={route} />
        </main>
      )}
    </>
  );
}
