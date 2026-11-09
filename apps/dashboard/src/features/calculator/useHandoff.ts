// The planner's end of "Load into my plan": read the target the address
// carries once on mount, strip it so a reload does not add it again, and once
// the account is known, add the target from the account's own level. Nothing
// is saved — the planner's Save is the only writer, as before.

import { useEffect, useState } from 'react';
import { replaceHash } from '../../lib/useHash';
import type { Account } from '../planner/accounts';
import { fetchCatalogSubjects } from '../planner/data';
import type { Target } from '../planner/targets';
import { type Handoff, handoffTarget, readHandoff, stripHandoff } from './handoff';

/** The name the planner's target list shows: the catalogue's name for the
 * subject, the way the pickers label it. */
async function subjectName(handoff: Handoff): Promise<string> {
  if (handoff.kind === 'vehicle') return 'Vehicle';
  const [found] = await fetchCatalogSubjects(handoff.kind, { subjects: [handoff.subject] });
  const name = found?.name ?? `#${handoff.subject}`;
  return handoff.kind === 'exclusive' ? `${name} · exclusive weapon` : name;
}

export function useHandoff(account: Account | undefined, onTarget: (target: Target) => void): void {
  const [pending, setPending] = useState<Handoff | null>(() => readHandoff(window.location.hash));
  useEffect(() => {
    const hash = window.location.hash;
    if (readHandoff(hash) !== null) replaceHash(stripHandoff(hash));
  }, []);
  // onTarget is a fresh closure every render; the hand-off runs once per
  // pending target and account, which is what the two keys say.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (pending === null || account === undefined) return;
    let cancelled = false;
    subjectName(pending)
      .catch(() => `#${pending.subject}`)
      .then((name) => {
        if (cancelled) return;
        const target = handoffTarget(pending, account, name);
        if (target !== null) onTarget(target);
        setPending(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pending, account]);
}
