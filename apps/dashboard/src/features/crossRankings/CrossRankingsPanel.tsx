import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { TERMS } from '../../lib/terms';
import { CrossRankingTable } from './CrossRankingTable';
import { BOARDS, type BoardId, boardById } from './boards';

export function CrossRankingsPanel() {
  const [boardId, setBoardId] = useState<BoardId>('power');
  const board = boardById(boardId);
  const { data, error, isPending } = useQuery({
    queryKey: ['crossRankings', boardId],
    queryFn: board.fetch,
  });
  return (
    <section aria-labelledby="cross-rankings-heading">
      <h2 id="cross-rankings-heading">
        {TERMS.crossServerRanking}
        {data?.[0] && <FreshnessBadge capturedAt={data[0].captured_at} />}
      </h2>
      <div role="tablist" aria-label="Ranking metric">
        {BOARDS.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            role="tab"
            aria-selected={candidate.id === boardId}
            onClick={() => setBoardId(candidate.id)}
          >
            {candidate.label}
          </button>
        ))}
      </div>
      {isPending && <p className="empty">Loading…</p>}
      {error && <p className="error">Could not load ranking: {error.message}</p>}
      {data && <CrossRankingTable rows={data} board={board} />}
    </section>
  );
}
