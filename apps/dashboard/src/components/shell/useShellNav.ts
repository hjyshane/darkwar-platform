import { useEffect, useState } from 'react';
import { isAllowed, usePermissions } from '../../lib/permissions';
import type { Route } from '../../lib/route';
import { FALLBACK_SEASONS, currentSeason, pastSeason, useSeasons } from '../../lib/seasons';
import { type NavGroup, type NavItem, breadcrumb, buildFooter, buildNav } from '../../lib/shellNav';
import { useOwnAlliance } from '../../lib/useOwnAlliance';
import { useSession } from '../../lib/useSession';

/** The sidebar's groups for the screen being shown, with the gates the old tab
 * bars carried: Members needs `members.view`, Migration is for officers and
 * Season 2 for admins. Hiding an entry withholds nothing; RLS does that. */
export function useShellNav(
  route: Route,
  allianceId: string | null,
): { groups: NavGroup[]; footer: NavItem[]; crumbs: string[] } {
  const { data: session } = useSession();
  const { data: ownAlliance } = useOwnAlliance();
  const { data: permissions, isPending } = usePermissions();
  const seasons = useSeasons();

  const isAdmin = session?.role === 'admin';
  const now = new Date();
  const list = seasons.data ?? FALLBACK_SEASONS;
  const groups = buildNav({
    route,
    allianceId,
    own:
      ownAlliance == null
        ? null
        : {
            alliance_id: ownAlliance.alliance_id,
            label: ownAlliance.code ?? ownAlliance.name ?? 'Our alliance',
          },
    mayViewMembers: isPending
      ? undefined
      : isAllowed(permissions?.grants, session?.role, 'members.view'),
    isAdmin,
    isOfficer: isAdmin || session?.role === 'officer',
    seasonNames: {
      '#/season': currentSeason(list, now)?.name,
      '#/season2': pastSeason(list, now)?.name,
    },
  });
  const footer = buildFooter(route, isAdmin);
  return { groups, footer, crumbs: breadcrumb(groups, footer, route) };
}

/** The current time, refreshed on an interval: the top bar's clock. */
export function useNow(everyMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), everyMs);
    return () => window.clearInterval(timer);
  }, [everyMs]);
  return now;
}
