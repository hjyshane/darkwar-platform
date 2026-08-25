import { useMemo } from 'react';
import { ArrangedTable, type Column } from '../../components/ArrangedTable';
import { TableSearch } from '../../components/TableSearch';
import { playerHash } from '../../lib/route';
import type { ColumnSpec } from '../../lib/tableLayout';
import { TERMS } from '../../lib/terms';
import { useTableView } from '../../lib/useTableView';
import { type BuildingGrid, type MemberBuildings, isBehind, levelKey } from './buildings';

const SEARCH_FIELDS = ['name', 'gameUid'] as const;

/** This table's key in the shared column arrangement. */
export const TABLE_ID = 'season-member-buildings';

/** Identity only. The building columns are data-driven — which buildings
 * exist is whatever the map has shown — so they cannot be listed here. */
export function seasonBuildingColumnSpecs(): ColumnSpec[] {
  return [
    { id: 'name', label: TERMS.name, fixed: true },
    { id: 'seen', label: TERMS.lastSeen },
  ];
}

export interface SeasonBuildingTableProps {
  grid: BuildingGrid;
  /** Level below which a member is marked, or null to mark nobody. */
  alertLevel: number | null;
}

export function SeasonBuildingTable({ grid, alertLevel }: SeasonBuildingTableProps) {
  const { query, setQuery, sort, onSort, view, shown, total } = useTableView(
    grid.members,
    SEARCH_FIELDS,
    { key: 'name', direction: 'asc' },
  );

  const columns = useMemo<Column<MemberBuildings>[]>(() => {
    const identity: Column<MemberBuildings>[] = [
      {
        id: 'name',
        label: TERMS.name,
        sortKey: 'name',
        className: 'label',
        fixed: true,
        cell: (row) => {
          const behind = alertLevel !== null && isBehind(row, grid.columns, alertLevel);
          return (
            <>
              {behind && (
                // Text, not colour alone: the mark has to survive a
                // monochrome screen and a reader who cannot tell the two
                // colours apart. The title says which level it means, so
                // nobody has to go and look the setting up.
                <span
                  className="behind-mark"
                  title={`Has a building below level ${alertLevel}`}
                  aria-label={`Below level ${alertLevel}`}
                >
                  !{' '}
                </span>
              )}
              <a href={playerHash(row.playerId)}>{row.name ?? `UID ${row.gameUid}`}</a>
            </>
          );
        },
      },
    ];
    const buildings: Column<MemberBuildings>[] = grid.columns.map((kind) => ({
      id: `b${kind.id}`,
      // The catalogue's name, always. `columns` only ever holds catalogue
      // entries, so this can never fall back to a bare id.
      label: kind.provisional ? `${kind.name}*` : kind.name,
      numeric: true,
      // Sorted by the level in THIS column, so "who is behind on the
      // greenhouse" is one header click rather than a read of the whole grid.
      sortKey: levelKey(kind.id),
      // FR-UI-008 again, and it matters more here than anywhere else on the
      // site: an empty cell means the collector has never panned over that
      // building, NOT that the member has not built it. Rendering 0 would
      // accuse somebody of doing nothing on the strength of a gap in our
      // own coverage.
      cell: (row: MemberBuildings) => {
        const level = row[levelKey(kind.id)];
        return level === null || level === undefined ? <span className="muted">—</span> : level;
      },
    }));
    return [...identity, ...buildings];
  }, [grid.columns, alertLevel]);

  if (grid.members.length === 0) {
    return <p className="empty">No season buildings seen for our members yet.</p>;
  }
  return (
    <>
      <TableSearch
        label="Search members"
        unit="members"
        onChange={setQuery}
        shown={shown}
        total={total}
        value={query}
      />
      <ArrangedTable
        columns={columns}
        onSort={onSort}
        rowKey={(row) => row.playerId}
        rows={view}
        sort={sort}
        tableId={TABLE_ID}
      />
      {view.length === 0 && <p className="empty">No member matches “{query}”.</p>}
      <MissingMembers grid={grid} />
    </>
  );
}

/** What the board is NOT showing.
 *
 * This table displayed 67 of 84 members and looked finished; a reader had to
 * count the alliance by hand to notice. Two different facts were arriving as
 * one — a member with nothing built, and a member whose plot the collector
 * has never panned over — and the screen distinguished neither.
 *
 * The number is only worth printing when it is not zero: a line saying "84 of
 * 84" on every visit is noise that trains people to skip the line, which is
 * exactly the line that has to be read on the day it says 67.
 */
function MissingMembers({ grid }: { grid: BuildingGrid }) {
  const total = grid.rosterTotal;
  if (total === null || total <= grid.members.length) {
    return null;
  }
  const missing = total - grid.members.length;
  return (
    <p className="subtle">
      Showing {grid.members.length} of {total} members. {missing} {missing === 1 ? 'has' : 'have'}{' '}
      no building observed yet — the map is only read where the collector is pointed, so this is a
      gap in our coverage rather than a report about them.
    </p>
  );
}
