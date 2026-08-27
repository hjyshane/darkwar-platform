import { useMemo } from 'react';
import { ArrangedTable, type Column } from '../../components/ArrangedTable';
import { TableSearch } from '../../components/TableSearch';
import { playerHash } from '../../lib/route';
import type { ColumnSpec } from '../../lib/tableLayout';
import { TERMS } from '../../lib/terms';
import { useTableView } from '../../lib/useTableView';
import { type BuildingGrid, type MemberBuildings, buildingsBehind, levelKey } from './buildings';

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
  /** Building type id → the level below which THAT building is behind. A
   * building missing from the map is not judged; an empty map marks nobody. */
  floors: ReadonlyMap<number, number>;
}

export function SeasonBuildingTable({ grid, floors }: SeasonBuildingTableProps) {
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
          const short = buildingsBehind(row, grid.columns, floors);
          // Which buildings, and what each was supposed to reach. The old
          // mark could only say "something is below 10", which left the
          // reader to find it by eye across seven columns.
          const why = short.map((kind) => `${kind.name} < ${floors.get(kind.id) ?? 0}`).join(', ');
          return (
            <>
              {short.length > 0 && (
                // Text inside the badge, not colour alone: the mark has to
                // survive a monochrome screen and a reader who cannot tell
                // the two colours apart.
                <span aria-label={`Behind: ${why}`} className="behind-mark" title={why}>
                  !
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
        if (level === null || level === undefined) {
          return <span className="muted">—</span>;
        }
        const floor = floors.get(kind.id);
        // The cell itself, not only the name. A row marked at the far left
        // and seven columns wide makes the reader hunt for the building that
        // earned the mark; marking the number says it where it is read.
        return floor !== undefined && level < floor ? (
          <span className="cell-behind" title={`Below ${floor}`}>
            {level}
          </span>
        ) : (
          level
        );
      },
    }));
    return [...identity, ...buildings];
  }, [grid.columns, floors]);

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
