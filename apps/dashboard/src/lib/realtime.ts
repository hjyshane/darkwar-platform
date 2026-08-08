// FR-UI-005: a new snapshot refetches ONLY the affected panel. The UI never
// subscribes to snapshot tables — it listens to data_change_notifications
// (the only tables in the realtime publication) and maps topics to query
// keys.

import type { SupabaseClient } from '@supabase/supabase-js';

// The overview summarises the roster and its contribution, so it refetches
// on the same two topics the roster does — it is a second reader of the same
// facts, not a source of its own.
const TOPIC_QUERY_KEYS: Record<string, readonly (readonly string[])[]> = {
  //
  // `['player']` is a PREFIX of the player page's `['player', id]` key, so
  // naming it here reaches whichever player is open. The page had no topic at
  // all until the arena block went on it: contribution, power breakdown and
  // presence all sat there going stale until a manual reload.
  alliance_member_snapshots: [['roster'], ['overview'], ['player']],
  alliance_contribution_snapshots: [['roster'], ['overview'], ['player']],
  player_snapshots: [['roster'], ['crossRankings'], ['overview'], ['player']],
  alliance_snapshots: [['rankings']],
  player_component_power_snapshots: [['crossRankings'], ['player']],
  player_detail_snapshots: [['roster'], ['player']],
  arena_snapshots: [['arena'], ['player']],
  arena_entries: [['arena'], ['player']],
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
  // Not data about the game at all — what the database will let a role do.
  // A control greyed out on the strength of the old answer has to ungrey.
  role_permissions: [['permissions'], ['session']],
  // An officer deciding a claim, reaching the member who filed it. Without
  // this the member's screen kept saying "waiting for an officer" after the
  // officer had already answered, and the only way out was a reload.
  player_claims: [['my-claim'], ['player-claims']],
  // Where the decision lands: approve_player_claim() sets `player_id` here,
  // and `useSession` reads this table for the role. Covers the promotion
  // case too — a role change used to need a sign-out to be believed.
  app_users: [['session'], ['my-claim'], ['members-admin']],
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
