import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { ServerChips } from '../../components/ServerChips';
import { Strip } from '../../components/Strip';
import { Tabs } from '../../components/ui/Tabs';
import { useRecordActivity } from '../../lib/activity';
import { filterByServer, resolveServer, serverCounts } from '../../lib/serverFilter';
import { TERMS } from '../../lib/terms';
import { CrossRankingTable } from './CrossRankingTable';
import { BOARDS, type BoardId, boardById } from './boards';
import { boardStrip } from './strip';

export function CrossRankingsPanel() {
  // The server board, for the activity score (0114). Once a day whatever the
  // reader does here: switching between the boards in this panel is reading
  // one screen, not opening three.
  useRecordActivity('rank_server');
  const [boardId, setBoardId] = useState<BoardId>('power');
  const board = boardById(boardId);
  const [chosenServer, setChosenServer] = useState<number | null>(null);
  const { data, error, isPending } = useQuery({
    queryKey: ['crossRankings', boardId],
    queryFn: board.fetch,
    // Longer than the app's 60s default: a board changes only when somebody
    // opens it in the game, and the 60s default meant flipping between two
    // boards re-queried each flip a minute after first load — which read as
    // the toggle itself being slow. Realtime invalidation still applies when
    // a new capture actually lands.
    staleTime: 10 * 60_000,
  });
  const servers = serverCounts(data ?? []);
  const server = resolveServer(servers, chosenServer);
  const shown = data ? filterByServer(data, server) : undefined;
  return (
    <section aria-labelledby="cross-rankings-heading" className="board-screen">
      <div className="entity">
        <header className="entity-head">
          <span aria-hidden="true" className="entity-mark">
            PR
          </span>
          <div>
            <h2 id="cross-rankings-heading">{TERMS.crossServerRanking}</h2>
            <p className="entity-meta">
              <span>{board.label}</span>
              {data?.[0] && <FreshnessBadge capturedAt={data[0].captured_at} />}
            </p>
          </div>
        </header>
        {shown && <Strip cells={boardStrip(shown, board.valueLabel, new Date())} />}
      </div>
      <Tabs
        label="Ranking metric"
        items={BOARDS.map((candidate) => ({ id: candidate.id, label: candidate.label }))}
        value={boardId}
        onChange={setBoardId}
      />
      <div className="panel">
        {/* Every server the board mentions, derived from the rows rather than the
          `servers` table, so a newly scanned server shows up on its own. */}
        <ServerChips onChange={setChosenServer} servers={servers} value={server} />
        {isPending && <p className="empty loading">Loading…</p>}
        {error && <p className="error">Could not load ranking: {error.message}</p>}
        {shown && (
          <CrossRankingTable key={`${boardId}-${server ?? 'all'}`} rows={shown} board={board} />
        )}
      </div>
    </section>
  );
}
