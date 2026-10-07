import { useQuery } from '@tanstack/react-query';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { FALLBACK_SEASONS, pastSeason, useSeasons } from '../../lib/seasons';
import { TERMS } from '../../lib/terms';
import { useSession } from '../../lib/useSession';
import { SeasonBuildingTable } from './SeasonBuildingTable';
import { fetchBuildingGrid } from './buildings';

/** Shared and frozen, so the table's memo does not see a new map each render. */
const NO_FLOORS: ReadonlyMap<number, number> = new Map();

/** Last season's buildings, on their own screen.
 *
 * They are not a board the alliance reads. The game still returns them from
 * old sightings — they stopped being observed around 16 August and their
 * levels are frozen where the season left them — so they exist as a record
 * rather than as something anybody acts on. That is why this is admin-only
 * and why it is not a tab inside Season 3: a member opening the season tab
 * should not have to know which of two boards is the live one.
 *
 * THE ROLE IS CHECKED HERE, NOT ONLY IN THE NAV. Hiding the tab hides it from
 * the eye, not from the address bar, and `member_season_buildings` is
 * readable by any member — the data is not secret, it is just noise nobody
 * else should be handed. So the screen refuses rather than relying on a
 * database gate that would let a member straight through.
 */
export function Season2Panel() {
  const { data: session } = useSession();
  // Undefined while the session loads is not an admin yet: showing the board
  // and snatching it back is worse than a beat of waiting.
  const isAdmin = session?.role === 'admin';

  // The season before the current one (0242): Season 2 while Season 3 is on,
  // Season 3 once Season 4 starts.
  const seasons = useSeasons();
  const past = pastSeason(seasons.data ?? FALLBACK_SEASONS, new Date());
  const catalogue = past?.buildings ?? FALLBACK_SEASONS[0]?.buildings ?? [];
  const pastName = past?.name ?? TERMS.season2Buildings;

  const { data, error, isPending } = useQuery({
    queryKey: ['seasonBoard', 'past_buildings', past?.id ?? 0],
    queryFn: () => fetchBuildingGrid(catalogue),
    // A season that has ended does not change. The app's 60s default would
    // re-query a frozen table on every visit.
    staleTime: 60 * 60_000,
    enabled: isAdmin,
  });

  if (!isAdmin) {
    return (
      <section aria-labelledby="season2-heading">
        <h2 id="season2-heading">{pastName}</h2>
        <p className="empty">
          Last season's buildings are kept for admins. Nothing here affects the season being played.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="season2-heading">
      <h2 id="season2-heading">
        {pastName}
        {data?.capturedAt && <FreshnessBadge capturedAt={data.capturedAt} />}
      </h2>
      {isPending && <p className="empty loading">Loading…</p>}
      {error && (
        <p className="error">
          Could not load {pastName}: {(error as Error).message}
        </p>
      )}
      {/* No floors at all: nobody is behind on a season that has ended. */}
      {data && <SeasonBuildingTable floors={NO_FLOORS} grid={data} />}
      <p className="note">
        {pastName}, kept for reference. These stopped being observed when the season ended, so the
        levels are frozen where it left them. Names marked <strong>*</strong> are placeholders:
        guesses from the shape of the data, which can be corrected under Settings → Seasons.
      </p>
    </section>
  );
}
