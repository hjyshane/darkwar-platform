import { useMemo } from 'react';
import { ArrangedTable, type Column } from '../../components/ArrangedTable';
import { TableSearch } from '../../components/TableSearch';
import { playerHash } from '../../lib/route';
import type { ColumnSpec } from '../../lib/tableLayout';
import { TERMS } from '../../lib/terms';
import { useTableView } from '../../lib/useTableView';
import { type BuildingGrid, type MemberBuildings, buildingLabel, levelKey } from './buildings';

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

export function SeasonBuildingTable({ grid }: { grid: BuildingGrid }) {
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
        cell: (row) => <a href={playerHash(row.playerId)}>{row.name ?? `UID ${row.gameUid}`}</a>,
      },
    ];
    const buildings: Column<MemberBuildings>[] = grid.columns.map((typeId) => ({
      id: `b${typeId}`,
      label: buildingLabel(typeId),
      numeric: true,
      // Sorted by the level in THIS column, so "who is behind on the
      // greenhouse" is one header click rather than a read of the whole grid.
      sortKey: levelKey(typeId),
      // FR-UI-008 again, and it matters more here than anywhere else on the
      // site: an empty cell means the collector has never panned over that
      // building, NOT that the member has not built it. Rendering 0 would
      // accuse somebody of doing nothing on the strength of a gap in our
      // own coverage.
      cell: (row: MemberBuildings) => {
        const level = row[levelKey(typeId)];
        return level === null || level === undefined ? <span className="muted">—</span> : level;
      },
    }));
    return [...identity, ...buildings];
  }, [grid.columns]);

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
    </>
  );
}
