import type { Database } from '@dw/shared-types';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './env';

/**
 * Sign-in lasts as long as the browser is open, and no longer.
 *
 * The default is localStorage with `autoRefreshToken`, which is not a cache
 * and does not go away with one: the refresh token survives quitting the
 * browser and renews itself, so an admin who signed in once stays signed in
 * indefinitely, on whatever machine they used. Clearing site data is the
 * only way out, which nobody thinks to do.
 *
 * sessionStorage keeps the useful part — a reload, a new tab from a link,
 * and the OAuth-style redirect back from a confirmation email all still find
 * the session — and drops it when the window closes. `persistSession: false`
 * would have signed people out on F5, which is a different complaint.
 *
 * Guarded because sessionStorage does not exist under Node, and the tests
 * import this module.
 */
/** Drop what the old configuration left behind.
 *
 * Switching storage stops the localStorage session being READ; it does not
 * remove it. A refresh token would sit there indefinitely on every browser
 * that had signed in before — which is the exact thing being fixed, just
 * invisible instead of inconvenient. Matched by shape rather than by an
 * exact key so it also catches the local stack's, whose key differs.
 */
function clearLegacySession(): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (/^sb-.*-auth-token(\.\d+)?$/.test(key)) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Storage can be unavailable (private mode, blocked cookies). Failing to
    // tidy up must not stop the app loading.
  }
}

clearLegacySession();

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: typeof window === 'undefined' ? undefined : window.sessionStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
