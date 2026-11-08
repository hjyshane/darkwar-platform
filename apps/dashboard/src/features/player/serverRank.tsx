import { useQuery } from '@tanstack/react-query';
import { StatTile } from '../../components/StatTile';
import { supabase } from '../../lib/supabase';
import { TERMS } from '../../lib/terms';

/** `#12` of 1,840. The rank is "players on the server with more power, plus
 * one", so a tie shares the better place. Null when there is no power to rank. */
export function serverRankOf(ahead: number | null, total: number | null) {
  if (ahead === null || total === null || total <= 0) return null;
  return { rank: ahead + 1, total };
}

/** Where this player stands in power among the players we have read on their
 * server. Two head counts on `players_server_power_idx` (0002); no rows move.
 *
 * "Read" matters: the group's rankings only list who the collector has seen, so
 * this is a rank among known players, and the tile says so. */
async function fetchServerRank(serverId: number, power: number) {
  const base = () =>
    supabase
      .from('players')
      .select('player_id', { count: 'exact', head: true })
      .eq('server_id', serverId)
      .not('power', 'is', null);
  const [ahead, total] = await Promise.all([base().gt('power', power), base()]);
  if (ahead.error) throw new Error(`server rank query failed: ${ahead.error.message}`);
  if (total.error) throw new Error(`server rank query failed: ${total.error.message}`);
  return serverRankOf(ahead.count, total.count);
}

export function PlayerServerRankTile({
  serverId,
  power,
}: {
  serverId: number;
  power: number | null;
}) {
  const { data, isPending } = useQuery({
    queryKey: ['player-server-rank', serverId, power],
    queryFn: () => fetchServerRank(serverId, power as number),
    enabled: power !== null,
    staleTime: 10 * 60_000,
  });
  const value =
    power === null ? '—' : isPending ? '…' : data ? `#${data.rank.toLocaleString('en-US')}` : '—';
  return (
    <StatTile
      label={TERMS.serverRank}
      note={data ? `of ${data.total.toLocaleString('en-US')} known` : undefined}
      value={value}
    />
  );
}
