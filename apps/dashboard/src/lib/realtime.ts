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
  // Written by an admin rather than the collector, and the only topic here
  // that fires on delete too — a notice taken down has to disappear.
  announcements: [['announcements'], ['announcements-admin']],
  // Naming a hero has to reach the arena board that prints the name, not
  // just the admin page where it was typed — and deleting one has to reach
  // it too, so that the board falls back to the id straight away.
  heroes: [['heroes'], ['heroes-admin'], ['crossRankings']],
  // Same reasoning as heroes: the cross-server board prints these names, so
  // renaming one has to reach it and not just the form it was typed in.
  pets: [['pets'], ['pets-admin'], ['crossRankings']],
  // Not a snapshot table, but the same problem: an admin changing which
  // figures the overview shows has to reach the readers looking at it.
  app_settings: [
    ['overview-metrics'],
    ['overview-metrics-admin'],
    ['overview-formulas-admin'],
    ['admin-own-alliance'],
  ],
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
