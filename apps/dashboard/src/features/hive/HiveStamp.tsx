// Who last changed a hive plan, and what the editor says when somebody else
// saved first (0330). Presentational only: the decisions are in hiveSafety.ts.

import { readZone } from '../../lib/timezone';
import { stampText, whenText } from './hiveSafety';

/** "Last changed by Mina · 14:32", in the reader's chosen clock. */
export function Stamp({ name, at }: { name: string | null; at: string }) {
  return <p className="subtle hive-stamp">{stampText(name, at, readZone(), new Date())}</p>;
}

/** Somebody else saved while this officer had unsaved changes.
 *
 * THE CHANGES STAY ON SCREEN. They cannot be saved over the newer plan — the
 * owner chose refusal over "overwrite anyway" (2026-11-15) — but they are the
 * officer's to look at until they choose to load the new version, which drops
 * them. */
export function ConflictBanner({
  name,
  at,
  onLoad,
}: {
  name: string | null;
  at: string;
  onLoad: () => void;
}) {
  return (
    <div className="hive-conflict" role="alert">
      <p>
        <strong>{name ?? 'Someone'}</strong> changed this plan at{' '}
        {whenText(at, readZone(), new Date())}. Your changes can't be saved over theirs.
      </p>
      <p>
        <button onClick={onLoad} type="button">
          Load the new version
        </button>{' '}
        <span className="subtle">(your unsaved changes will be dropped)</span>
      </p>
    </div>
  );
}
