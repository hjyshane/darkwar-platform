// Where to go back to after signing in.
//
// The problem it solves: somebody follows a link to `#/guides`, gets the
// members-only wall, signs in — and lands on the overview. The page they were
// sent to is gone, and on a phone they will not think to find it again.
//
// sessionStorage rather than localStorage, matching the decision in
// `lib/supabase.ts`: the session itself dies when the browser closes, so a
// return target that outlived it would send somebody to a page they were trying
// to reach yesterday.

const KEY = 'dw:returnTo';

/** Hashes that are not worth returning to.
 *
 * `#/login` is the obvious one — remembering it would make signing in loop back
 * to the sign-in page. Empty and bare `#` are the overview, which is where the
 * fallback already goes. */
function worthReturningTo(hash: string): boolean {
  return hash !== '' && hash !== '#' && hash !== '#/' && !hash.startsWith('#/login');
}

/** Note where the reader was, so signing in can bring them back.
 *
 * Called on every route change rather than from each of the eleven "Sign in"
 * links. Wiring it into the links would mean the one that got missed is the one
 * somebody uses.
 *
 * `blocked` IS THE WHOLE POINT, and leaving it out was a bug people felt: this
 * used to record every route change, including the ones a signed-in member made
 * quite happily. So the last screen you visited before closing the tab became
 * the screen you were dumped on at your next sign-in — for anybody who had been
 * in Settings, that meant signing in and landing on Settings instead of the
 * board.
 *
 * Only a reader who could NOT see the page they asked for needs bringing back
 * to it. It is a parameter rather than a check at the call site so that the next
 * caller cannot forget it.
 */
export function rememberReturnTo(hash: string, blocked: boolean): void {
  if (!blocked || !worthReturningTo(hash)) {
    return;
  }
  try {
    window.sessionStorage.setItem(KEY, hash);
  } catch {
    // Private browsing can refuse storage entirely. Landing on the overview is a
    // worse outcome than being brought back, and a much better one than a
    // sign-in page that throws.
  }
}

/** The remembered target, consumed. Empty string means the overview.
 *
 * Consumed rather than read, so it cannot fire twice — a second sign-in in the
 * same tab should not revisit a page from before the first one.
 */
export function takeReturnTo(): string {
  try {
    const stored = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    return stored !== null && worthReturningTo(stored) ? stored : '';
  } catch {
    return '';
  }
}
