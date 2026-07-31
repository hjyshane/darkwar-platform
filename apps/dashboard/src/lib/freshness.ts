// FR-UI-007/008: every important number carries its source timestamp, and
// stale/missing data must be visually distinct from fresh data.

export type Freshness = 'fresh' | 'stale' | 'missing';

const STALE_AFTER_MS = 60 * 60_000;

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
