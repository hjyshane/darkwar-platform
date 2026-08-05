import { useState } from 'react';
import { supabase } from '../../lib/supabase';

/** Create an account.
 *
 * There was no way to. 0021 built the join-code flow and every part of it
 * works, but `JoinCodeForm` only renders for a signed-in viewer and nothing
 * created that viewer: an admin could issue a code and the person holding it
 * had nowhere to type it. `signUp` is the missing half.
 *
 * Signing up grants nothing. A new account is a `viewer` with no `app_users`
 * row until a code makes it a member — 0065's front door, unchanged. This
 * form only gets somebody to the doorstep.
 *
 * Confirmation is expected, so the copy says so and the form does not try to
 * sign the user in. Supabase returns a session immediately when
 * confirmations are off and a user with no session when they are on; the
 * difference is a project setting, and reading it back from the response is
 * more honest than assuming either.
 */
export function SignUpForm({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function signUp(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      setFailed(true);
      // Passed through: unlike sign-in, these are about the request rather
      // than about whether an account exists — a short password or a
      // malformed address. Supabase does not confirm existing accounts here
      // either; it returns a user with no identities instead.
      setMessage(error.message);
      return;
    }
    setFailed(false);
    if (data.session === null) {
      setMessage('Check your email for a confirmation link, then sign in.');
      return;
    }
    onSignedIn();
  }

  return (
    <form onSubmit={(event) => void signUp(event)}>
      <p className="empty">
        An account starts with no access. Once you have confirmed it and signed in, enter the
        invitation code an officer gave you.
      </p>
      <label>
        Email
        <input
          autoComplete="username"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>
      <label>
        Password
        <input
          autoComplete="new-password"
          // The database is not the place this is enforced; GoTrue is, and
          // it will say so. The attribute is here so the browser says it
          // first, before a round trip.
          minLength={8}
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </label>
      <button disabled={busy} type="submit">
        {busy ? 'Creating…' : 'Create account'}
      </button>
      {message && <p className={failed ? 'error' : 'empty'}>{message}</p>}
    </form>
  );
}
