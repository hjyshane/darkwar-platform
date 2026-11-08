import { useQuery } from '@tanstack/react-query';
import { StatTile } from '../../components/StatTile';
import { supabase } from '../../lib/supabase';
import { TERMS } from '../../lib/terms';

/** One row from `player_server_rank` (0309). */
export interface ServerRankRow {
  rank: number;
  total: number;
  power: number;
  next_above_power: number | null;
  next_below_power: number | null;
}

/** Where this player stands among the players read on their server, and how
 * far the neighbours are. The verdict reads `gapToAbove` ("1.2M behind #11")
 * or `leadOverBelow` ("Strongest by 59.4M"); the tile reads `rank` and
 * `total`. Both null at the ends of the board: rank 1 has nobody above, the
 * last place nobody below. */
export interface ServerRankFacts {
  rank: number;
  total: number;
  gapToAbove: number | null;
  leadOverBelow: number | null;
}

export function serverRankFacts(row: ServerRankRow | null | undefined): ServerRankFacts | null {
  if (row === null || row === undefined) return null;
  return {
    rank: row.rank,
    total: row.total,
    gapToAbove: row.next_above_power === null ? null : row.next_above_power - row.power,
    leadOverBelow: row.next_below_power === null ? null : row.power - row.next_below_power,
  };
}

/** One round trip: rank, total, and the nearest distinct power above and
 * below, from `player_server_rank` (0309) over `players_server_power_idx`.
 *
 * "Read" matters: the group's rankings only list who the collector has seen,
 * so this is a rank among known players, and the tile says so. No row when
 * the player has no power reading — or when the reader may not see `players`
 * at all, since the function is invoker (0065). */
export async function fetchServerRank(playerId: string): Promise<ServerRankFacts | null> {
  const { data, error } = await supabase.rpc('player_server_rank', { p_player_id: playerId });
  if (error) throw new Error(`server rank query failed: ${error.message}`);
  return serverRankFacts(data?.[0]);
}

export function useServerRank(playerId: string) {
  return useQuery({
    queryKey: ['player-server-rank', playerId],
    queryFn: () => fetchServerRank(playerId),
    staleTime: 10 * 60_000,
  });
}

export function PlayerServerRankTile({ playerId }: { playerId: string }) {
  const { data, isPending } = useServerRank(playerId);
  const value = isPending ? '…' : data ? `#${data.rank.toLocaleString('en-US')}` : '—';
  return (
    <StatTile
      label={TERMS.serverRank}
      note={data ? `of ${data.total.toLocaleString('en-US')} known` : undefined}
      value={value}
    />
  );
}
