import { useQuery } from '@tanstack/react-query';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { TERMS } from '../../lib/terms';
import { useSession } from '../../lib/useSession';
import { SeasonBuildingTable } from './SeasonBuildingTable';
import { SEASON2_BUILDINGS, fetchBuildingGrid } from './buildings';

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

  const { data, error, isPending } = useQuery({
    queryKey: ['seasonBoard', 'season2_buildings'],
    queryFn: () => fetchBuildingGrid(SEASON2_BUILDINGS),
    // A season that has ended does not change. The app's 60s default would
    // re-query a frozen table on every visit.
    staleTime: 60 * 60_000,
    enabled: isAdmin,
  });

  if (!isAdmin) {
    return (
      <section aria-labelledby="season2-heading">
        <h2 id="season2-heading">{TERMS.season2Buildings}</h2>
        <p className="empty">
          Last season's buildings are kept for admins. Nothing here affects the season being played.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="season2-heading">
      <h2 id="season2-heading">
        {TERMS.season2Buildings}
        {data?.capturedAt && <FreshnessBadge capturedAt={data.capturedAt} />}
      </h2>
      {isPending && <p className="empty">Loading…</p>}
      {error && <p className="error">Could not load season 2: {(error as Error).message}</p>}
      {/* No floors at all: nobody is behind on a season that has ended. */}
      {data && <SeasonBuildingTable floors={NO_FLOORS} grid={data} />}
      <p className="note">
        Season 2, kept for reference. These stopped being observed around 16 August, so the levels
        are frozen where the season left them. Names marked <strong>*</strong> are placeholders: the
        counts and two of the placements came from the alliance, the rest is inferred, and the
        Attack and Defense pairs in particular could be the other way round.
      </p>
    </section>
  );
}
