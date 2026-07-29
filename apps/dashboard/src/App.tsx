import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ArenaPanel } from './features/arena/ArenaPanel';
import { RosterPanel } from './features/roster/RosterPanel';
import { queryKeysForTopic, subscribeDataChanges } from './lib/realtime';
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

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <DataChangeSubscriber />
      <header>
        <h1>DarkWar 577-584</h1>
      </header>
      <main>
        <RosterPanel />
        <ArenaPanel />
      </main>
    </QueryClientProvider>
  );
}
