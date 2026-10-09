import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ExportButton } from '../../components/ExportButton';
import { ServerChips } from '../../components/ServerChips';
import { Strip } from '../../components/Strip';
import { useRecordActivity } from '../../lib/activity';
import type { CsvColumn } from '../../lib/csv';
import { fetchAllPages } from '../../lib/fetchAllPages';
import { filterByServer, resolveServer, serverCounts } from '../../lib/serverFilter';
import { supabase } from '../../lib/supabase';
import { TERMS } from '../../lib/terms';
import { type AllianceRankingRow, AllianceRankingTable } from './AllianceRankingTable';
import { allianceStrip } from './strip';

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
  // Paged: one row per alliance, and PostgREST stops at 1,000 whatever the
  // limit says. Ordered by power with the id as tie-break so pages do not overlap.
  const data = await fetchAllPages((from, to) =>
    supabase
      .from('alliance_latest')
      .select(
        'snapshot_id, alliance_id, external_id, server_id, rank, name, code, power, member_count, captured_at',
      )
      .order('power', { ascending: false, nullsFirst: false })
      .order('alliance_id', { ascending: true })
      .range(from, to),
  ).catch((error: Error) => {
    throw new Error(`alliance ranking query failed: ${error.message}`);
  });
  return data as AllianceRankingRow[];
}

const ALLIANCE_CSV: CsvColumn<AllianceRankingRow>[] = [
  { header: 'Rank', value: (row) => row.rank },
  { header: 'Server', value: (row) => row.server_id },
  { header: 'Tag', value: (row) => row.code },
  { header: 'Name', value: (row) => row.name },
  { header: 'Power', value: (row) => row.power },
  { header: 'Members', value: (row) => row.member_count },
  { header: 'Captured at (UTC)', value: (row) => row.captured_at },
];

export function RankingsPanel() {
  // The alliance board, for the activity score (0114).
  useRecordActivity('rank_alliance');
  const { data, error, isPending } = useQuery({
    queryKey: ['rankings'],
    queryFn: fetchAllianceRankings,
  });
  const [chosenServer, setChosenServer] = useState<number | null>(null);
  const servers = serverCounts(data ?? []);
  const server = resolveServer(servers, chosenServer);
  const shown = data ? filterByServer(data, server) : undefined;
  return (
    <section aria-labelledby="rankings-heading" className="board-screen">
      <div className="entity">
        <header className="entity-head">
          <span aria-hidden="true" className="entity-mark">
            AR
          </span>
          <div>
            <h2 id="rankings-heading">{TERMS.allianceRanking}</h2>
            <p className="entity-meta">
              <span>Every alliance seen, by power</span>
            </p>
          </div>
        </header>
        {shown && <Strip cells={allianceStrip(shown, new Date())} />}
      </div>
      <div className="panel">
        <ServerChips onChange={setChosenServer} servers={servers} value={server} />
        {isPending && <p className="empty loading">Loading…</p>}
        {error && <p className="error">Could not load alliance ranking: {error.message}</p>}
        {shown && <ExportButton rows={shown} columns={ALLIANCE_CSV} filename="alliance-ranking" />}
        {shown && <AllianceRankingTable rows={shown} />}
      </div>
    </section>
  );
}
