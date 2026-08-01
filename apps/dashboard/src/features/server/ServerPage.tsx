import { useQuery } from '@tanstack/react-query';
import { FavouriteButton } from '../../components/FavouriteButton';
import { supabase } from '../../lib/supabase';
import { TERMS } from '../../lib/terms';
import { useFavourites } from '../../lib/useFavourites';
import { latestBatch } from '../crossRankings/latestBatch';
import {
  type AllianceRankingRow,
  AllianceRankingTable,
  latestPerAlliance,
} from '../rankings/AllianceRankingTable';
import { type ServerPlayerRow, ServerPlayerTable } from './ServerPlayerTable';

interface ServerData {
  alliances: AllianceRankingRow[];
  players: ServerPlayerRow[];
}

/** One server's alliances and players.
 *
 * Both queries filter on `server_id`, which is the SUBJECT's server, not
 * the collector's — a server.rank response observed from 580 carries
 * players from all eight, and this page is about who belongs to a server
 * rather than where we happened to be standing when we saw them.
 */
async function fetchServer(serverId: number): Promise<ServerData> {
  const [alliances, players] = await Promise.all([
    supabase
      .from('alliance_snapshots')
      .select(
        'snapshot_id, alliance_id, external_id, server_id, rank, name, code, power, member_count, captured_at',
      )
      .eq('server_id', serverId)
      .order('captured_at', { ascending: false })
      .limit(200),
    supabase
      .from('player_snapshots')
      .select('snapshot_id, player_id, rank, name, game_uid, server_id, power, kills, captured_at')
      .eq('server_id', serverId)
      .order('captured_at', { ascending: false })
      .order('rank', { ascending: true, nullsFirst: false })
      .limit(300),
  ]);
  if (alliances.error) {
    throw new Error(`server alliances query failed: ${alliances.error.message}`);
  }
  if (players.error) {
    throw new Error(`server players query failed: ${players.error.message}`);
  }
  return {
    alliances: alliances.data,
    // One capture produces many rows sharing a captured_at; the board as
    // last seen is the newest of those batches.
    players: latestBatch(players.data),
  };
}

export function ServerPage({ serverId }: { serverId: number }) {
  const { data, error, isPending } = useQuery({
    queryKey: ['server', serverId],
    queryFn: () => fetchServer(serverId),
  });
  const { signedIn, isFavourite, toggle } = useFavourites();

  return (
    <main>
      <section aria-labelledby="server-heading">
        <h2 id="server-heading">
          {signedIn && (
            <FavouriteButton
              id={serverId}
              isFavourite={isFavourite('server', serverId)}
              kind="server"
              label={`server ${serverId}`}
              onToggle={toggle}
            />
          )}
          {TERMS.server} {serverId}
        </h2>
        <p className="empty">
          <a href="#/cross-server">← {TERMS.crossServerRanking}</a>
        </p>
        {isPending && <p className="empty">Loading…</p>}
        {error && (
          <p className="error">
            Could not load server {serverId}: {error.message}
          </p>
        )}
      </section>

      {data && (
        <>
          <section aria-labelledby="server-alliances-heading">
            <h2 id="server-alliances-heading">{TERMS.allianceRanking}</h2>
            {latestPerAlliance(data.alliances).length === 0 ? (
              <p className="empty">No alliance seen on server {serverId} yet.</p>
            ) : (
              <AllianceRankingTable rows={data.alliances} />
            )}
          </section>
          <section aria-labelledby="server-players-heading">
            <h2 id="server-players-heading">{TERMS.members}</h2>
            <ServerPlayerTable rows={data.players} serverId={serverId} />
          </section>
        </>
      )}
    </main>
  );
}
