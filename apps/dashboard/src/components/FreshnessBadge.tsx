import { classifyFreshness, formatAge } from '../lib/freshness';

export function FreshnessBadge({ capturedAt, now }: { capturedAt: string | null; now?: Date }) {
  const current = now ?? new Date();
  const state = classifyFreshness(capturedAt, current);
  if (state === 'missing' || capturedAt === null) {
    return <span className="badge badge-missing">데이터 없음</span>;
  }
  return (
    <span className={`badge badge-${state}`} title={capturedAt}>
      {formatAge(capturedAt, current)}
      {state === 'stale' ? ' (오래됨)' : ''}
    </span>
  );
}
