import { classifyFreshness, formatAge } from '../lib/freshness';

export function FreshnessBadge({ capturedAt, now }: { capturedAt: string | null; now?: Date }) {
  const current = now ?? new Date();
  const state = classifyFreshness(capturedAt, current);
  if (state === 'missing' || capturedAt === null) {
    return <span className="badge badge-missing">No data</span>;
  }
  // The word "(stale)" is gone; the age and the colour stay. "3d ago" already
  // says it, and the badge still carries `badge-stale`, so the styling and
  // anything asserting on the class are unaffected — this drops a label, not a
  // state.
  return (
    <span className={`badge badge-${state}`} title={capturedAt}>
      {formatAge(capturedAt, current)}
    </span>
  );
}
