import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { TERMS } from '../../lib/terms';
import { useSession } from '../../lib/useSession';
import { JoinCodeForm } from './JoinCodeForm';

/**
 * No longer unlinked. It was, back when signing in was an admin-only errand
 * and the shared screen looked the same either way — but 0020 moved
 * alliance contribution behind the member role, so ordinary members now
 * sign in to see their own alliance, and a page nobody can find is no use
 * to them. The nav links here and shows who you are.
 *
 * The address is still not the security boundary. Signing in only changes
 * which JWT the queries carry; what that JWT may read is decided by RLS.
 */
export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const { data: session } = useSession();
  const queryClient = useQueryClient();

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSessionEmail(data.session?.user.email ?? null);
    });
  }, []);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (signInError) {
      // One neutral message: this form does not confirm which part was wrong,
      // nor whether the account exists.
      setError('Sign-in failed.');
      return;
    }
    window.location.hash = '';
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSessionEmail(null);
  }

  function refreshSession() {
    // The role changed, so every cached answer was computed under the old
    // one — including the roster's contribution query, which returned
    // nothing a moment ago.
    void queryClient.invalidateQueries();
  }

  if (sessionEmail) {
    return (
      <main>
        <section aria-labelledby="login-heading">
          <h2 id="login-heading">{TERMS.signIn}</h2>
          <p>
            Signed in as {sessionEmail} — <strong>{session?.role ?? 'viewer'}</strong>.
          </p>
          {session?.role === 'viewer' && <JoinCodeForm onRedeemed={() => refreshSession()} />}
          <button onClick={() => void signOut()} type="button">
            Sign out
          </button>
        </section>
      </main>
    );
  }

  return (
    <main>
      <section aria-labelledby="login-heading">
        <h2 id="login-heading">{TERMS.signIn}</h2>
        <form onSubmit={(event) => void signIn(event)}>
          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? 'Signing in…' : TERMS.signIn}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </section>
    </main>
  );
}
