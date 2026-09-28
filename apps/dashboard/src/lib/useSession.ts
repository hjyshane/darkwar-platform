import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

export type AppRole = 'viewer' | 'member' | 'officer' | 'admin';

export interface SessionState {
  email: string | null;
  role: AppRole;
  /** The auth uuid, for the few places that have to name the caller in a row
   * they are writing — recording activity (0114) is the first. Read from the
   * session that was already fetched here rather than by a second
   * `auth.getUser()` round trip at every call site. Null when signed out. */
  userId: string | null;
  /** The character this account is, or null when nobody has linked it.
   *
   * Only an admin can set this (0066: `approve_player_claim` is the one
   * writer), so it is a fact about the account rather than something the
   * client asserts. It rides along on the row this hook already reads,
   * because the alternative is every screen that wants to say "this one is
   * yours" doing its own lookup — and the hive board is the first screen
   * where that sentence is the point rather than a nicety.
   */
  playerId: string | null;
}

/** Who the viewer is, as the database sees it.
 *
 * `role` comes from current_app_role(), not from anything the client asserts — the
 * same value RLS uses. It is here to EXPLAIN what is visible, never to
 * decide it: hiding a panel because the role looks low would be decoration,
 * since the rows are already filtered server-side either way.
 *
 * Signed out, and signed in without a role row, both read 'viewer', which
 * is what current_app_role() falls back to.
 */
export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: async (): Promise<SessionState> => {
      const { data } = await supabase.auth.getSession();
      const email = data.session?.user.email ?? null;
      const userId = data.session?.user.id ?? null;
      if (email === null) {
        return { email: null, role: 'viewer', userId: null, playerId: null };
      }
      // A viewer's own row is readable via the self_read policy; no row at
      // all is the normal state for an account nobody has admitted yet.
      //
      // The role is asked of current_app_role() rather than read off the
      // row: since 0193 it is the role in the alliance being viewed, which
      // the row cannot know. Same function every policy calls.
      const [{ data: rows }, { data: role }] = await Promise.all([
        supabase
          .from('app_users')
          .select('player_id')
          .eq('user_id', data.session?.user.id ?? '')
          .limit(1),
        supabase.rpc('current_app_role'),
      ]);
      const row = rows?.[0];
      return {
        email,
        userId,
        playerId: row?.player_id ?? null,
        role: role === 'member' || role === 'officer' || role === 'admin' ? role : 'viewer',
      };
    },
  });
}
