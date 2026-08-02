import { useQuery } from '@tanstack/react-query';
import { allianceHash, playerHash, serverHash } from '../../lib/route';
import { supabase } from '../../lib/supabase';
import { useFavourites } from '../../lib/useFavourites';

/** What the reader starred, resolved to names and linked.
 *
 * The stars have existed on four screens since #43; what was missing was
 * anywhere to see them together, which is most of what makes a shortcut a
 * shortcut.
 *
 * Two queries keyed by the ids we already hold, rather than an embed off
 * `favourites`: the table is member-only and the things it points at are
 * not, so an embed would drag the whole block behind the stricter of the
 * two policies for no reason.
 */
interface Starred {
  players: { id: string; label: string; server: number }[];
  alliances: { id: string; label: string; server: number }[];
  servers: number[];
}

export function FavouritesBlock() {
  const { signedIn, ids } = useFavourites();
  const playerIds = [...ids.player];
  const allianceIds = [...ids.alliance];
  const serverIds = [...ids.server].sort((a, b) => a - b);

  const { data, error } = useQuery({
    // The ids are in the key: starring something has to change what this
    // shows, and the list is the query's only input.
    queryKey: ['favourite-detail', playerIds.join(','), allianceIds.join(',')],
    enabled: signedIn && (playerIds.length > 0 || allianceIds.length > 0),
    queryFn: async (): Promise<Starred> => {
      const [players, alliances] = await Promise.all([
        playerIds.length > 0
          ? supabase
              .from('players')
              .select('player_id, current_name, game_uid, server_id')
              .in('player_id', playerIds)
          : Promise.resolve({ data: [], error: null }),
        allianceIds.length > 0
          ? supabase
              .from('alliances')
              .select('alliance_id, current_name, current_code, server_id')
              .in('alliance_id', allianceIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (players.error) {
        throw new Error(`favourite players query failed: ${players.error.message}`);
      }
      if (alliances.error) {
        throw new Error(`favourite alliances query failed: ${alliances.error.message}`);
      }
      return {
        players: (players.data ?? []).map((row) => ({
          id: row.player_id,
          label: row.current_name ?? `UID ${row.game_uid}`,
          server: row.server_id,
        })),
        alliances: (alliances.data ?? []).map((row) => ({
          id: row.alliance_id,
          label: `${row.current_code ? `[${row.current_code}] ` : ''}${row.current_name ?? 'Unnamed'}`,
          server: row.server_id,
        })),
        servers: [],
      };
    },
  });

  if (!signedIn) {
    return null;
  }

  const nothing = playerIds.length === 0 && allianceIds.length === 0 && serverIds.length === 0;

  return (
    <section aria-labelledby="favourites-heading">
      <h2 id="favourites-heading">My favourites</h2>
      {error && <p className="error">Could not load favourites: {error.message}</p>}
      {nothing ? (
        <p className="empty">
          Nothing starred yet. The ☆ beside a player, alliance or server adds it here.
        </p>
      ) : (
        <ul className="chips">
          {serverIds.map((id) => (
            <li key={`s${id}`}>
              <a className="chip" href={serverHash(id)}>
                Server {id}
              </a>
            </li>
          ))}
          {(data?.alliances ?? []).map((row) => (
            <li key={row.id}>
              <a className="chip" href={allianceHash(row.id)}>
                {row.label} <span className="subtle">· {row.server}</span>
              </a>
            </li>
          ))}
          {(data?.players ?? []).map((row) => (
            <li key={row.id}>
              <a className="chip" href={playerHash(row.id)}>
                {row.label} <span className="subtle">· {row.server}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
