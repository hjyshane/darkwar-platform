import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useSession } from '../../lib/useSession';
import { canSubmitEmail, emailProblem } from './email';

/** Change the address this account signs in with.
 *
 * THIS ONE DEPENDS ON EMAIL WORKING, unlike the password form above it.
 * `updateUser({ email })` changes nothing by itself — it sends a confirmation
 * link, and `double_confirm_changes = true` means both the old and the new
 * address get one. The screen says so, because otherwise the honest outcome
 * ("accepted, then silence") is indistinguishable from a broken button.
 */
export function EmailForm() {
  const { data: session } = useSession();
  const current = session?.email ?? null;
  const [next, setNext] = useState('');
  const [sent, setSent] = useState(false);

  const change = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.updateUser({ email: next.trim() });
      if (error) {
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      setSent(true);
      setNext('');
    },
  });

  const problem = emailProblem(next, current);
  const ready = canSubmitEmail(next, current);

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !change.isPending) {
          setSent(false);
          change.mutate();
        }
      }}
    >
      <p className="hint">
        Signing in as <strong>{current ?? '—'}</strong>.
      </p>

      <label htmlFor="new-email">
        New address
        <input
          autoComplete="email"
          id="new-email"
          onChange={(event) => setNext(event.target.value)}
          type="email"
          value={next}
        />
      </label>

      {problem !== null && <p className="error">{problem}</p>}

      <div>
        <button disabled={!ready || change.isPending} type="submit">
          {change.isPending ? 'Sending…' : 'Send confirmation'}
        </button>
      </div>

      {change.error !== null && <p className="error">{change.error.message}</p>}
      {sent && change.error === null && (
        <p className="hint">
          Confirmation sent. The address does not change until the link is opened — and it goes to
          both your old and your new address.
        </p>
      )}

      {/* Said before they press it, not after. While custom SMTP is
          unconfigured this request succeeds and then nothing arrives, which
          looks exactly like a broken button. */}
      <p className="hint">
        This needs email to work. If confirmation mail is not arriving yet, the address will not
        change — your password can still be changed above, which needs no email.
      </p>
    </form>
  );
}
