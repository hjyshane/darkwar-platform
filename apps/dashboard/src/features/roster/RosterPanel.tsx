import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { TERMS } from '../../lib/terms';
import { type RosterRow, RosterTable } from './RosterTable';

/** Two queries rather than an embedded select.
 *
 * Contribution moved to its own member-only table in 0020, so it is a join
 * away. Fetching it separately keeps the shape flat — the sort and search
 * work on top-level keys, and a nested object would silently stop being
 * sortable — and it makes the permission boundary obvious: logged out, the
 * second query returns nothing because RLS filters every row, and the
 * merge leaves the columns null. The table already renders null as "—",
 * which is the honest answer: not zero, not hidden, just not visible to
 * you.
 */
async function fetchRoster(): Promise<RosterRow[]> {
  const { data: players, error } = await supabase
    .from('players')
    .select('player_id, game_uid, current_name, hq_level, power, kills, last_seen_at')
    .order('power', { ascending: false, nullsFirst: false })
    .limit(50);
  if (error) {
    throw new Error(`roster query failed: ${error.message}`);
  }

  const { data: contributions, error: contributionError } = await supabase
    .from('player_contributions')
    .select('player_id, daily_donation_score, alliance_battle_score')
    .in(
      'player_id',
      players.map((player) => player.player_id),
    );
  if (contributionError) {
    throw new Error(`contribution query failed: ${contributionError.message}`);
  }

  const byPlayer = new Map(contributions.map((row) => [row.player_id, row]));
  return players.map((player) => ({
    ...player,
    daily_donation_score: byPlayer.get(player.player_id)?.daily_donation_score ?? null,
    alliance_battle_score: byPlayer.get(player.player_id)?.alliance_battle_score ?? null,
  }));
}

export function RosterPanel() {
  const { data, error, isPending } = useQuery({ queryKey: ['roster'], queryFn: fetchRoster });
  return (
    <section aria-labelledby="roster-heading">
      <h2 id="roster-heading">{TERMS.members}</h2>
      {isPending && <p className="empty">Loading…</p>}
      {error && <p className="error">Could not load members: {error.message}</p>}
      {data && <RosterTable rows={data} />}
    </section>
  );
}
