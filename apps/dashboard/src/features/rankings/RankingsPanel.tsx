import { useQuery } from '@tanstack/react-query';
import { useRecordActivity } from '../../lib/activity';
import { supabase } from '../../lib/supabase';
import { TERMS } from '../../lib/terms';
import { type AllianceRankingRow, AllianceRankingTable } from './AllianceRankingTable';

/** The current state of every alliance, from the view that defines what
 *  "current" means (0035).
 *
 * This used to pull 200 raw snapshots newest-first and keep the newest per
 * alliance in the browser. The limit counted SNAPSHOTS, not alliances, so
 * once captures accumulated an alliance whose only sighting had aged out of
 * the window simply stopped being in the ranking — 122 of 129 at three
 * sweeps, and worse from there.
 *
 * Ordered by power, which is also the order the table displays: a ranking
 * ordered by when we happened to look was never meaningful, and the header
 * now says the same thing the rows do.
 */
async function fetchAllianceRankings(): Promise<AllianceRankingRow[]> {
  const { data, error } = await supabase
    .from('alliance_latest')
    .select(
      'snapshot_id, alliance_id, external_id, server_id, rank, name, code, power, member_count, captured_at',
    )
    .order('power', { ascending: false, nullsFirst: false });
  if (error) {
    throw new Error(`alliance ranking query failed: ${error.message}`);
  }
  return data as AllianceRankingRow[];
}

export function RankingsPanel() {
  // The alliance board, for the activity score (0114).
  useRecordActivity('rank_alliance');
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
