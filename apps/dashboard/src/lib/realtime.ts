// FR-UI-005: a new snapshot refetches ONLY the affected panel. The UI never
// subscribes to snapshot tables — it listens to data_change_notifications
// (the only tables in the realtime publication) and maps topics to query
// keys.

import type { SupabaseClient } from '@supabase/supabase-js';

// The overview summarises the roster and its contribution, so it refetches
// on the same two topics the roster does — it is a second reader of the same
// facts, not a source of its own.
const TOPIC_QUERY_KEYS: Record<string, readonly (readonly string[])[]> = {
  alliance_member_snapshots: [['roster'], ['overview']],
  alliance_contribution_snapshots: [['roster'], ['overview']],
  player_snapshots: [['roster'], ['crossRankings'], ['overview']],
  alliance_snapshots: [['rankings']],
  player_component_power_snapshots: [['crossRankings']],
  player_detail_snapshots: [['roster']],
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
