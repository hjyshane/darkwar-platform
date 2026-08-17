// FR-UI-007/008: every important number carries its source timestamp, and
// stale/missing data must be visually distinct from fresh data.

export type Freshness = 'fresh' | 'stale' | 'missing';

// A DAY, not an hour.
//
// An hour was right when the only question was "is the collector running": a
// board an hour old meant something had stopped. It is the wrong question for
// the reader, who wants to know whether a figure is worth acting on — and a
// roster captured this morning is worth acting on this evening.
//
// The hour-old threshold also painted almost every board amber almost all the
// time, because the routine opens most screens a few times a day rather than
// hourly. A warning colour that is always on is not a warning.
//
// "Has the collector stopped" is answered properly elsewhere and in red: the
// SyncStatus badge in the header, from the heartbeat (0060), and the
// `sync_stalled` Discord alert. Those are about the machine. This is about the
// figure.
const STALE_AFTER_MS = 24 * 60 * 60_000;

export function classifyFreshness(capturedAt: string | null, now: Date): Freshness {
  if (capturedAt === null) {
    return 'missing';
  }
  const age = now.getTime() - new Date(capturedAt).getTime();
  return age > STALE_AFTER_MS ? 'stale' : 'fresh';
}

export function formatAge(capturedAt: string, now: Date): string {
  const ageMs = Math.max(0, now.getTime() - new Date(capturedAt).getTime());
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

/** Presence as a phrase.
 *
 * `onlineState` null means we have never observed this player's presence —
 * they are outside the alliance, the roster came back redacted, or the
 * reader is not a member. None of those is the same as being offline, so it
 * reads as unknown rather than as an absence (FR-UI-008).
 */
export function formatLastOnline(
  onlineState: string | null,
  lastOnlineAt: string | null,
  now: Date,
): string {
  if (onlineState === null) {
    return '—';
  }
  if (onlineState === 'online') {
    return 'Online now';
  }
  return lastOnlineAt === null ? 'Offline' : formatAge(lastOnlineAt, now);
}

export type PassStatus = 'active' | 'expiring' | 'expired' | 'none';

const EXPIRING_WITHIN_DAYS = 7;

/** Monthly pass state. `null` means we have never observed a pass for this
 * player — which is not the same as one that has run out. */
export function classifyPass(expiresAt: string | null, now: Date): PassStatus {
  if (expiresAt === null) {
    return 'none';
  }
  const daysLeft = (new Date(expiresAt).getTime() - now.getTime()) / 86_400_000;
  if (daysLeft < 0) {
    return 'expired';
  }
  return daysLeft <= EXPIRING_WITHIN_DAYS ? 'expiring' : 'active';
}

export function formatPass(expiresAt: string | null, now: Date): string {
  const status = classifyPass(expiresAt, now);
  if (status === 'none' || expiresAt === null) {
    return '—';
  }
  if (status === 'expired') {
    return 'Expired';
  }
  const daysLeft = Math.floor((new Date(expiresAt).getTime() - now.getTime()) / 86_400_000);
  // `D-n` is a Korean/Japanese convention; the rest of the UI speaks the
  // game's English, so count down in words.
  return daysLeft === 0 ? 'Expires today' : `${daysLeft}d left`;
}
