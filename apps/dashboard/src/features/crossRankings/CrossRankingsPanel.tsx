import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { useRecordActivity } from '../../lib/activity';
import { serverHash } from '../../lib/route';
import { TERMS } from '../../lib/terms';
import { CrossRankingTable } from './CrossRankingTable';
import { BOARDS, type BoardId, boardById } from './boards';

/** Every server the current board mentions, as a link to its own page.
 *
 * Sorted numerically rather than by how many entries each has: the group is
 * 577-588 and a reader looking for "my server" wants it where its number says, not
 * wherever this week's board happens to put it.
 */
function ServerLinks({ rows }: { rows: readonly { server_id: number | null }[] }) {
  const servers = [
    ...new Set(rows.flatMap((row) => (row.server_id === null ? [] : [row.server_id]))),
  ].sort((a, b) => a - b);
  if (servers.length === 0) {
    return null;
  }
  return (
    <nav aria-label="Servers on this board" className="server-links">
      {servers.map((server) => (
        <a className="server-link" href={serverHash(server)} key={server}>
          {server}
        </a>
      ))}
    </nav>
  );
}

export function CrossRankingsPanel() {
  // The server board, for the activity score (0114). Once a day whatever the
  // reader does here: switching between the boards in this panel is reading
  // one screen, not opening three.
  useRecordActivity('rank_server');
  const [boardId, setBoardId] = useState<BoardId>('power');
  const board = boardById(boardId);
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
      {/* Straight to a server's own page.
          LINKS, not tabs. The board above switches what this screen shows; these
          leave it, so they have to be middle-clickable, focusable and visible in the
          status bar like any other link — which a button with a click handler is
          not.

          The list is derived from the rows on screen rather than from the `servers`
          table: this is a jumping-off point from what you are looking at, and
          offering a server the board never mentioned would lead to an empty page. */}
      {data && <ServerLinks rows={data} />}
      {isPending && <p className="empty">Loading…</p>}
      {error && <p className="error">Could not load ranking: {error.message}</p>}
      {data && <CrossRankingTable rows={data} board={board} />}
    </section>
  );
}
