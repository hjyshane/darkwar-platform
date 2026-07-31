import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { ArenaPanel } from './features/arena/ArenaPanel';
import { LoginPage } from './features/auth/LoginPage';
import { CrossRankingsPanel } from './features/crossRankings/CrossRankingsPanel';
import { MonthCardsPage } from './features/monthCards/MonthCardsPage';
import { RankingsPanel } from './features/rankings/RankingsPanel';
import { RosterPanel } from './features/roster/RosterPanel';
import { queryKeysForTopic, subscribeDataChanges } from './lib/realtime';
import { NAV_TABS, type Route, routeFromHash } from './lib/route';
import { supabase } from './lib/supabase';

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
    </nav>
  );
}

function Screen({ route }: { route: Route }) {
  switch (route) {
    case 'rankings':
      return <RankingsPanel />;
    case 'crossRankings':
      return <CrossRankingsPanel />;
    case 'arena':
      return <ArenaPanel />;
    default:
      return <RosterPanel />;
  }
}

export function App() {
  const route = routeFromHash(useSyncExternalStore(subscribeHash, () => window.location.hash));
  // Both stand alone: month cards is unlinked on purpose, and the sign-in
  // form has no use for a tab bar behind it.
  const standalone = route === 'login' || route === 'monthCards';
  return (
    <QueryClientProvider client={queryClient}>
      <DataChangeSubscriber />
      <header className="app-header">
        <h1>DarkWar 577-584</h1>
        {!standalone && <Nav route={route} />}
      </header>
      {route === 'login' ? (
        <LoginPage />
      ) : route === 'monthCards' ? (
        <MonthCardsPage />
      ) : (
        <main>
          <Screen route={route} />
        </main>
      )}
    </QueryClientProvider>
  );
}
