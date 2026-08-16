import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { takeReturnTo } from '../../lib/returnTo';
import { supabase } from '../../lib/supabase';
import { TERMS } from '../../lib/terms';
import { useSession } from '../../lib/useSession';
import { JoinCodeForm } from './JoinCodeForm';
import { LeaveAllianceForm } from './LeaveAllianceForm';
import { PlayerClaimForm } from './PlayerClaimForm';
import { SignUpForm } from './SignUpForm';

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
  const [creating, setCreating] = useState(false);
  const { data: session } = useSession();
  const queryClient = useQueryClient();

  // Set by this page's own sign-in and sign-up, so the effect below can tell
  // "just got in" from "was already signed in and came here on purpose".
  const [arriving, setArriving] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSessionEmail(data.session?.user.email ?? null);
    });
  }, []);

  // Leave for the board only once the role says there is a board to see.
  //
  // Signing in used to jump to `takeReturnTo()` the instant the password was
  // accepted. For a brand-new account that meant the members-only wall — while
  // the invitation-code form it actually needed sat on the page it had just
  // been thrown off. Sign up, code, character is meant to be one flow and it
  // was broken in the middle.
  //
  // THE DECISION IS MADE ONCE, which is why `arriving` is cleared either way.
  // Redeeming a code turns a viewer into a member, and if this still fired on
  // that change it would navigate away from the character picker the moment
  // the picker appeared — the exact step this is here to protect.
  // WAIT FOR THE SESSION TO BE THE NEW ONE. `session` is a cached query, and
  // for somebody who arrived signed out it holds `{email: null, role:
  // 'viewer'}` until the refetch lands. Acting on that value fired the effect
  // immediately, cleared `arriving`, took the viewer branch and stayed put —
  // so signing in left you on the sign-in page even as an admin, with the
  // refetch arriving a moment later and nothing left to act on it.
  //
  // Matching on the address is what makes the wait terminate: `sessionEmail`
  // is set by the sign-in that started this, so the effect resumes exactly
  // when the session query is answering about that account.
  useEffect(() => {
    if (!arriving || session === undefined || sessionEmail === null) {
      return;
    }
    if (session.email !== sessionEmail) {
      return;
    }
    setArriving(false);
    if (session.role !== 'viewer') {
      // `takeReturnTo()` is empty for an ordinary sign-in, and assigning an
      // empty hash leaves the address at a bare `#`. Naming the overview is
      // the same destination said out loud.
      window.location.hash = takeReturnTo() || '#/';
    }
  }, [arriving, session, sessionEmail]);

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
    // Not straight to `takeReturnTo()`. Where to go depends on what this
    // account turns out to be, and the role has not arrived yet — the effect
    // above decides once it has. A member goes back to the page they were sent
    // to; a viewer stays here, where the invitation code is.
    setSessionEmail(email.trim());
    setArriving(true);
    void queryClient.invalidateQueries();
  }

  /** Sign in through a provider, which skips the email path entirely.
   *
   * DISCORD IS FIRST ON THE SCREEN because the alliance already lives there —
   * every member has an account, which is not true of Google, and a Hotmail-only
   * member would otherwise have to make one just to sign in.
   *
   * NO `arriving` DANCE HERE. `signInWithOAuth` navigates the browser away to
   * Google and comes back through `/auth/v1/callback`, so this component is
   * unmounted before a redirect decision could be made — the session is
   * already established when the app reloads, and the reader lands wherever
   * the returning URL puts them.
   *
   * The provider has to be enabled in Supabase (Authentication → Sign In /
   * Providers → Google). If it is not, this returns "Unsupported provider"
   * rather than throwing, and the message is shown as written: a button that
   * fails silently is worse than one that says why.
   */
  async function signInWithProvider(provider: 'google' | 'discord') {
    setBusy(true);
    setError(null);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider,
      // Back to where the reader actually is, rather than to Site URL's
      // default — the two differ while an old address is still bookmarked.
      options: { redirectTo: window.location.origin },
    });
    if (oauthError) {
      setBusy(false);
      setError(oauthError.message);
    }
    // No `setBusy(false)` on success: the browser is leaving.
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
          {/* One screen, and the order is forced rather than chosen: a viewer
              cannot read `players` (0065), so the character picker would be an
              empty list, and `player_claims` refuses an insert from a viewer
              anyway (0068). So the code comes first and the picker replaces it
              the moment the role changes — as close to "choose your character
              while joining" as the gate allows.
              Not numbered: the two never appear together, so "step 2" would
              be labelling something with nothing above it. */}
          {session?.role === 'viewer' && (
            <>
              <h3>Enter your invitation code</h3>
              <JoinCodeForm onRedeemed={() => refreshSession()} />
            </>
          )}
          {session !== undefined && session.role !== 'viewer' && (
            <>
              <h3>Which character are you?</h3>
              <PlayerClaimForm />
            </>
          )}
          <button onClick={() => void signOut()} type="button">
            Sign out
          </button>
          {/* Only once there is something to leave. Offering it to a viewer
              would be offering to give up access they have not been granted,
              and `leave_alliance()` returns quietly for that case anyway. */}
          {session !== undefined && session.role !== 'viewer' && <LeaveAllianceForm />}
        </section>
      </main>
    );
  }

  if (creating) {
    return (
      <main>
        <section aria-labelledby="login-heading">
          <h2 id="login-heading">Create an account</h2>
          {/* Same treatment as signing in. A confirmation-free project hands
              back a session here, and sending that straight to the board would
              land a brand-new viewer on the wall — one step after creating the
              account, and one step before the code that would have let them in. */}
          <SignUpForm
            onSignedIn={(signedInEmail) => {
              setCreating(false);
              setSessionEmail(signedInEmail);
              setArriving(true);
              void queryClient.invalidateQueries();
            }}
          />
          <button onClick={() => setCreating(false)} type="button">
            I already have an account
          </button>
        </section>
      </main>
    );
  }

  return (
    <main>
      <section aria-labelledby="login-heading">
        <h2 id="login-heading">{TERMS.signIn}</h2>
        {/* Above the form, because it is the shorter path and the one that
            never needs a reset mail — the reason OAuth was wanted at all. */}
        <button
          className="oauth-button"
          disabled={busy}
          onClick={() => void signInWithProvider('discord')}
          type="button"
        >
          Continue with Discord
        </button>
        <button
          className="oauth-button"
          disabled={busy}
          onClick={() => void signInWithProvider('google')}
          type="button"
        >
          Continue with Google
        </button>
        <p className="hint">or sign in with an email address</p>
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
        {/* The reason this page existed and could not be reached: an
            invitation code needs an account to redeem it, and nothing made
            one. */}
        <p>
          No account yet?{' '}
          <button className="linklike" onClick={() => setCreating(true)} type="button">
            Create one
          </button>
        </p>
      </section>
    </main>
  );
}
