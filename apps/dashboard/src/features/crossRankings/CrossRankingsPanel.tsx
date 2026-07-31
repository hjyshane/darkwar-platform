import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { FreshnessBadge } from '../../components/FreshnessBadge';
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
        크로스서버 개인 랭킹
        {data?.[0] && <FreshnessBadge capturedAt={data[0].captured_at} />}
      </h2>
      <div role="tablist" aria-label="랭킹 지표">
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
      {isPending && <p className="empty">불러오는 중…</p>}
      {error && <p className="error">랭킹을 불러오지 못했습니다: {error.message}</p>}
      {data && <CrossRankingTable rows={data} board={board} />}
    </section>
  );
}
