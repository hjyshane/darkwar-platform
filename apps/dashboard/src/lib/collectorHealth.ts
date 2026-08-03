// Whether a collector is still checking in, per collector rather than for
// the board as a whole.
//
// `collectors.status` is what the collector last SAID about itself, and a
// process that died mid-sentence leaves "healthy" behind it forever. The
// claim and the age of the claim are two facts and the screen needs both:
// "healthy, 4 seconds ago" and "healthy, three days ago" are not the same
// report, and only one of them is about now.
//
// The threshold is the one in `sync_status` (0060), which says in as many
// words that it lives in SQL so that "live" means one thing. Restating it
// here makes a second copy, so collectorHealth.test.ts reads that migration
// and fails if the two drift.

export const LIVE_WITHIN_MS = 60_000;

export type CollectorState = 'live' | 'silent' | 'never';

export function collectorState(lastHeartbeatAt: string | null, now: Date): CollectorState {
  if (lastHeartbeatAt === null) {
    return 'never';
  }
  return now.getTime() - new Date(lastHeartbeatAt).getTime() <= LIVE_WITHIN_MS ? 'live' : 'silent';
}

/** Reuses the freshness palette rather than adding a third set of colours:
 *  live/silent/never mean exactly what fresh/stale/missing already mean. */
export function collectorBadgeClass(state: CollectorState): string {
  if (state === 'live') {
    return 'badge badge-fresh';
  }
  return state === 'silent' ? 'badge badge-stale' : 'badge badge-missing';
}

/** What to print for a collector's own claim about itself.
 *
 * A silent collector's status is reported in the past tense. Printing
 * `healthy` unqualified next to a heartbeat three days old would be the
 * board asserting something it has no evidence for.
 */
export function claimedStatusLabel(status: string, state: CollectorState): string {
  if (state === 'never') {
    return '—';
  }
  return state === 'live' ? status : `last said ${status}`;
}
