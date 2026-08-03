import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { SyncStatus } from './components/SyncStatus';
import { AdminPage } from './features/admin/AdminPage';
import { AlliancePage } from './features/alliance/AlliancePage';
import { ArenaPanel } from './features/arena/ArenaPanel';
import { LoginPage } from './features/auth/LoginPage';
import { CrossRankingsPanel } from './features/crossRankings/CrossRankingsPanel';
import { MonthCardsPage } from './features/monthCards/MonthCardsPage';
import { Overview } from './features/overview/OverviewPanel';
import { PlayerPage } from './features/player/PlayerPage';
import { RankingsPanel } from './features/rankings/RankingsPanel';
import { RosterPanel } from './features/roster/RosterPanel';
import { ServerPage } from './features/server/ServerPage';
import { isAllowed, usePermissions } from './lib/permissions';
import { queryKeysForTopic, subscribeDataChanges } from './lib/realtime';
import {
  NAV_TABS,
  type Route,
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

const queryClient = new QueryClient();

function subscribeHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

/** Whether this reader may be offered the Members screen (0063).
 *
 * Undefined while the grid is still loading, which callers must treat as
 * "not yet" rather than "no": rendering the tab and then taking it away is
 * worse than a tab that appears a beat late.
 */
function useMayViewMembers(): boolean | undefined {
  const { data: session } = useSession();
  const { data: permissions, isPending } = usePermissions();
  if (isPending) {
    return undefined;
  }
  return isAllowed(permissions?.grants, session?.role, 'members.view');
}

function Nav({ route }: { route: Route }) {
  const { data: session } = useSession();
  const mayViewMembers = useMayViewMembers();
  return (
    <nav aria-label="Screens" className="tabs">
      {NAV_TABS.filter((tab) => tab.route !== 'members' || mayViewMembers === true).map((tab) => (
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

function Screen({ route }: { route: Route }) {
  const mayViewMembers = useMayViewMembers();
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
      return <ArenaPanel />;
    default:
      // Unknown addresses land here too, which is why the overview has to
      // stand on its own with no data rather than assume it was navigated to.
      return <Overview />;
  }
}

export function App() {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash);
  const route = routeFromHash(hash);
  const serverId = serverIdFromHash(hash);
  const playerId = playerIdFromHash(hash);
  const allianceId = allianceIdFromHash(hash);
  // Month cards is unlinked on purpose and the sign-in form has no use for
  // a tab bar behind it. A server page keeps the tabs: it is reached FROM
  // one, and taking the way back away would strand the reader.
  const standalone = route === 'login' || route === 'monthCards';
  return (
    <QueryClientProvider client={queryClient}>
      <DataChangeSubscriber />
      <header className="app-header">
        <h1>
          Dark War dashboard
          {/* In the title rather than on a panel: it is about the whole
              board, not one table's data. */}
          <SyncStatus />
        </h1>
        {!standalone && <Nav route={route} />}
      </header>
      {route === 'login' ? (
        <LoginPage />
      ) : route === 'admin' ? (
        <AdminPage />
      ) : route === 'monthCards' ? (
        <MonthCardsPage />
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
    </QueryClientProvider>
  );
}
