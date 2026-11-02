// The collector's upload queue as the admin panel shows it, read from the heartbeats.
//
// Each beat carries `outbox_depth` (rows waiting) and, in `details`, the dead-letter count and
// a `queue` block: rows sent so far, when the oldest pending row was written, which kinds of
// row are waiting and why dead letters died (the collector's `Journal.outbox_detail`). The
// rate and the time to empty are worked out between two beats, since a collector does not know
// its own speed any more than it knows what the cloud will accept.

export interface BeatRow {
  collector_id: string;
  status: string;
  outbox_depth: number | null;
  details: unknown;
  reported_at: string;
}

export interface QueueSnapshot {
  collectorId: string;
  status: string;
  reportedAt: string;
  pending: number;
  deadLetters: number;
  /** Rows sent since the journal began, or null from a collector that does not say. */
  sent: number | null;
  oldestPendingAt: string | null;
  pendingByEvent: Array<[string, number]>;
  deadByError: Array<[string, number]>;
}

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function entries(value: unknown): Array<[string, number]> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .sort((a, b) => b[1] - a[1]);
}

/** One beat as a snapshot. A beat from an older collector has no `queue` block: everything
 * it does not say comes out null or empty rather than zero. */
export function snapshotOf(beat: BeatRow): QueueSnapshot {
  const details =
    beat.details !== null && typeof beat.details === 'object'
      ? (beat.details as Record<string, unknown>)
      : {};
  const queue =
    details.queue !== null && typeof details.queue === 'object'
      ? (details.queue as Record<string, unknown>)
      : {};
  return {
    collectorId: beat.collector_id,
    status: beat.status,
    reportedAt: beat.reported_at,
    pending: beat.outbox_depth ?? 0,
    deadLetters: asNumber(details.dead_letters) ?? 0,
    sent: asNumber(queue.sent),
    oldestPendingAt: typeof queue.oldest_pending_at === 'string' ? queue.oldest_pending_at : null,
    pendingByEvent: entries(queue.pending_by_event),
    deadByError: entries(queue.dead_by_error),
  };
}

/** The newest beat of each collector, and the newest one at least `gapMs` older, which is
 * what the rate is measured against (two beats seconds apart would say nothing). */
export function latestPairs(
  beats: readonly BeatRow[],
  gapMs = 5 * 60_000,
): Map<string, { now: BeatRow; before: BeatRow | null }> {
  const byCollector = new Map<string, BeatRow[]>();
  for (const beat of beats) {
    const list = byCollector.get(beat.collector_id) ?? [];
    list.push(beat);
    byCollector.set(beat.collector_id, list);
  }
  const out = new Map<string, { now: BeatRow; before: BeatRow | null }>();
  for (const [id, list] of byCollector) {
    const sorted = [...list].sort((a, b) => b.reported_at.localeCompare(a.reported_at));
    const [now] = sorted;
    if (now === undefined) continue;
    const at = Date.parse(now.reported_at);
    const before = sorted.find((b) => at - Date.parse(b.reported_at) >= gapMs) ?? null;
    out.set(id, { now, before });
  }
  return out;
}

/** Rows sent per minute between two snapshots, or null when it cannot be told. */
export function sendRate(now: QueueSnapshot, before: QueueSnapshot | null): number | null {
  if (before === null || now.sent === null || before.sent === null) return null;
  const minutes = (Date.parse(now.reportedAt) - Date.parse(before.reportedAt)) / 60_000;
  if (minutes <= 0) return null;
  return Math.max(0, (now.sent - before.sent) / minutes);
}

/** Minutes until the queue is empty at the rate it grew or shrank. The queue also fills
 * while it empties, so the pending count's own change is used rather than the send rate:
 * null when it is not shrinking. */
export function minutesToEmpty(now: QueueSnapshot, before: QueueSnapshot | null): number | null {
  if (before === null || now.pending === 0) return now.pending === 0 ? 0 : null;
  const minutes = (Date.parse(now.reportedAt) - Date.parse(before.reportedAt)) / 60_000;
  if (minutes <= 0) return null;
  const shrinkingBy = (before.pending - now.pending) / minutes;
  return shrinkingBy > 0 ? now.pending / shrinkingBy : null;
}

/** `snapshot.arena_entry_heroes` -> `arena_entry_heroes`. */
export function tableOf(eventType: string): string {
  return eventType.replace(/^snapshot\./, '');
}
