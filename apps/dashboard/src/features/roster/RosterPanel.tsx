import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { TERMS } from '../../lib/terms';
import { type RosterRow, RosterTable } from './RosterTable';

async function fetchRoster(): Promise<RosterRow[]> {
  const { data, error } = await supabase
    .from('players')
    .select(
      'player_id, game_uid, current_name, hq_level, power, kills, daily_donation_score, alliance_battle_score, last_seen_at',
    )
    .order('power', { ascending: false, nullsFirst: false })
    .limit(50);
  if (error) {
    throw new Error(`roster query failed: ${error.message}`);
  }
  return data;
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
