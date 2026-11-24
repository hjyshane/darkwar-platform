// The server group, read from the database instead of a constant (2026-11-24).
//
// `servers.is_tracked` already says which servers are the group's: 0264 set it
// for 565-588, sync's ensure_servers() adds any stranger as untracked, and the
// map coverage view (0148) reads the same flag. The pickers on the migration and
// merchant-tester screens used a TypeScript constant instead, so growing the
// group meant a code change and a release. Now it is one `update` — and, once
// the settings registry lands, a switch in Settings.
//
// The constant stays as the fallback: what the pickers show while the query is
// in flight, if it is refused, or if no server is marked at all.

import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

/** The group as 0264 set it. Shown until the database answers. */
export const FALLBACK_TRACKED_SERVERS: readonly number[] = Array.from(
  { length: 24 },
  (_, i) => 565 + i,
);

/** The tracked servers in ascending order, or the fallback when none is marked. */
export function trackedOrFallback(ids: readonly number[] | null | undefined): readonly number[] {
  return ids !== null && ids !== undefined && ids.length > 0
    ? [...ids].sort((a, b) => a - b)
    : FALLBACK_TRACKED_SERVERS;
}

async function fetchTrackedServers(): Promise<number[]> {
  const { data, error } = await supabase
    .from('servers')
    .select('server_id')
    .eq('is_tracked', true)
    .order('server_id');
  if (error) throw new Error(`servers query failed: ${error.message}`);
  return (data ?? []).map((row) => row.server_id);
}

/** The group's servers, for a picker. Never empty and never waits: the fallback
 * stands in until the database answers. */
export function useTrackedServers(): readonly number[] {
  const { data } = useQuery({
    queryKey: ['servers', 'tracked'],
    queryFn: fetchTrackedServers,
    // The group changes a few times a year.
    staleTime: 60 * 60_000,
  });
  return trackedOrFallback(data);
}
