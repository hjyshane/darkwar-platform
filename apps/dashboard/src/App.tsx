import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { RefreshButton } from './components/RefreshButton';
import { SignOutButton } from './components/SignOutButton';
import { SyncStatus } from './components/SyncStatus';
import { AdminPage } from './features/admin/AdminPage';
import { AlliancePage } from './features/alliance/AlliancePage';
import { ArenaPanel } from './features/arena/ArenaPanel';
import { LoginPage } from './features/auth/LoginPage';
import { CrossRankingsPanel } from './features/crossRankings/CrossRankingsPanel';
import { GuidesPanel } from './features/guides/GuidesPanel';
import { MonthCardsPage } from './features/monthCards/MonthCardsPage';
import { Overview } from './features/overview/OverviewPanel';
import { PlayerPage } from './features/player/PlayerPage';
import { RankingsPanel } from './features/rankings/RankingsPanel';
import { RosterPanel } from './features/roster/RosterPanel';
import { ServerPage } from './features/server/ServerPage';
import { isAllowed, usePermissions } from './lib/permissions';
import { queryKeysForTopic, subscribeDataChanges } from './lib/realtime';
import { rememberReturnTo } from './lib/returnTo';
import {
  type AdminGroup,
  NAV_TABS,
  type Route,
  adminGroupFromHash,
  allianceIdFromHash,
  playerIdFromHash,
  routeFromHash,
  serverIdFromHash,
} from './lib/route';
import { supabase } from './lib/supabase';
import { useSession } from './lib/useSession';

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
export const queryClient = new QueryClient();

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

/** Which capability each gated tab needs. A route absent from here is
 * public, which is the default and has to stay the readable case. */
const GATED_ROUTES: Partial<Record<Route, string>> = {
  members: 'members.view',
  arena: 'arena.view',
};

function Nav({ route }: { route: Route }) {
  const { data: session } = useSession();
  const mayViewMembers = useMayView('members.view');
  const mayViewArena = useMayView('arena.view');
  const allowed: Partial<Record<Route, boolean | undefined>> = {
    members: mayViewMembers,
    arena: mayViewArena,
  };
  return (
    <nav aria-label="Screens" className="tabs">
      {NAV_TABS.filter((tab) => !(tab.route in GATED_ROUTES) || allowed[tab.route] === true).map(
        (tab) => (
          <a
            key={tab.hash}
            href={tab.hash}
            className="tab"
            // Marks the current tab for screen readers, and is what the
            // stylesheet keys off — no active-state class to keep in sync.
            aria-current={tab.route === route ? 'page' : undefined}
          >
            {tab.label}
          </a>
        ),
      )}
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

function Screen({ route }: { route: Route }) {
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

/** Everything except the way in.
 *
 * 0065 made every table in the schema member-only, so a signed-out reader
 * does not get an empty dashboard — every query is refused outright (42501)
 * and every panel would render its error state. There is nothing left to
 * show them, so nothing is shown.
 *
 * This is a wall in front of screens whose data is already withheld, not
 * the withholding itself. Anyone can still open the address; they will find
 * this, and the database would refuse them anyway.
 *
 * `viewer` lands here too. Signing up creates a viewer with no rows until an
 * admin admits them or they redeem a join code, and the second sentence is
 * written for that state.
 *
 * Which sentence to show turns on `email`, NOT on the role. useSession
 * collapses signed-out and signed-in-without-a-row into 'viewer' on purpose,
 * because that is what current_app_role() returns for both — correct for
 * explaining what RLS will do, useless for telling the two apart. Branching
 * on the role told every first-time visitor "You are signed in", and made
 * the Sign in link unreachable, since by the time the wall renders the
 * session query has resolved and the role is never undefined.
 */
export function SignedOutWall({ email }: { email: string | null | undefined }) {
  return (
    <main>
      <section aria-labelledby="wall-heading">
        <h2 id="wall-heading">Alliance members only</h2>
        <p>Every screen on this dashboard is for HELLBOUND [CBFW]. Nothing here is public.</p>
        <p>
          {email != null ? (
            <>
              You are signed in as {email}, but no role has been granted yet. Enter a join code on
              the <a href="#/login">sign-in page</a>, or ask an admin.
            </>
          ) : (
            <a href="#/login">Sign in</a>
          )}
        </p>
      </section>
    </main>
  );
}

const MEMBER_ROLES = new Set(['member', 'officer', 'admin']);

export function App() {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash);
  const route = routeFromHash(hash);
  // Where to come back to after signing in.
  //
  // Recorded here, on every hash change, rather than from each of the eleven
  // "Sign in" links — the one that got missed would be the one somebody uses.
  // Following a link to #/guides while signed out used to end on the overview,
  // with no way back to the page the link was for.
  useEffect(() => {
    rememberReturnTo(hash);
  }, [hash]);
  const serverId = serverIdFromHash(hash);
  const playerId = playerIdFromHash(hash);
  const allianceId = allianceIdFromHash(hash);
  const adminGroup = adminGroupFromHash(hash);
  // Month cards is unlinked on purpose and the sign-in form has no use for
  // a tab bar behind it. A server page keeps the tabs: it is reached FROM
  // one, and taking the way back away would strand the reader.
  const standalone = route === 'login' || route === 'monthCards';
  return (
    <QueryClientProvider client={queryClient}>
      <Shell
        adminGroup={adminGroup}
        allianceId={allianceId}
        playerId={playerId}
        route={route}
        serverId={serverId}
        standalone={standalone}
      />
    </QueryClientProvider>
  );
}

function Shell({
  route,
  serverId,
  playerId,
  allianceId,
  adminGroup,
  standalone,
}: {
  route: Route;
  serverId: number | null;
  playerId: string | null;
  allianceId: string | null;
  adminGroup: AdminGroup | null;
  standalone: boolean;
}) {
  // Inside the provider, because it is a query. Undefined means "not
  // answered yet" and must not be read as "not a member" — flashing the
  // wall at a member on every load would be worse than a beat of Loading.
  const { data: session, isPending } = useSession();
  const isMember = session !== undefined && MEMBER_ROLES.has(session.role);
  const walled = !standalone && !isPending && !isMember;

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
        </h1>
        {!standalone && isMember && <Nav route={route} />}
      </header>
      {walled ? (
        <SignedOutWall email={session?.email} />
      ) : isPending && !standalone ? (
        <main>
          <p className="empty">Loading…</p>
        </main>
      ) : route === 'login' ? (
        <LoginPage />
      ) : route === 'admin' && adminGroup !== null ? (
        <AdminPage group={adminGroup} />
      ) : route === 'monthCards' ? (
        <MonthCardsPage />
      ) : route === 'guides' ? (
        <GuidesPanel />
      ) : route === 'server' && serverId !== null ? (
        <ServerPage serverId={serverId} />
      ) : route === 'player' && playerId !== null ? (
        <PlayerPage playerId={playerId} />
      ) : route === 'alliance' && allianceId !== null ? (
        <AlliancePage allianceId={allianceId} />
      ) : (
        <main>
          <Screen route={route} />
        </main>
      )}
    </>
  );
}
