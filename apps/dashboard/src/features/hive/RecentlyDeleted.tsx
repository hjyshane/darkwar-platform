// "Recently deleted": the officers' way back from a delete (0330).
//
// A deleted plan stays restorable for 30 days, then the database's daily
// cleanup removes it for good. Members never see any of this; the policy that
// hides a deleted plan from them is the same one that shows it to officers.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { readZone } from '../../lib/timezone';
import { type Formation, restoreFormation } from './hiveFormations';
import { KEEP_DELETED_DAYS, keptUntil, whenText } from './hiveSafety';

function useRestore(onRestored: (formation: Formation) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (formation: Formation) => restoreFormation(formation.formationId),
    onSuccess: (_, formation) => {
      onRestored(formation);
      return queryClient.invalidateQueries({ queryKey: ['hive'] });
    },
  });
}

/** The restore list. `plans` are the deleted plans still inside the 30 days,
 * from the page's one plan query. Renders nothing when there are none. */
export function RecentlyDeleted({
  plans,
  onRestored,
}: {
  plans: readonly Formation[];
  onRestored: (formation: Formation) => void;
}) {
  const restore = useRestore(onRestored);
  // In the reader's chosen clock, like every other date on the hive screens.
  const day = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: readZone(),
  });

  if (plans.length === 0) {
    return null;
  }
  return (
    <details className="hive-new">
      <summary>Recently deleted ({plans.length})</summary>
      <p className="subtle">
        A deleted plan can be restored for {KEEP_DELETED_DAYS} days. It comes back as a draft, not
        as the live plan.
      </p>
      <ul className="hive-deleted">
        {plans.map((plan) => (
          <li key={plan.formationId}>
            <span>
              <strong>{plan.name}</strong> · server {plan.serverId} · deleted by{' '}
              {plan.deletedByName ?? 'someone'}
              {plan.deletedAt !== null && (
                <>
                  , {day.format(new Date(plan.deletedAt))} · kept until{' '}
                  {day.format(keptUntil(plan.deletedAt))}
                </>
              )}
            </span>
            <button disabled={restore.isPending} onClick={() => restore.mutate(plan)} type="button">
              {restore.isPending && restore.variables?.formationId === plan.formationId
                ? 'Restoring…'
                : 'Restore'}
            </button>
          </li>
        ))}
      </ul>
      {restore.error && <p className="error">{(restore.error as Error).message}</p>}
    </details>
  );
}

/** The plan on screen was deleted by somebody else.
 *
 * THE SCREEN STAYS ON IT, unsaved changes and all, rather than quietly moving
 * to another plan and taking them away. Nothing can be saved to a deleted
 * plan; restoring it keeps its version (0330), so a draft that was open when
 * it was deleted can be saved as soon as it is back. */
export function DeletedUnderYou({ formation }: { formation: Formation }) {
  const restore = useRestore(() => undefined);
  return (
    <div className="hive-conflict" role="alert">
      <p>
        <strong>{formation.deletedByName ?? 'Someone'}</strong> deleted {formation.name}
        {formation.deletedAt !== null && (
          <> at {whenText(formation.deletedAt, readZone(), new Date())}</>
        )}
        . Nothing on it can be saved until it is restored; anything you have not saved is still
        here.
      </p>
      <p>
        <button
          disabled={restore.isPending}
          onClick={() => restore.mutate(formation)}
          type="button"
        >
          {restore.isPending ? 'Restoring…' : 'Restore it'}
        </button>
      </p>
      {restore.error && <p className="error">{(restore.error as Error).message}</p>}
    </div>
  );
}
