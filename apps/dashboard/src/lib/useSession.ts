import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

export type AppRole = 'viewer' | 'member' | 'officer' | 'admin';

export interface SessionState {
  email: string | null;
  role: AppRole;
}

/** Who the viewer is, as the database sees it.
 *
 * `role` comes from app_users, not from anything the client asserts — the
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
      if (email === null) {
        return { email: null, role: 'viewer' };
      }
      // A viewer's own row is readable via the self_read policy; no row at
      // all is the normal state for an account nobody has admitted yet.
      const { data: rows } = await supabase
        .from('app_users')
        .select('role')
        .eq('user_id', data.session?.user.id ?? '')
        .limit(1);
      const role = rows?.[0]?.role;
      return {
        email,
        role: role === 'member' || role === 'officer' || role === 'admin' ? role : 'viewer',
      };
    },
  });
}
