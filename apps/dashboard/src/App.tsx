import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { ArenaPanel } from './features/arena/ArenaPanel';
import { CrossRankingsPanel } from './features/crossRankings/CrossRankingsPanel';
import { MonthCardsPage } from './features/monthCards/MonthCardsPage';
import { RankingsPanel } from './features/rankings/RankingsPanel';
import { RosterPanel } from './features/roster/RosterPanel';
import { queryKeysForTopic, subscribeDataChanges } from './lib/realtime';
import { routeFromHash } from './lib/route';
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
  return null;
}

const queryClient = new QueryClient();

function subscribeHash(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

export function App() {
  const route = routeFromHash(useSyncExternalStore(subscribeHash, () => window.location.hash));
  return (
    <QueryClientProvider client={queryClient}>
      <DataChangeSubscriber />
      <header>
        <h1>DarkWar 577-584</h1>
      </header>
      {route === 'monthCards' ? (
        <MonthCardsPage />
      ) : (
        <main>
          <RosterPanel />
          <RankingsPanel />
          <CrossRankingsPanel />
          <ArenaPanel />
        </main>
      )}
    </QueryClientProvider>
  );
}
