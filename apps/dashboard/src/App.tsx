import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
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

function Nav({ route }: { route: Route }) {
  const { data: session } = useSession();
  return (
    <nav aria-label="Screens" className="tabs">
      {NAV_TABS.map((tab) => (
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
      <a className="tab tab-end" href="#/login">
        {session?.email ? `Signed in · ${session.role}` : 'Sign in'}
      </a>
    </nav>
  );
}

function Screen({ route }: { route: Route }) {
  switch (route) {
    case 'members':
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
        <h1>Dark War dashboard</h1>
        {!standalone && <Nav route={route} />}
      </header>
      {route === 'login' ? (
        <LoginPage />
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
