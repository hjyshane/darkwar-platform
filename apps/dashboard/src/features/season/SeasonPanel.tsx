import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { floorsFor, useSeasonBuildingAlert } from '../../lib/seasonBuildingAlert';
import { TERMS } from '../../lib/terms';
import { SeasonAllianceTable } from './SeasonAllianceTable';
import { SeasonBuildingTable } from './SeasonBuildingTable';
import { SeasonForceTable } from './SeasonForceTable';
import { SeasonWaitCalculator } from './SeasonWaitCalculator';
import { type SeasonBoardId, fetchAllianceScoreBoard, fetchPlayerForceBoard } from './boards';
import { SEASON3_BUILDINGS, fetchBuildingGrid } from './buildings';

/** The calculator is not a board — it queries nothing and is fed by hand — so
 * it is a tab id of its own rather than a fourth `SeasonBoardId`. Keeping it
 * out of that union is what stops it from ever being handed to a fetcher. */
type SeasonTabId = SeasonBoardId | 'calculator';

/** Buildings first: it is the board the alliance opens the tab to read, and
 * the two rankings are the ones you go looking for. The calculator is last —
 * it is a tool you go to deliberately, not something you read. */
const BOARD_LABELS: ReadonlyArray<{ id: SeasonTabId; label: string }> = [
  { id: 'buildings', label: TERMS.seasonBuildings },
  { id: 'alliance_score', label: TERMS.seasonScore },
  { id: 'player_force', label: TERMS.seasonForce },
  { id: 'calculator', label: TERMS.seasonCalculator },
];

/** A board changes only when somebody opens it in the game, so the app's 60s
 * default would re-query on every toggle a minute after load and read as the
 * toggle being slow. Same reasoning and same figure as the cross-server
 * panel. Realtime invalidation still applies when a capture lands. */
const STALE_TIME = 10 * 60_000;

export function SeasonPanel() {
  // NO useRecordActivity HERE, deliberately.
  //
  // The activity kinds are fixed by a CHECK constraint in 0114 and consumed
  // by the scoring views in 0114, 0118 and 0120. Adding a season kind is a
  // scoring change, which per CLAUDE.md means a new scoring version rather
  // than an edit — and reusing 'rank_player' would quietly count season
  // opens as player-board opens and corrupt a metric that already has
  // history. No measurement is better than a wrong one; the kind can be
  // added deliberately when season scoring is designed.
  const [boardId, setBoardId] = useState<SeasonTabId>('buildings');
  const { data: alert } = useSeasonBuildingAlert();

  const alliance = useQuery({
    queryKey: ['seasonBoard', 'alliance_score'],
    queryFn: fetchAllianceScoreBoard,
    staleTime: STALE_TIME,
    enabled: boardId === 'alliance_score',
  });
  const players = useQuery({
    queryKey: ['seasonBoard', 'player_force'],
    queryFn: fetchPlayerForceBoard,
    staleTime: STALE_TIME,
    enabled: boardId === 'player_force',
  });
  const buildings = useQuery({
    queryKey: ['seasonBoard', 'buildings'],
    queryFn: () => fetchBuildingGrid(SEASON3_BUILDINGS),
    staleTime: STALE_TIME,
    enabled: boardId === 'buildings',
  });
  // The calculator has no query, so it has no pending or error state to
  // report — `active` stays undefined and both banners below stay off.
  const active =
    boardId === 'alliance_score'
      ? alliance
      : boardId === 'player_force'
        ? players
        : boardId === 'buildings'
          ? buildings
          : undefined;
  const capturedAt =
    buildings.data?.capturedAt ?? alliance.data?.[0]?.captured_at ?? players.data?.[0]?.captured_at;
  // Per building (0158), against the catalogue this board is rendering — so a
  // level saved under the old single-number setting still lands on exactly
  // the buildings it used to judge.
  //
  // Memoised because the table keys its column memo on this: a fresh Map every
  // render would rebuild seven columns on every keystroke in the search box.
  const columns = buildings.data?.columns;
  const floors = useMemo(() => floorsFor(alert, columns ?? []), [alert, columns]);

  return (
    <section aria-labelledby="season-heading">
      <h2 id="season-heading">
        {TERMS.season}
        {/* Not on the calculator: the badge dates a capture, and that tab
            has no captured figure on it. Leaving it up would date numbers the
            reader typed themselves. */}
        {capturedAt && boardId !== 'calculator' && <FreshnessBadge capturedAt={capturedAt} />}
      </h2>
      {/* The boards describe different subjects, so this switches the whole
          table rather than a column. Tabs, not links: all of them live at
          this address. */}
      <div role="tablist" aria-label="Season board">
        {BOARD_LABELS.map((candidate) => (
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
      {active?.isPending && <p className="empty">Loading…</p>}
      {active?.error && (
        <p className="error">Could not load season board: {active.error.message}</p>
      )}

      {boardId === 'buildings' && buildings.data && (
        <SeasonBuildingTable floors={floors} grid={buildings.data} />
      )}
      {boardId === 'alliance_score' && alliance.data && (
        <SeasonAllianceTable rows={alliance.data} />
      )}
      {boardId === 'player_force' && players.data && <SeasonForceTable rows={players.data} />}
      {boardId === 'calculator' && <SeasonWaitCalculator />}

      {/* The one thing a reader could get badly wrong on this grid. An empty
          cell is a gap in OUR coverage — the collector has not panned over
          that building — and not a member who has built nothing. Saying so
          on the screen because the distinction is invisible in a table of
          numbers. */}
      {boardId === 'buildings' && (
        <p className="note">
          A dash means we have not seen that building yet, not that it is unbuilt. Only buildings
          the collector has panned over appear here.
          {floors.size > 0 && (
            <>
              {' '}
              A <span className="behind-mark">!</span> marks a member under one of the levels the
              alliance set, and the number itself is marked in the column that is short:{' '}
              {buildings.data?.columns
                .filter((kind) => floors.has(kind.id))
                .map((kind) => `${kind.name} ${floors.get(kind.id)}`)
                .join(', ')}
              .
            </>
          )}
          {buildings.data !== undefined && buildings.data.unnamedSeen > 0 && (
            <>
              {' '}
              {buildings.data.unnamedSeen} more building type
              {buildings.data.unnamedSeen === 1 ? ' is' : 's are'} on the map that this board does
              not name — last season's among them. They are left out rather than shown as a number.
            </>
          )}
        </p>
      )}
      {(boardId === 'alliance_score' || boardId === 'player_force') && (
        // Said on the screen, not only in the migration. `force` and `score`
        // are the game's own season figures and neither is power — a reader
        // who assumes otherwise will compare them against the power board and
        // conclude the data is wrong.
        <p className="note">
          Coal production and influence are the game's own season figures. Neither is power, and
          neither is comparable with the cross-server boards.
        </p>
      )}
    </section>
  );
}
