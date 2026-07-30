import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { supabase } from '../../lib/supabase';
import { type CrossRankingRow, CrossRankingTable, type RankingMetric } from './CrossRankingTable';
import { latestBatch } from './latestBatch';

// The same table holds both boards; only source_command says which ranking
// a row's `rank` belongs to. Querying by metric column would conflate them.
const METRIC_COMMAND: Record<RankingMetric, string> = {
  power: 'server.rank',
  kills: 'kill.rank',
};

async function fetchRanking(metric: RankingMetric): Promise<CrossRankingRow[]> {
  const { data, error } = await supabase
    .from('player_snapshots')
    .select('snapshot_id, rank, name, game_uid, server_id, power, kills, captured_at')
    .eq('source_command', METRIC_COMMAND[metric])
    .order('captured_at', { ascending: false })
    .order('rank', { ascending: true, nullsFirst: false })
    .limit(300);
  if (error) {
    throw new Error(`ranking query failed: ${error.message}`);
  }
  return latestBatch(data);
}

export function CrossRankingsPanel() {
  const [metric, setMetric] = useState<RankingMetric>('power');
  const { data, error, isPending } = useQuery({
    queryKey: ['crossRankings', metric],
    queryFn: () => fetchRanking(metric),
  });
  return (
    <section aria-labelledby="cross-rankings-heading">
      <h2 id="cross-rankings-heading">
        크로스서버 개인 랭킹
        {data?.[0] && <FreshnessBadge capturedAt={data[0].captured_at} />}
      </h2>
      <div role="tablist" aria-label="랭킹 지표">
        <button
          type="button"
          role="tab"
          aria-selected={metric === 'power'}
          onClick={() => setMetric('power')}
        >
          전투력
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={metric === 'kills'}
          onClick={() => setMetric('kills')}
        >
          킬
        </button>
      </div>
      {isPending && <p className="empty">불러오는 중…</p>}
      {error && <p className="error">랭킹을 불러오지 못했습니다: {error.message}</p>}
      {data && <CrossRankingTable rows={data} metric={metric} />}
    </section>
  );
}
