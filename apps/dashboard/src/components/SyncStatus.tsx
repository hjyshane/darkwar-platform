import { useQuery } from '@tanstack/react-query';
import { COLLECTOR_TOPICS } from '../lib/realtime';
import { supabase } from '../lib/supabase';

/** Whether the board is still being fed.
 *
 * Every panel already carries a freshness badge for its own data. This one
 * answers a different question — not "how old is this figure" but "is
 * anything still arriving at all" — and the difference matters when the
 * collector has stopped: the figures look exactly as they did an hour ago,
 * and nothing on screen would otherwise say why they have stopped moving.
 *
 * **That question needs two facts, and for a long time this badge showed
 * only one.** The heartbeat says a collector process is alive. It does not
 * say observations are arriving, and the difference is not hypothetical —
 * `dw-capture` has twice stalled in a way that leaves the process running
 * and the heartbeat beating while the journal stops growing entirely
 * (`docs/runbooks/continuous-collection.md`). Through all of it this badge
 * stayed green. So it now carries the newest collector-written notification
 * alongside the heartbeat, and lets the reader see the two ages disagree.
 *
 * The second fact is reported, not judged. A long gap is currently NORMAL —
 * nothing walks the game's screens yet, so observations arrive only while
 * somebody is playing, and a badge that cried "stopped" over that would be
 * wrong most of the day and ignored by the time it was right. When the ADB
 * routine lands and a gap does mean a fault, a threshold can go on top of a
 * number that is already on screen.
 *
 * Polled rather than pushed. dw-sync beats every ten seconds and the app's
 * realtime channel carries data changes, not health; a subscription would
 * mean a notification row six times a minute forever for a badge nobody is
 * watching most of the time. Twenty seconds of poll is cheaper and late by
 * at most that.
 *
 * The liveness threshold lives in the view (0060), not here, so "live" means
 * one thing whoever asks.
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

/** When a collector-written row last landed in Supabase.
 *
 * `created_at` is when the row arrived, not when the game was observed —
 * which is the right clock here. `captured_at` is what the panels' own
 * freshness badges already show, and a sync that has stopped forwarding an
 * hour-old capture is exactly the case these two ages have to separate.
 *
 * Filtered to `COLLECTOR_TOPICS` so that an admin's own typing cannot answer
 * this question. The `(topic, created_at desc)` index from 0004 serves the
 * filter and the ordering together.
 */
async function fetchNewestObservation(): Promise<string | null> {
  const { data, error } = await supabase
    .from('data_change_notifications')
    .select('created_at')
    .in('topic', COLLECTOR_TOPICS)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`newest observation query failed: ${error.message}`);
  }
  return (data as { created_at: string } | null)?.created_at ?? null;
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

export interface SyncBadge {
  live: boolean;
  /** The heartbeat half — the state, in words rather than in colour alone. */
  label: string;
  /** The observation half, or null while that answer is still unknown. */
  dataLabel: string | null;
  title: string;
}

/** Both halves as text, kept out of the component so the wording can be
 *  tested without a stubbed query layer.
 *
 * `newestObservationAt` distinguishes three answers that must not collapse
 * into each other: a timestamp, `null` for "nothing has ever arrived", and
 * `undefined` for "not known yet". Only the middle one is a statement about
 * the collector, so it is the only one that gets printed as one — an
 * unanswered query says nothing rather than "no data".
 */
export function describeSync(
  heartbeatAt: string | null,
  isLive: boolean,
  newestObservationAt: string | null | undefined,
  now: Date,
): SyncBadge {
  const heartbeatTitle =
    heartbeatAt === null
      ? 'No collector has ever checked in'
      : `Last checked in ${since(heartbeatAt, now)}`;
  if (newestObservationAt === undefined) {
    return {
      live: isLive,
      label: isLive ? 'Real-time sync' : 'Real-time sync stopped',
      dataLabel: null,
      title: heartbeatTitle,
    };
  }
  const dataTitle =
    newestObservationAt === null
      ? 'No observation has ever arrived'
      : `Newest observation arrived ${since(newestObservationAt, now)}`;
  return {
    live: isLive,
    label: isLive ? 'Real-time sync' : 'Real-time sync stopped',
    // "data" rather than "observation" in the badge itself: the long word is
    // the collector's vocabulary, and this line is read by members.
    dataLabel:
      newestObservationAt === null ? 'no data yet' : `data ${since(newestObservationAt, now)}`,
    title: `${heartbeatTitle} · ${dataTitle}`,
  };
}

export function SyncStatus({ now }: { now?: Date }) {
  const { data } = useQuery({
    queryKey: ['sync-status'],
    queryFn: fetchSyncStatus,
    refetchInterval: 20_000,
  });
  // A separate query rather than a widened view: `sync_status` is deliberately
  // one fact (0060), and the notification table is already readable by every
  // member. Failure here leaves the heartbeat half on screen instead of
  // taking the whole badge down with it.
  const { data: newestObservationAt, isSuccess: observationKnown } = useQuery({
    queryKey: ['sync-newest-observation'],
    queryFn: fetchNewestObservation,
    refetchInterval: 20_000,
  });

  // Nothing known yet, and nothing to claim. A badge that guesses "stopped"
  // before the first answer arrives would cry wolf on every page load.
  if (data === undefined) {
    return null;
  }

  const badge = describeSync(
    data.last_heartbeat_at,
    data.is_live === true,
    observationKnown ? newestObservationAt : undefined,
    now ?? new Date(),
  );
  return (
    <span
      className={`sync-status ${badge.live ? 'sync-live' : 'sync-stopped'}`}
      // Never a colour alone: the words say which state this is, and the
      // title says when each half was last true.
      title={badge.title}
    >
      <span className="sync-dot" />
      {badge.label}
      {badge.dataLabel !== null && (
        <>
          {/* Emphasis, not content — a screen reader reading "middle dot"
              between the two halves would be noise. */}
          <span aria-hidden="true">·</span>
          <span className="sync-data">{badge.dataLabel}</span>
        </>
      )}
    </span>
  );
}
