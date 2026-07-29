// FR-UI-005: a new snapshot refetches ONLY the affected panel. The UI never
// subscribes to snapshot tables — it listens to data_change_notifications
// (the only tables in the realtime publication) and maps topics to query
// keys.

import type { SupabaseClient } from '@supabase/supabase-js';

const TOPIC_QUERY_KEYS: Record<string, readonly (readonly string[])[]> = {
  alliance_member_snapshots: [['roster']],
  player_snapshots: [['roster']],
  arena_snapshots: [['arena']],
  arena_entries: [['arena']],
};

export function queryKeysForTopic(topic: string): readonly (readonly string[])[] {
  return TOPIC_QUERY_KEYS[topic] ?? [];
}

export function subscribeDataChanges(
  // biome-ignore lint/suspicious/noExplicitAny: supabase client generics are irrelevant here
  client: SupabaseClient<any>,
  onTopic: (topic: string) => void,
): () => void {
  const channel = client
    .channel('data-changes')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'data_change_notifications' },
      (payload) => {
        const topic = (payload.new as { topic?: string }).topic;
        if (topic) {
          onTopic(topic);
        }
      },
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
