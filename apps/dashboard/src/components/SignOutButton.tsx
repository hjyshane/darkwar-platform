import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { supabase } from '../lib/supabase';

/** Sign out, from the header, wherever you are.
 *
 * It used to live only on the login screen — the one page somebody already
 * signed in has no reason to open. Worse for a signed-in non-member: they land
 * on the wall (0065), every tab is hidden, and there was no way out of it
 * except clearing site data by hand.
 *
 * The cache is cleared as well as the session. React Query keeps whatever the
 * previous account could read, and those rows are alliance-internal — leaving
 * them in memory for the next person to sign in on the same browser would show
 * them a roster they may have no right to. `clear` rather than `invalidate`,
 * because invalidating refetches and the point is to forget.
 */
export function SignOutButton({ email }: { email: string }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function signOut(): Promise<void> {
    setBusy(true);
    await supabase.auth.signOut();
    queryClient.clear();
    setBusy(false);
  }

  return (
    <button
      className="sign-out"
      disabled={busy}
      onClick={() => void signOut()}
      // The address, not just "Sign out": on a shared browser the useful
      // question is which account is about to be signed out of.
      title={`Signed in as ${email}`}
      type="button"
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
