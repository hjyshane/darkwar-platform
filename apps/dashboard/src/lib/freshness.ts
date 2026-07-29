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
    return '방금';
  }
  if (minutes < 60) {
    return `${minutes}분 전`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}시간 전`;
  }
  return `${Math.floor(hours / 24)}일 전`;
}
