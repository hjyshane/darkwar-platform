import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { TERMS } from '../../lib/terms';

/**
 * Unlinked, like #/month-cards: nothing on the dashboard points here, and
 * there is no logged-in indicator anywhere else — the shared screen stays
 * identical whether an admin is signed in or not. Sign-out therefore also
 * lives HERE: revisit the address to see who you are or to leave.
 *
 * The address is not the security boundary. Signing in only changes which
 * JWT the queries carry; what that JWT may read is decided by RLS.
 */
export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);

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

  if (sessionEmail) {
    return (
      <main>
        <section aria-labelledby="login-heading">
          <h2 id="login-heading">{TERMS.signIn}</h2>
          <p>Signed in as {sessionEmail}.</p>
          <button type="button" onClick={() => void signOut()}>
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
