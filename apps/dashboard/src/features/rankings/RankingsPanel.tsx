import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { TERMS } from '../../lib/terms';
import { type AllianceRankingRow, AllianceRankingTable } from './AllianceRankingTable';

async function fetchAllianceRankings(): Promise<AllianceRankingRow[]> {
  const { data, error } = await supabase
    .from('alliance_snapshots')
    .select(
      'snapshot_id, external_id, server_id, rank, name, code, power, member_count, captured_at',
    )
    .order('captured_at', { ascending: false })
    .limit(200);
  if (error) {
    throw new Error(`alliance ranking query failed: ${error.message}`);
  }
  return data;
}

export function RankingsPanel() {
  const { data, error, isPending } = useQuery({
    queryKey: ['rankings'],
    queryFn: fetchAllianceRankings,
  });
  return (
    <section aria-labelledby="rankings-heading">
      <h2 id="rankings-heading">{TERMS.allianceRanking}</h2>
      {isPending && <p className="empty">Loading…</p>}
      {error && <p className="error">Could not load alliance ranking: {error.message}</p>}
      {data && <AllianceRankingTable rows={data} />}
    </section>
  );
}
