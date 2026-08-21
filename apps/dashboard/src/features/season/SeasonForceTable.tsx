import { useMemo } from 'react';
import { ArrangedTable, type Column } from '../../components/ArrangedTable';
import { TableSearch } from '../../components/TableSearch';
import { playerHash, serverHash } from '../../lib/route';
import type { ColumnSpec } from '../../lib/tableLayout';
import { TERMS } from '../../lib/terms';
import { useTableView } from '../../lib/useTableView';
import { type SeasonPlayerRow, allianceLabel } from './boards';

const numberFormat = new Intl.NumberFormat('ko-KR');

const SEARCH_FIELDS = ['name', 'game_uid', 'allianceName', 'abbr'] as const;

/** This table's key in the shared column arrangement. */
export const TABLE_ID = 'season-player-force';

export function seasonForceColumnSpecs(): ColumnSpec[] {
  return [
    { id: 'rank', label: TERMS.rank },
    { id: 'name', label: TERMS.name, fixed: true },
    { id: 'alliance', label: TERMS.alliance },
    { id: 'server', label: TERMS.server },
    { id: 'force', label: TERMS.seasonForce },
  ];
}

function formatNumber(value: number | null): string {
  // FR-UI-008: unknown is unknown, never zero.
  return value === null ? '—' : numberFormat.format(value);
}

export function SeasonForceTable({ rows }: { rows: SeasonPlayerRow[] }) {
  const { query, setQuery, sort, onSort, view, shown, total } = useTableView(rows, SEARCH_FIELDS, {
    key: 'rank',
    direction: 'asc',
  });

  const columns = useMemo<Column<SeasonPlayerRow>[]>(
    () => [
      {
        id: 'rank',
        label: TERMS.rank,
        sortKey: 'rank',
        numeric: true,
        cell: (row) => row.rank ?? '—',
      },
      {
        id: 'name',
        label: TERMS.name,
        sortKey: 'name',
        className: 'label',
        fixed: true,
        cell: (row) =>
          row.playerId === null ? (
            (row.name ?? `UID ${row.game_uid}`)
          ) : (
            <a href={playerHash(row.playerId)}>{row.name ?? `UID ${row.game_uid}`}</a>
          ),
      },
      {
        id: 'alliance',
        label: TERMS.alliance,
        sortKey: 'allianceName',
        className: 'label',
        // Name only, unlinked: this board carries the alliance's external id
        // but the panel never resolves it, and a ranked player need not be in
        // an alliance at all.
        cell: (row) => allianceLabel(row.allianceName, row.abbr) ?? '—',
      },
      {
        id: 'server',
        label: TERMS.server,
        sortKey: 'server_id',
        numeric: true,
        cell: (row) => <a href={serverHash(row.server_id)}>{row.server_id}</a>,
      },
      {
        id: 'force',
        label: TERMS.seasonForce,
        sortKey: 'force',
        numeric: true,
        cell: (row) => formatNumber(row.force),
      },
    ],
    [],
  );

  if (rows.length === 0) {
    return <p className="empty">No season player board captured yet.</p>;
  }
  return (
    <>
      <TableSearch
        label="Search players"
        unit="players"
        onChange={setQuery}
        shown={shown}
        total={total}
        value={query}
      />
      <ArrangedTable
        columns={columns}
        onSort={onSort}
        rowKey={(row) => row.id}
        rows={view}
        sort={sort}
        tableId={TABLE_ID}
      />
      {view.length === 0 && <p className="empty">No player matches “{query}”.</p>}
    </>
  );
}
