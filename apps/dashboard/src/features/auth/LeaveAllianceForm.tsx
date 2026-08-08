import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { supabase } from '../../lib/supabase';

/** Give up your own access.
 *
 * There was no way to do this. An admin could take somebody's access away and
 * the person themselves could not, which put "I am done with this alliance"
 * in the queue behind someone else noticing.
 *
 * It calls `leave_alliance()` (0094) rather than writing `app_users`, because
 * that table is written under `members.manage` and the person leaving does
 * not have it. The function's predicate is `auth.uid()` and nothing else, so
 * it cannot be pointed at anybody.
 *
 * Two clicks, not a typed confirmation. The consequence is real but it is not
 * destruction — the login survives, favourites survive, and a join code
 * admits them again — so making somebody type their email would overstate it.
 * What the second click buys is that the first one cannot be a misclick on a
 * screen whose other button says "Sign out".
 */
export function LeaveAllianceForm() {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const leave = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('leave_alliance');
      if (error) {
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      setFailed(false);
      setConfirming(false);
      setMessage('Done. You are signed in as a viewer now.');
      // Everything cached was computed under the old role, and most of it is
      // about to come back empty — the same reason redeeming a code
      // invalidates the lot.
      void queryClient.invalidateQueries();
    },
    onError: (error: Error) => {
      setFailed(true);
      // The last-admin refusal arrives here, and it is the one message on
      // this screen that tells the reader what to do instead.
      setMessage(error.message);
    },
  });

  return (
    <>
      {confirming ? (
        <p className="empty">
          Leaving takes away your access to member pages. Your sign-in, your favourites and anything
          you have posted all stay, and an invitation code lets you back in.
        </p>
      ) : null}
      <button
        className="danger"
        disabled={leave.isPending}
        onClick={() => (confirming ? leave.mutate() : setConfirming(true))}
        type="button"
      >
        {leave.isPending
          ? 'Leaving…'
          : confirming
            ? 'Yes, leave the alliance'
            : 'Leave the alliance'}
      </button>
      {confirming && !leave.isPending && (
        <button onClick={() => setConfirming(false)} type="button">
          Cancel
        </button>
      )}
      {message && <p className={failed ? 'error' : 'empty'}>{message}</p>}
    </>
  );
}
