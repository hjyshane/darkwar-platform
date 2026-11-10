import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pager } from '../../components/Pager';
import { Led, type LedTone } from '../../components/console/Led';
import { compactNumber } from '../../lib/compactNumber';
import { formatAge } from '../../lib/freshness';
import { PAGE_SIZE, pageOf } from '../../lib/pagination';
import { allianceHash, playerHash } from '../../lib/route';
import {
  type AllianceMove,
  MOVES_CAVEAT,
  MOVES_WINDOW_DAYS,
  type MoveDirection,
  fetchAllianceMoves,
  filterMoves,
  newestMoves,
  otherAllianceLabel,
} from './moves';
import './alliance.css';

const compact = compactNumber(1);

/** Twenty to a page, the same as every paged board on the site. */
export const MOVES_PAGE_SIZE = PAGE_SIZE;
const RECENT = 5;

const DIRECTION: Record<string, { tone: LedTone; label: string }> = {
  in: { tone: 'ok', label: 'In' },
  out: { tone: 'bad', label: 'Out' },
  relocated: { tone: 'neutral', label: 'Relocated' },
};

/** What to say when there is nothing. The RPC decides who sees which feed and
 * returns no rows either way, so the page cannot tell "nobody moved" from "not
 * yours to read" for one of our alliances; it says who the feed is for instead
 * of claiming the first. */
export function movesEmptyText(ownAlliance: boolean): string {
  return ownAlliance
    ? 'Nothing to show. For one of our alliances this feed is for its members, officers and admins.'
    : `No moves observed in the last ${MOVES_WINDOW_DAYS} days.`;
}

/** One row per move, newest first as given. */
export function MovesTable({ rows, now }: { rows: readonly AllianceMove[]; now: Date }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th className="label" scope="col">
              Player
            </th>
            <th scope="col">Move</th>
            <th scope="col">From / to</th>
            <th scope="col">Power then</th>
            <th scope="col">Observed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const direction = DIRECTION[row.direction] ?? {
              tone: 'neutral' as const,
              label: row.direction,
            };
            const other = otherAllianceLabel(row);
            // Null at runtime for "no alliance" and for an alliance we have
            // not catalogued, whatever the generated type says.
            const otherId = row.other_alliance_id as string | null;
            const power = row.power_at as number | null;
            return (
              <tr key={`${row.game_uid}:${row.observed_at}:${row.direction}`}>
                <td className="label">
                  <a href={playerHash(row.player_id)}>{row.player_name ?? '—'}</a>
                </td>
                <td>
                  <Led tone={direction.tone}>{direction.label}</Led>
                </td>
                <td>{otherId === null ? other : <a href={allianceHash(otherId)}>{other}</a>}</td>
                <td>{power === null ? '—' : compact.format(power)}</td>
                <td title={row.observed_at}>{formatAge(row.observed_at, now)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type Filter = MoveDirection | 'all';
const FILTERS: ReadonlyArray<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'in', label: 'In' },
  { id: 'out', label: 'Out' },
  { id: 'relocated', label: 'Relocated' },
];

/** The whole feed: direction filter, twenty to a page, and the caveat that a
 * move is only ever seen the next time we observe the player. */
export function MovesFeed({
  rows,
  ownAlliance,
  now,
}: {
  rows: readonly AllianceMove[];
  ownAlliance: boolean;
  now: Date;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  if (rows.length === 0) {
    return (
      <section aria-label="Moves" className="alliance-panel">
        <h2>Moves · last {MOVES_WINDOW_DAYS} days</h2>
        <p className="empty">{movesEmptyText(ownAlliance)}</p>
      </section>
    );
  }
  // Relocated is rare (a whole alliance changing server), so the chip only
  // appears when there is one to find.
  const offered = FILTERS.filter(
    (entry) => entry.id !== 'relocated' || rows.some((row) => row.direction === 'relocated'),
  );
  const shown = filterMoves(newestMoves(rows, rows.length), filter);
  const at = pageOf(shown.length, page, MOVES_PAGE_SIZE);
  return (
    <section aria-label="Moves" className="alliance-panel">
      <h2>Moves · last {MOVES_WINDOW_DAYS} days</h2>
      <div className="moves-toolbar">
        {offered.map((entry) => (
          <button
            aria-pressed={entry.id === filter}
            className="filter-chip"
            key={entry.id}
            onClick={() => {
              setFilter(entry.id);
              setPage(1);
            }}
            type="button"
          >
            {entry.label}
          </button>
        ))}
        <span className="moves-count">
          {shown.length} {shown.length === 1 ? 'move' : 'moves'}
        </span>
      </div>
      {shown.length === 0 ? (
        <p className="empty">No moves of that kind in the window.</p>
      ) : (
        <MovesTable now={now} rows={shown.slice(at.from, at.to + 1)} />
      )}
      <Pager onGo={setPage} page={at.page} pageCount={at.pageCount} />
      <p className="alliance-panel-foot">{MOVES_CAVEAT}</p>
    </section>
  );
}

/** The newest five, for Overview, with a way to the rest. */
export function RecentMovesView({
  rows,
  ownAlliance,
  allianceId,
  now,
}: {
  rows: readonly AllianceMove[];
  ownAlliance: boolean;
  allianceId: string;
  now: Date;
}) {
  return (
    <section aria-label="Recent moves" className="alliance-panel">
      <h2>Recent moves</h2>
      {rows.length === 0 ? (
        <p className="empty">{movesEmptyText(ownAlliance)}</p>
      ) : (
        <>
          <MovesTable now={now} rows={newestMoves(rows, RECENT)} />
          <p className="alliance-panel-foot">
            <a href={allianceHash(allianceId, 'moves')}>
              All {rows.length} in the last {MOVES_WINDOW_DAYS} days
            </a>
          </p>
        </>
      )}
    </section>
  );
}

function useMoves(allianceId: string, now: Date) {
  return useQuery({
    // One read for both the Overview panel and the tab. The window is anchored
    // to the day, so the key is stable while the page is open.
    queryKey: ['alliance-moves', allianceId],
    queryFn: () =>
      fetchAllianceMoves(allianceId, new Date(now.getTime() - MOVES_WINDOW_DAYS * 24 * 3_600_000)),
  });
}

interface MovesProps {
  allianceId: string;
  /** `alliances.is_own` as stored: only words the empty state. */
  ownAlliance: boolean;
  now?: Date;
}

export function RecentMoves({ allianceId, ownAlliance, now }: MovesProps) {
  const at = now ?? new Date();
  const { data, error, isPending } = useMoves(allianceId, at);
  if (isPending || error) {
    return (
      <section aria-label="Recent moves" className="alliance-panel">
        <h2>Recent moves</h2>
        {isPending ? (
          <p className="empty loading">Loading…</p>
        ) : (
          <p className="error">Could not load moves: {error.message}</p>
        )}
      </section>
    );
  }
  return <RecentMovesView allianceId={allianceId} now={at} ownAlliance={ownAlliance} rows={data} />;
}

export function MovesTab({ allianceId, ownAlliance, now }: MovesProps) {
  const at = now ?? new Date();
  const { data, error, isPending } = useMoves(allianceId, at);
  if (isPending || error) {
    return (
      <section aria-label="Moves" className="alliance-panel">
        <h2>Moves · last {MOVES_WINDOW_DAYS} days</h2>
        {isPending ? (
          <p className="empty loading">Loading…</p>
        ) : (
          <p className="error">Could not load moves: {error.message}</p>
        )}
      </section>
    );
  }
  return <MovesFeed now={at} ownAlliance={ownAlliance} rows={data} />;
}
