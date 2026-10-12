import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Route } from './route';
import { supabase } from './supabase';
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
  // The pages the ranking rows link to. Ours are refused by `useIsOurs`
  // below and, underneath, by the policies (0283, 0285).
  'alliance',
  'player',
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

/** Whether an alliance, or a player, is ours: the pages a community account
 * is not shown. Answers `null` while it is being asked, which the caller must
 * not read as "not ours".
 *
 * A player is ours by their last-known alliance (`current_alliance_id`, which
 * is never cleared) — conservative on purpose: somebody who left still reads
 * as ours, which costs a closed page and not an open one. */
export function useIsOurs(kind: 'alliance' | 'player', id: string): boolean | null {
  const { data } = useQuery({
    queryKey: ['is-ours', kind, id],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<boolean> => {
      let allianceId: string | null = id;
      if (kind === 'player') {
        const { data: player, error } = await supabase
          .from('players')
          .select('current_alliance_id')
          .eq('player_id', id)
          .maybeSingle();
        if (error) {
          throw new Error(`player query failed: ${error.message}`);
        }
        allianceId = player?.current_alliance_id ?? null;
      }
      if (allianceId === null) {
        return false;
      }
      const { data: alliance, error } = await supabase
        .from('alliances')
        .select('is_own')
        .eq('alliance_id', allianceId)
        .maybeSingle();
      if (error) {
        throw new Error(`alliance query failed: ${error.message}`);
      }
      return alliance?.is_own === true;
    },
  });
  return data ?? null;
}

/** A page of somebody else's, for a community account: the alliance or player
 * page, withheld when it is ours. Everyone else is not asked at all. */
export function CommunityGate({
  kind,
  id,
  children,
}: {
  kind: 'alliance' | 'player';
  id: string;
  children: ReactNode;
}) {
  const ours = useIsOurs(kind, id);
  if (ours === null) {
    return (
      <main>
        <p className="empty loading">Loading…</p>
      </main>
    );
  }
  if (ours) {
    return (
      <main>
        <section aria-labelledby="community-ours-heading">
          <h2 id="community-ours-heading">Not available</h2>
          <p className="empty">
            This page is about the alliance itself and is for its members.{' '}
            <a href="#/rankings">Back to the rankings</a>
          </p>
        </section>
      </main>
    );
  }
  return <>{children}</>;
}
