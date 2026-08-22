import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { useSeasonBuildingAlert } from '../../lib/seasonBuildingAlert';
import { TERMS } from '../../lib/terms';
import { SeasonAllianceTable } from './SeasonAllianceTable';
import { SeasonBuildingTable } from './SeasonBuildingTable';
import { SeasonForceTable } from './SeasonForceTable';
import { type SeasonBoardId, fetchAllianceScoreBoard, fetchPlayerForceBoard } from './boards';
import { SEASON3_BUILDINGS, fetchBuildingGrid } from './buildings';

/** Buildings first: it is the board the alliance opens the tab to read, and
 * the two rankings are the ones you go looking for. */
const BOARD_LABELS: ReadonlyArray<{ id: SeasonBoardId; label: string }> = [
  { id: 'buildings', label: TERMS.seasonBuildings },
  { id: 'alliance_score', label: TERMS.seasonScore },
  { id: 'player_force', label: TERMS.seasonForce },
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
  const [boardId, setBoardId] = useState<SeasonBoardId>('buildings');
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
  const active =
    boardId === 'alliance_score' ? alliance : boardId === 'player_force' ? players : buildings;
  const capturedAt =
    buildings.data?.capturedAt ?? alliance.data?.[0]?.captured_at ?? players.data?.[0]?.captured_at;
  const alertLevel = alert?.enabled === true ? alert.level : null;

  return (
    <section aria-labelledby="season-heading">
      <h2 id="season-heading">
        {TERMS.season}
        {capturedAt && <FreshnessBadge capturedAt={capturedAt} />}
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
      {active.isPending && <p className="empty">Loading…</p>}
      {active.error && <p className="error">Could not load season board: {active.error.message}</p>}

      {boardId === 'buildings' && buildings.data && (
        <SeasonBuildingTable grid={buildings.data} alertLevel={alertLevel} />
      )}
      {boardId === 'alliance_score' && alliance.data && (
        <SeasonAllianceTable rows={alliance.data} />
      )}
      {boardId === 'player_force' && players.data && <SeasonForceTable rows={players.data} />}

      {/* The one thing a reader could get badly wrong on this grid. An empty
          cell is a gap in OUR coverage — the collector has not panned over
          that building — and not a member who has built nothing. Saying so
          on the screen because the distinction is invisible in a table of
          numbers. */}
      {boardId === 'buildings' && (
        <p className="note">
          A dash means we have not seen that building yet, not that it is unbuilt. Only buildings
          the collector has panned over appear here.
          {alertLevel !== null && (
            <> A ! marks a member holding any building below level {alertLevel}.</>
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
