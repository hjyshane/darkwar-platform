import { useQuery } from '@tanstack/react-query';
import { StatTile } from '../../components/StatTile';
import { formatAge } from '../../lib/freshness';
import {
  type BeatRow,
  type QueueSnapshot,
  latestPairs,
  minutesToEmpty,
  sendRate,
  snapshotOf,
  tableOf,
} from '../../lib/queueStatus';
import { supabase } from '../../lib/supabase';

/** What the collector is waiting to send and receive (admin only, in Settings).
 *
 * Up: the collector's outbox - rows written to its journal and not yet accepted by the
 * database - as each heartbeat reports it, with what is in it, how old the oldest row is,
 * how fast it is moving and why rows were given up on. Down: jobs the dashboard has queued
 * for the collector to pick up. Read-only: nothing here changes either queue. */

const POLL = 20_000;

async function fetchBeats(): Promise<BeatRow[]> {
  // A few hundred beats cover about an hour from each collector, which is enough to measure
  // a rate across five minutes.
  const { data, error } = await supabase
    .from('collector_heartbeats')
    .select('collector_id, status, outbox_depth, details, reported_at')
    .order('reported_at', { ascending: false })
    .limit(400);
  if (error) throw new Error(error.message);
  return data as BeatRow[];
}

async function fetchNames(): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('collectors')
    .select('collector_id, name')
    .neq('name', 'manual entry');
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((row) => [row.collector_id, row.name]));
}

async function fetchJobs(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('refresh_jobs')
    .select('status')
    .in('status', ['queued', 'claimed', 'running', 'failed', 'dead_letter'])
    .limit(1000);
  if (error) throw new Error(error.message);
  const counts: Record<string, number> = {};
  for (const row of data ?? []) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return counts;
}

const plain = new Intl.NumberFormat('en');
const num = (n: number | null) => (n === null ? '—' : plain.format(Math.round(n)));

function duration(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 1) return 'under a minute';
  if (minutes < 90) return `${Math.round(minutes)} min`;
  if (minutes < 60 * 36) return `${(minutes / 60).toFixed(1)} h`;
  return `${Math.round(minutes / 60 / 24)} d`;
}

function Bars({ rows, total }: { rows: Array<[string, number]>; total: number }) {
  const max = Math.max(1, ...rows.map(([, n]) => n));
  return (
    <ul className="queue-bars">
      {rows.map(([label, n]) => (
        <li key={label}>
          <span className="queue-bar-label" title={label}>
            {label}
          </span>
          <span className="queue-bar-track" aria-hidden="true">
            <span className="queue-bar-fill" style={{ width: `${(n / max) * 100}%` }} />
          </span>
          <span className="queue-bar-count">
            {num(n)}
            {total > 0 && <span className="subtle"> · {Math.round((n / total) * 100)}%</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Collector({
  name,
  now,
  before,
  clock,
}: {
  name: string;
  now: QueueSnapshot;
  before: QueueSnapshot | null;
  clock: Date;
}) {
  const rate = sendRate(now, before);
  const eta = minutesToEmpty(now, before);
  return (
    <section className="planner-card">
      <h3>{name}</h3>
      <div className="stats">
        <StatTile hero label="Waiting to send" value={num(now.pending)} />
        <StatTile label="Given up on" value={num(now.deadLetters)} />
        <StatTile
          label="Oldest waiting"
          value={now.oldestPendingAt ? formatAge(now.oldestPendingAt, clock) : null}
        />
        <StatTile label="Sent per minute" value={rate === null ? null : num(rate)} />
        <StatTile label="Empty in" value={eta === null ? null : duration(eta)} />
      </div>
      <p className="subtle">
        Reported {formatAge(now.reportedAt, clock)}
        {now.sent !== null && ` · ${num(now.sent)} sent in all`}
        {before === null && ' · the rate needs a beat from five minutes earlier'}
      </p>

      {now.pendingByEvent.length > 0 && (
        <>
          <h4>What is waiting</h4>
          <Bars
            rows={now.pendingByEvent.map(([event, n]) => [tableOf(event), n])}
            total={now.pending}
          />
        </>
      )}
      {now.deadByError.length > 0 && (
        <>
          <h4>Why rows were given up on</h4>
          <Bars rows={now.deadByError} total={now.deadLetters} />
          <p className="note">
            Network and time-out errors can be sent again with the collector's{' '}
            <code>retry-outbox</code> once the queue has drained; a database error (a missing parent
            row, for instance) usually clears by itself when the parent arrives.
          </p>
        </>
      )}
    </section>
  );
}

export function QueueStatus({ now }: { now?: Date }) {
  const clock = now ?? new Date();
  const beats = useQuery({ queryKey: ['queue-beats'], queryFn: fetchBeats, refetchInterval: POLL });
  const names = useQuery({ queryKey: ['queue-names'], queryFn: fetchNames, staleTime: 5 * 60_000 });
  const jobs = useQuery({ queryKey: ['queue-jobs'], queryFn: fetchJobs, refetchInterval: POLL });

  if (beats.isPending) return <p className="empty loading">Loading…</p>;
  if (beats.error) return <p className="error">Could not load the queue: {beats.error.message}</p>;
  const pairs = latestPairs(beats.data);
  if (pairs.size === 0) {
    return <p className="empty">No collector has reported yet.</p>;
  }

  return (
    <>
      <p className="subtle">
        Rows each collector has written but the database has not yet accepted, and jobs waiting for
        a collector to pick them up. Refreshed every 20 seconds.
      </p>
      {[...pairs].map(([id, pair]) => (
        <Collector
          key={id}
          name={names.data?.get(id) ?? id.slice(0, 8)}
          now={snapshotOf(pair.now)}
          before={pair.before === null ? null : snapshotOf(pair.before)}
          clock={clock}
        />
      ))}

      <section className="planner-card">
        <h3>Jobs for the collector</h3>
        {jobs.error && <p className="error">Could not load jobs: {jobs.error.message}</p>}
        {jobs.data && (
          <p>
            Queued <strong>{num(jobs.data.queued ?? 0)}</strong> · running{' '}
            <strong>{num((jobs.data.claimed ?? 0) + (jobs.data.running ?? 0))}</strong> · failed{' '}
            <strong>{num((jobs.data.failed ?? 0) + (jobs.data.dead_letter ?? 0))}</strong>
          </p>
        )}
      </section>
    </>
  );
}
