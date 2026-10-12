import type { Route } from './route';
import { type AppRole, useSession } from './useSession';

/** The `community` role (0282): people outside the alliance, invited to read
 * the game-wide pages. It is not "member minus things": every table that holds
 * the alliance stays closed to it in the database (0283), so these gates are
 * about not drawing a screen that would be empty or would explain our
 * collector to a stranger — the database is the boundary either way.
 *
 * The list below is the whole of what the role is offered. A route that is
 * not on it renders "not available" rather than its own empty state. */
const COMMUNITY_ROUTES: ReadonlySet<Route> = new Set<Route>([
  'overview',
  'rankings',
  'crossRankings',
  'arena',
  'migration',
  'map',
  'planner',
  'calendar',
  'eventGuide',
  'shopValue',
  // Where an account says which character it is, which the planner reads.
  'account',
  // Not the account's, but the way in and the pages that must stay readable.
  'login',
  'terms',
  'privacy',
]);

export function isCommunityRole(role: AppRole | null | undefined): boolean {
  return role === 'community';
}

/** Whether a community account is offered this screen. */
export function communityMayOpen(route: Route): boolean {
  return COMMUNITY_ROUTES.has(route);
}

/** True for a community account, false for everyone else and while the
 * session is still loading. Screens use it to leave OUT what is ours, so
 * "not known yet" must read as "not community" only briefly: the pages that
 * matter sit behind the shell, which waits for the session. */
export function useIsCommunity(): boolean {
  const { data: session } = useSession();
  return isCommunityRole(session?.role);
}
