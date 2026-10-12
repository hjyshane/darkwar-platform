// The tab strip above Black Gold, Frankie, Participation and the season boards.
//
// Those are pages of their own, each with its own address, and this strip is
// what makes them one place: the sidebar has a single Events entry, and every
// page behind it carries these tabs so a reader can hop between them without
// going back to the sidebar. Plain links, not state: the address is the tab,
// so back, reload and a pasted link all land where they should.

import { EVENTS_HUB_TABS, type Route } from '../../lib/route';
import { FALLBACK_SEASONS, currentSeason, pastSeason, useSeasons } from '../../lib/seasons';
import { useSession } from '../../lib/useSession';

export function EventsTabs({ route }: { route: Route }) {
  const { data: session } = useSession();
  const seasons = useSeasons();
  const list = seasons.data ?? FALLBACK_SEASONS;
  const now = new Date();
  const names: Record<string, string | undefined> = {
    '#/season': currentSeason(list, now)?.name,
    '#/season2': pastSeason(list, now)?.name,
  };
  const isAdmin = session?.role === 'admin';
  // `events` is the bare address and shows the first tab.
  const active = route === 'events' ? EVENTS_HUB_TABS[0]?.route : route;

  return (
    <nav aria-label="Events" className="tabs row">
      {EVENTS_HUB_TABS.filter((tab) => tab.route !== 'season2' || isAdmin).map((tab) => (
        <a
          aria-current={tab.route === active ? 'page' : undefined}
          className={`tab ${tab.route === active ? 'tab-active' : ''}`}
          href={tab.hash}
          key={tab.hash}
        >
          {names[tab.hash] ?? tab.label}
        </a>
      ))}
    </nav>
  );
}
