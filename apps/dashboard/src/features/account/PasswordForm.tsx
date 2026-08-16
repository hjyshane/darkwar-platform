import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { MIN_PASSWORD_LENGTH, canSubmitPassword, passwordProblem } from './password';

/** Set your own password, without leaving the app.
 *
 * NO EMAIL IN THIS PATH. `updateUser` acts on the session you are already in,
 * which is what makes it the one recovery route that works while SMTP is
 * unconfigured. A member who was handed a temporary password out of band can
 * replace it here the moment they sign in.
 *
 * The fields are `autoComplete="new-password"` so a password manager offers to
 * store the new one rather than filling the old.
 */
export function PasswordForm() {
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);

  const change = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) {
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      setDone(true);
      setNext('');
      setConfirm('');
    },
  });

  const problem = passwordProblem(next, confirm);
  const ready = canSubmitPassword(next, confirm);

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !change.isPending) {
          setDone(false);
          change.mutate();
        }
      }}
    >
      <p className="hint">
        Changing it here needs no email, so it works even when the confirmation mail does not.
      </p>

      <label htmlFor="new-password">
        New password
        <input
          autoComplete="new-password"
          id="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          onChange={(event) => setNext(event.target.value)}
          type="password"
          value={next}
        />
      </label>

      <label htmlFor="confirm-password">
        Again
        <input
          autoComplete="new-password"
          id="confirm-password"
          onChange={(event) => setConfirm(event.target.value)}
          type="password"
          value={confirm}
        />
      </label>

      {/* Twice, because `secure_password_change` is off: nothing asks for the
          old password, so the only guard against a typo is the reader — and a
          mistyped password on an account whose reset mail does not arrive
          locks somebody out of the alliance. */}
      {problem !== null && <p className="error">{problem}</p>}

      <div>
        <button disabled={!ready || change.isPending} type="submit">
          {change.isPending ? 'Saving…' : 'Change password'}
        </button>
      </div>

      {change.error !== null && <p className="error">{change.error.message}</p>}
      {done && change.error === null && (
        <p className="hint">
          Changed. Your other devices stay signed in — sign out there if that is not what you want.
        </p>
      )}
    </form>
  );
}
