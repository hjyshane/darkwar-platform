// An alliance account has to say which character it is before the dashboard
// opens (owner, 2026-11-19). Signing in as a member or officer with nothing
// linked lands on the picker, whatever address was asked for, and stays there
// until a character is linked.
//
// THE SIGNAL IS `app_users.player_id` (useSession's `playerId`). It is the
// display player, and it is non-null exactly when the account holds at least
// one row in `user_players`: `claim_player` sets it when it is empty, and
// `unlink_player` moves it to another linked character or clears it (0193).
// An admin moving it on the members screen goes through the same column.
//
// THIS IS A SCREEN, NOT A BOUNDARY. What a member may read is still decided by
// RLS on alliance membership; an account without a character reads exactly
// what it read before through the API. The gate decides what the dashboard
// puts in front of it.

import type { Route } from './route';
import type { AppRole, SessionState } from './useSession';

/** Who has to pick. Not an admin: the admins run the roster the picker lists,
 * and an admin whose character the collector has not seen would otherwise be
 * locked out of the settings that fix it. Not community (0282): it is not an
 * alliance account, and `claim_player` refuses it our characters anyway. */
const MUST_PICK: ReadonlySet<AppRole> = new Set<AppRole>(['member', 'officer']);

/** Whether this account must link a character before anything else opens.
 *
 * Undefined (session still loading) is "no", so the gate never flashes at
 * somebody who has a character. The REAL role decides: an admin previewing
 * the member view ("View as") is not asked to pick. */
export function mustPickCharacter(session: SessionState | undefined): boolean {
  if (session === undefined) {
    return false;
  }
  return MUST_PICK.has(session.realRole ?? session.role) && session.playerId === null;
}

/** The pages an account that must pick can still open: the sign-in page,
 * which carries the same picker and the join flow's result, and the two legal
 * pages it links to. */
export function openWhilePicking(route: Route): boolean {
  return route === 'login' || route === 'terms' || route === 'privacy';
}
