import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { ServerChips } from '../../components/ServerChips';
import { Strip, type StripCell } from '../../components/Strip';
import { Tabs } from '../../components/ui/Tabs';
import { useRecordActivity } from '../../lib/activity';
import { filterByServer, resolveServer, serverCounts } from '../../lib/serverFilter';
import { type SortState, nextSortKeys } from '../../lib/tableControls';
import { TERMS } from '../../lib/terms';
import { CrossRankingTable } from './CrossRankingTable';
import { BOARDS, type Board, type BoardId, boardById } from './boards';
import {
  PAGE_SIZE,
  type PageParams,
  type RemoteMetric,
  fetchPlayerPage,
  fetchPlayerServers,
  pageKey,
} from './remote';
import { boardStrip, remoteStrip } from './strip';

// Longer than the app's 60s default: a board changes only when somebody opens
// it in the game, and the 60s default meant flipping between two boards
// re-queried each flip a minute after first load — which read as the toggle
// itself being slow. Realtime invalidation still applies when a new capture
// actually lands.
const STALE_MS = 10 * 60_000;

const DEFAULT_SORT: SortState[] = [{ key: 'rank', direction: 'asc' }];

/** The heading, the figures and the panel around whichever table is on show. */
function BoardShell({
  board,
  capturedAt,
  strip,
  tabs,
  children,
}: {
  board: Board;
  capturedAt: string | undefined;
  strip: StripCell[] | undefined;
  tabs: ReactNode;
  children: ReactNode;
}) {
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
              {capturedAt && <FreshnessBadge capturedAt={capturedAt} />}
            </p>
          </div>
        </header>
        {strip && <Strip cells={strip} />}
      </div>
      {tabs}
      <div className="panel">{children}</div>
    </section>
  );
}

/** A value that follows `value` after it has stopped changing for `ms`. */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** Power and Kills: the database merges, ranks, filters and pages (0261), and
 * this asks for 50 rows at a time. */
function RemoteBoard({
  board,
  metric,
  tabs,
}: {
  board: Board;
  metric: RemoteMetric;
  tabs: ReactNode;
}) {
  const [chosenServer, setChosenServer] = useState<number | null>(null);
  const [input, setInput] = useState('');
  const search = useDebounced(input, 300);
  const [sort, setSort] = useState<SortState[]>(DEFAULT_SORT);
  const [page, setPage] = useState(1);

  const serversQuery = useQuery({
    queryKey: ['crossRankings', 'servers', metric],
    queryFn: () => fetchPlayerServers(metric),
    staleTime: STALE_MS,
  });
  const servers = serversQuery.data ?? [];
  const server = resolveServer(servers, chosenServer);

  const params: PageParams = { metric, server, search, sort, page };
  const { data, error, isPending } = useQuery({
    queryKey: pageKey(params),
    queryFn: () => fetchPlayerPage(params),
    placeholderData: keepPreviousData,
    staleTime: STALE_MS,
  });
  // The first-ranked row of the whole board: the strip's "Top" and the scale
  // every page's bars share. It is the same request as the unfiltered first
  // page, so the cache serves it when that is what is on screen.
  const topParams: PageParams = { metric, server: null, search: '', sort: DEFAULT_SORT, page: 1 };
  const top = useQuery({
    queryKey: pageKey(topParams),
    queryFn: () => fetchPlayerPage(topParams),
    staleTime: STALE_MS,
  });
  const leader = top.data?.rows[0];
  const overall = servers.reduce((sum, entry) => sum + entry.count, 0);
  const newest = servers
    .map((entry) => entry.newest)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1);

  return (
    <BoardShell
      board={board}
      capturedAt={newest}
      strip={
        serversQuery.data
          ? remoteStrip(serversQuery.data, leader, board.valueLabel, new Date())
          : undefined
      }
      tabs={tabs}
    >
      {/* Every server the board mentions, from the database's own count, so a
        newly scanned server shows up on its own. */}
      <ServerChips
        onChange={(next) => {
          setChosenServer(next);
          setPage(1);
        }}
        servers={servers}
        value={server}
      />
      {isPending && <p className="empty loading">Loading…</p>}
      {error && <p className="error">Could not load ranking: {error.message}</p>}
      {data && (
        <CrossRankingTable
          board={board}
          remote={{
            query: input,
            onQuery: (next) => {
              setInput(next);
              setPage(1);
            },
            sort,
            onSort: (key, additive = false) => {
              setSort((current) => nextSortKeys(current, key, additive));
              setPage(1);
            },
            page,
            pageCount: Math.max(1, Math.ceil(data.total / PAGE_SIZE)),
            onPage: setPage,
            total: data.total,
            overall,
            maxValue: leader?.value ?? 0,
          }}
          rows={data.rows}
        />
      )}
    </BoardShell>
  );
}

/** The component-power boards, still fetched whole: they are capped at 300 rows
 * and the table pages them in the browser. */
function LocalBoard({ board, tabs }: { board: Board; tabs: ReactNode }) {
  const [chosenServer, setChosenServer] = useState<number | null>(null);
  const { data, error, isPending } = useQuery({
    queryKey: ['crossRankings', board.id],
    queryFn: () => (board.fetch ? board.fetch() : Promise.resolve([])),
    staleTime: STALE_MS,
  });
  const servers = serverCounts(data ?? []);
  const server = resolveServer(servers, chosenServer);
  const shown = data ? filterByServer(data, server) : undefined;
  return (
    <BoardShell
      board={board}
      capturedAt={data?.[0]?.captured_at}
      strip={shown && boardStrip(shown, board.valueLabel, new Date())}
      tabs={tabs}
    >
      <ServerChips onChange={setChosenServer} servers={servers} value={server} />
      {isPending && <p className="empty loading">Loading…</p>}
      {error && <p className="error">Could not load ranking: {error.message}</p>}
      {shown && <CrossRankingTable board={board} key={server ?? 'all'} rows={shown} />}
    </BoardShell>
  );
}

export function CrossRankingsPanel() {
  // The server board, for the activity score (0114). Once a day whatever the
  // reader does here: switching between the boards in this panel is reading
  // one screen, not opening three.
  useRecordActivity('rank_server');
  const [boardId, setBoardId] = useState<BoardId>('power');
  const board = boardById(boardId);
  const tabs = (
    <Tabs
      label="Ranking metric"
      items={BOARDS.map((candidate) => ({ id: candidate.id, label: candidate.label }))}
      value={boardId}
      onChange={setBoardId}
    />
  );
  // Keyed by board: the chosen server, search and page belong to one board.
  return board.remoteMetric ? (
    <RemoteBoard board={board} key={board.id} metric={board.remoteMetric} tabs={tabs} />
  ) : (
    <LocalBoard board={board} key={board.id} tabs={tabs} />
  );
}
