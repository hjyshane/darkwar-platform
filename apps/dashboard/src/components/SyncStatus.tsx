import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

/** Whether the board is still being fed.
 *
 * Every panel already carries a freshness badge for its own data. This one
 * answers a different question — not "how old is this figure" but "is
 * anything still arriving at all" — and the difference matters when the
 * collector has stopped: the figures look exactly as they did an hour ago,
 * and nothing on screen would otherwise say why they have stopped moving.
 *
 * Polled rather than pushed. dw-sync beats every ten seconds and the app's
 * realtime channel carries data changes, not health; a subscription would
 * mean a notification row six times a minute forever for a badge nobody is
 * watching most of the time. Twenty seconds of poll is cheaper and late by
 * at most that.
 *
 * The threshold lives in the view (0060), not here, so "live" means one
 * thing whoever asks.
 */
interface SyncState {
  last_heartbeat_at: string | null;
  is_live: boolean | null;
}

async function fetchSyncStatus(): Promise<SyncState> {
  const { data, error } = await supabase
    .from('sync_status')
    .select('last_heartbeat_at, is_live')
    .maybeSingle();
  if (error) {
    throw new Error(`sync status query failed: ${error.message}`);
  }
  return (data as SyncState | null) ?? { last_heartbeat_at: null, is_live: null };
}

export function since(from: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - new Date(from).getTime()) / 60_000);
  if (minutes < 1) {
    return 'moments ago';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

export function SyncStatus({ now }: { now?: Date }) {
  const { data } = useQuery({
    queryKey: ['sync-status'],
    queryFn: fetchSyncStatus,
    refetchInterval: 20_000,
  });

  // Nothing known yet, and nothing to claim. A badge that guesses "stopped"
  // before the first answer arrives would cry wolf on every page load.
  if (data === undefined) {
    return null;
  }

  const live = data.is_live === true;
  const when = data.last_heartbeat_at;
  return (
    <span
      className={`sync-status ${live ? 'sync-live' : 'sync-stopped'}`}
      // Never a colour alone: the words say which state this is, and the
      // title says when it was last true.
      title={
        when === null
          ? 'No collector has ever checked in'
          : `Last checked in ${since(when, now ?? new Date())}`
      }
    >
      <span className="sync-dot" />
      {live ? 'Real-time sync' : 'Real-time sync stopped'}
    </span>
  );
}
